/**
 * Step 7.7's actions on a connected agent (docs/plans/agent-connect-plan.md §3.15 items 4 and 5, §3.10, §7.7): change
 * its memories, restore drifted access, finish a pending memory, extend a temporary agent, and remove one that has
 * ended. Revoke is step 7.10's (`revokeAgentConnection`), not here: Remove takes it as a port, and until step 7.10 is
 * on the branch, Remove of an agent the VTA still lists fails with `revokeUnavailable` and drops nothing.
 *
 * Every write to the agent's entry is computed from the entry as read just before it, never from the record, and the
 * entry is read back after it: the VTA, not the call, decides what was applied (§3.15 item 4, "read back after each").
 * Every write to the record goes through the store's one lock per record (`update`), since step 7.10's reconcile and
 * the driver write the same records.
 *
 * The owner's decisions are the screens': the biometric before a widening and an extension, the confirmation before a
 * narrowing and a restore. These functions assume them made.
 *
 * @module connected-agents/actions
 */

import type { AgentAccessPort, AccessEntry } from './carriage'
import { completeEnrolment } from './carriage'
import type { ConnectionRecords } from './driver'
import { personaSigningKeyId } from './driver'
import { NOT_FINISHED_AFTER_MS, TEMPORARY_GRANT_MS } from './pairing'
import { expiresAtMs, memoryDrift, statusOf } from './status'
import type { AgentConnection } from './types'
import { buildVdcGrant, issueVdc, vdcScopeFor, vtaVdcSigner, type VdcSignPort } from './vdc'

/** Why an action did not do what was asked. Each is a fact for the screen to word (§6), not words. */
export type ActionFailure =
  /** No record with that id. */
  | 'noRecord'
  /** The record's status does not offer this action (for example, Extend on a persistent agent). */
  | 'notOffered'
  /** The VTA does not list the agent's entry, or listed only part of the access list. */
  | 'notListed'
  /** The VTA could not be reached, or refused the write. */
  | 'unreachable'
  /** The write was sent, and the entry read back does not show it. */
  | 'notApplied'
  /** The change would leave the entry with no context, which an agent's entry cannot have. */
  | 'lastMemory'
  /** The entry was extended, and the new VDC could not be issued: the record keeps its old one. */
  | 'vdc'
  /** The VTA still lists the entry, and step 7.10's revoke is not here to remove it. */
  | 'revokeUnavailable'
  /** Step 7.10's revoke ran, and a full listing does not show the entry gone. */
  | 'revokeNotConfirmed'
  /**
   * The record has no `deviceId`, so the VTA was asked by key alone, and an entry that rotated to another key would
   * not be listed: an empty listing does not show it gone, and the record is kept until its entry's recorded expiry
   * has passed (with none recorded, until it is revoked).
   */
  | 'goneUnproven'

export type ActionResult = { ok: true } | { ok: false; code: ActionFailure }

/** Step 7.10's revoke of one agent's entry, as Remove needs it: `gone` only when a full listing no longer shows it. */
/** The records the actions read and write: the driver's, and dropping one (`AgentConnectionStore.remove`). */
export type ActionRecords = ConnectionRecords & { remove(id: string): Promise<void> }

export type RevokeEntryPort = (record: AgentConnection) => Promise<{ gone: boolean }>

export type ActionPorts = {
  clock: () => number
  access: AgentAccessPort
  connections: ActionRecords
  /** `keys/sign-document/0.1` on the owner's VTA, for Extend's new VDC (step 7.3). */
  vdcSign: VdcSignPort
  signingKeyIdOf?: (personaDid: string) => string
  /** Step 7.10's revoke (#1077). Absent until it is on the branch. */
  revokeEntry?: RevokeEntryPort
  /** The persona contexts of the agent's rooms, which its entry may hold (§3.15 item 5). P0 has no rooms. */
  roomContextsOf?: (record: AgentConnection) => readonly string[]
}

const ok: ActionResult = { ok: true }
const fail = (code: ActionFailure): ActionResult => ({ ok: false, code })
const iso = (ms: number) => new Date(ms).toISOString()

/** The contexts an entry holds (none when its `act` is anything but a context list). */
export function heldContexts(entry: AccessEntry): string[] {
  return entry.act?.stated === 'contexts' ? [...(entry.act.contexts ?? [])] : []
}

/**
 * The contexts the record's entry may hold besides its memories: the agent's own context (a memoryless agent's, §3.3),
 * which is any bound context that is not a memory, and the persona contexts of its rooms.
 */
export function allowedBesideMemories(record: AgentConnection, rooms: readonly string[] = []): string[] {
  return [...record.contexts.filter((c) => !record.memoryContexts.includes(c)), ...rooms]
}

/**
 * The agent's entry, found by its device when it registered and by its current key (§3.9: `agentDid`), as the
 * carriage finds it. Undefined when the VTA lists none, or listed only part of the access list.
 */
async function entryOf(access: AgentAccessPort, record: AgentConnection): Promise<AccessEntry | undefined> {
  const found = await access.findAgentEntries({
    ...(record.deviceId ? { deviceId: record.deviceId } : {}),
    subject: record.agentDid,
  })
  const match =
    (record.deviceId ? found.matches.find((m) => m.deviceId === record.deviceId) : undefined) ??
    found.matches.find((m) => m.entry.subject === record.agentDid)
  if (match) return match.entry
  return undefined
}

export class AgentActions {
  public constructor(private readonly ports: ActionPorts) {}

  /** Add one memory (§3.15 item 4, D34). The screen has named every room and taken the biometric decision. */
  public widen(id: string, memoryId: string): Promise<ActionResult> {
    return this.changeMemories(id, (held) => (held.includes(memoryId) ? held : [...held, memoryId]), {
      add: [memoryId],
      remove: [],
    })
  }

  /** Remove one memory (§3.15 item 4): `acl/revoke` 0.3 `{kind: "act"}`, effective on the agent's next request. */
  public narrow(id: string, memoryId: string): Promise<ActionResult> {
    return this.changeMemories(id, (held) => held.filter((c) => c !== memoryId), { add: [], remove: [memoryId] })
  }

  /**
   * Narrow a drifted entry back to what the owner bound (§3.15 item 5: "Restore", one confirmation): its memories,
   * the agent's own context and its rooms' persona contexts. A bound memory the entry lost is not re-added here;
   * that is a widening, with its own decision.
   */
  public async restore(id: string): Promise<ActionResult> {
    const record = await this.ports.connections.get(id)
    if (!record) return fail('noRecord')
    if (record.state !== 'active') return fail('notOffered')
    const allowed = allowedBesideMemories(record, this.ports.roomContextsOf?.(record))
    try {
      const entry = await entryOf(this.ports.access, record)
      if (!entry) return fail('notListed')
      const held = heldContexts(entry)
      const extra = memoryDrift(record, held, allowed)?.extra ?? []
      if (extra.length === 0) return ok
      const kept = held.filter((c) => !extra.includes(c))
      if (kept.length === 0) return fail('lastMemory')
      await this.ports.access.narrowOrWidenCapabilities({ subject: entry.subject, act: { from: held, to: kept } })
      const after = await entryOf(this.ports.access, record)
      if (!after) return fail('notListed')
      if (heldContexts(after).some((c) => extra.includes(c))) return fail('notApplied')
      await this.touch(id)
      return ok
    } catch {
      return fail('unreachable')
    }
  }

  /**
   * Finish a memory the one-context grant has not reached yet (§7.5, "Try again"): bounded to the memories the owner
   * still has chosen, so a memory removed since is never re-added.
   */
  public async retryPending(id: string): Promise<ActionResult> {
    const record = await this.ports.connections.get(id)
    if (!record) return fail('noRecord')
    if (record.state !== 'active' || record.pendingContexts.length === 0) return fail('notOffered')
    const done = await completeEnrolment(
      this.ports.access,
      { deviceId: record.deviceId, agentDid: record.agentDid, contextsToAdd: record.pendingContexts },
      record.memoryContexts
    )
    const pendingContexts = done.complete ? [] : done.missing
    await this.ports.connections.update(id, (r) => ({
      ...r,
      pendingContexts,
      lastReconciledAt: iso(this.ports.clock()),
    }))
    return done.complete ? ok : fail('unreachable')
  }

  /**
   * Extend a temporary agent that has not expired (§7.7): `expiresAt` 4 hours ahead with `acl/update` 0.3, then a new
   * VDC issued and stored at once through `issueVdc` (its delivery to the agent is the chat's, §7.9, #1060 finding 8).
   * The screen has re-asked through Approve and the biometric. An expired agent is offered "Connect again" instead:
   * the VTA deletes an expired entry at its next sweep, and `acl/update` then answers `notFound`.
   */
  public async extend(id: string): Promise<ActionResult> {
    const { clock, access, connections, vdcSign } = this.ports
    const record = await connections.get(id)
    if (!record) return fail('noRecord')
    const now = clock()
    if (record.grantType !== 'temporary' || statusOf(record, now) === 'expired' || record.state !== 'active')
      return fail('notOffered')
    const expiresAt = iso(now + TEMPORARY_GRANT_MS)
    try {
      const entry = await entryOf(access, record)
      if (!entry) return fail('notListed')
      await access.narrowOrWidenCapabilities({ subject: entry.subject, expiresAt })
      const after = await entryOf(access, record)
      if (!after) return fail('notListed')
      if (after.expiresAt === undefined || Date.parse(after.expiresAt) !== Date.parse(expiresAt))
        return fail('notApplied')
    } catch {
      return fail('unreachable')
    }
    // The entry now ends at the new time: the record says so whatever happens to the VDC.
    await connections.update(id, (r) => ({ ...r, expiresAt, lastReconciledAt: iso(clock()) }))
    try {
      const keyId = (this.ports.signingKeyIdOf ?? personaSigningKeyId)(record.ownerPersonaDid)
      const unsigned = buildVdcGrant({
        personaDid: record.ownerPersonaDid,
        agentDid: record.agentDid,
        scope: vdcScopeFor({ memory: record.memoryContexts.length > 0, roomAdded: false }),
        now: clock(),
        entryExpiresAt: expiresAt,
      })
      const grant = await issueVdc(unsigned, vtaVdcSigner(vdcSign, keyId))
      await connections.update(id, (r) => ({ ...r, vdcGrant: grant as unknown as Record<string, unknown> }))
      return ok
    } catch {
      return fail('vdc')
    }
  }

  /**
   * Remove an agent that has ended (§3.10, §7.7): "Expired", "Revoked" or "Not finished". The entry is revoked if the
   * VTA still lists it (found by its device and its key, §3.10), and the record is dropped either way, but only once
   * the entry is known gone. A connected agent is not removed here: that is Revoke (step 7.10).
   */
  public async remove(id: string): Promise<ActionResult> {
    const { connections, access, revokeEntry, clock } = this.ports
    const record = await connections.get(id)
    if (!record) return fail('noRecord')
    const status = statusOf(record, clock())
    if (status !== 'expired' && status !== 'revoked' && status !== 'notFinished') return fail('notOffered')
    let listed: boolean
    try {
      const found = await access.findAgentEntries({
        ...(record.deviceId ? { deviceId: record.deviceId } : {}),
        subject: record.agentDid,
      })
      // A partial listing cannot show the entry gone: treat it as still there.
      listed = !found.complete || found.matches.length > 0
      // Asked by key alone, a complete empty listing misses an entry that rotated to another key: the device is what
      // finds a rotated entry (`accessEntryReader`). So without a deviceId it proves nothing, until the entry's own
      // expiry, recorded with the leftover, has passed: a rotated entry keeps it (#1060 finding 24, 3A).
      if (!listed && !record.deviceId && expiresAtMs(record) > clock()) return fail('goneUnproven')
    } catch {
      return fail('unreachable')
    }
    if (listed) {
      if (!revokeEntry) return fail('revokeUnavailable')
      try {
        if (!(await revokeEntry(record)).gone) return fail('revokeNotConfirmed')
      } catch {
        return fail('unreachable')
      }
    }
    await connections.remove(id)
    return ok
  }

  /**
   * Remove every unfinished pairing at least 10 minutes old (§3.10: "removes it on its own after 10 minutes if still
   * unrotated"). Best effort: one that cannot be removed now stays listed, with "Remove", and is tried again next time.
   * Answers the ids removed.
   */
  public async sweepNotFinished(): Promise<string[]> {
    const now = this.ports.clock()
    const removed: string[] = []
    for (const record of await this.ports.connections.list()) {
      if (statusOf(record, now) !== 'notFinished') continue
      if (now - Date.parse(record.createdAt) < NOT_FINISHED_AFTER_MS) continue
      if ((await this.remove(record.id)).ok) removed.push(record.id)
    }
    return removed
  }

  /** Widen or narrow: compute the entry's new set from what it holds now, write it, read it back, record it. */
  private async changeMemories(
    id: string,
    target: (held: string[]) => string[],
    change: { add: string[]; remove: string[] }
  ): Promise<ActionResult> {
    const record = await this.ports.connections.get(id)
    if (!record) return fail('noRecord')
    if (record.state !== 'active' || statusOf(record, this.ports.clock()) === 'expired') return fail('notOffered')
    try {
      const entry = await entryOf(this.ports.access, record)
      if (!entry) return fail('notListed')
      const held = heldContexts(entry)
      const to = target(held)
      if (to.length === 0) return fail('lastMemory')
      const same = to.length === held.length && to.every((c) => held.includes(c))
      if (!same) await this.ports.access.narrowOrWidenCapabilities({ subject: entry.subject, act: { from: held, to } })
      const after = await entryOf(this.ports.access, record)
      if (!after) return fail('notListed')
      const now = heldContexts(after)
      if (change.add.some((c) => !now.includes(c)) || change.remove.some((c) => now.includes(c)))
        return fail('notApplied')
    } catch {
      return fail('unreachable')
    }
    await this.ports.connections.update(id, (r) => {
      const memoryContexts = [
        ...r.memoryContexts.filter((c) => !change.remove.includes(c)),
        ...change.add.filter((c) => !r.memoryContexts.includes(c)),
      ]
      const contexts = [
        ...r.contexts.filter((c) => !change.remove.includes(c)),
        ...change.add.filter((c) => !r.contexts.includes(c)),
      ]
      const pendingContexts = r.pendingContexts.filter((c) => !change.remove.includes(c) && !change.add.includes(c))
      return { ...r, memoryContexts, contexts, pendingContexts, lastReconciledAt: iso(this.ports.clock()) }
    })
    return ok
  }

  private async touch(id: string): Promise<void> {
    await this.ports.connections.update(id, (r) => ({ ...r, lastReconciledAt: iso(this.ports.clock()) }))
  }
}
