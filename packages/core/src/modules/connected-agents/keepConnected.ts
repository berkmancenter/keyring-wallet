/**
 * "Keep it connected" (docs/plans/agent-connect-plan.md §7.28, D42): a temporary agent's entry is made permanent, the
 * record becomes persistent, and its VDC grant is re-issued for the full 7 days.
 *
 * Built to the source reading of VTI `97fda9813` (`acl_v0_3.rs:984` maps an explicit `"expiresAt": null` to
 * `clear_expiry`, and `acl.rs:1239-1240` sets `entry.expires_at = None`), and shipped unoffered: §7.28 asks for the lab
 * measurement first, and until {@link KEEP_CONNECTED_MEASURED} is flipped the act is absent and Extend renews (the
 * plan's fallback). "Not now" is the screen closing its sheet, so it has nothing here.
 *
 * Not `narrowOrWidenCapabilities`: its `AgentAccessChange.expiresAt` refuses null by design (#1082).
 *
 * @module connected-agents/keepConnected
 */

import type { AgentAccessPort } from './carriage'
import { personaSigningKeyId } from './driver'
import { readAgentEntry } from './entryRead'
import { statusOf } from './status'
import type { AgentConnection } from './types'
import { buildVdcGrant, issueVdc, vdcScopeFor, vtaVdcSigner, type VdcSignPort } from './vdc'

/** Whether the lab measured that an explicit null clears an entry's expiry (§7.28). Flipped after d3's measurement. */
export const KEEP_CONNECTED_MEASURED = false

/** `acl/update` at 0.3, the version that clears an expiry with an explicit null. Pinned where it is sent. */
export const ACL_UPDATE_03 = 'https://trusttasks.org/spec/acl/update/0.3'

/** The record's own conditions for the act: an `active` temporary agent that has not expired. */
function recordAllows(record: AgentConnection, now: number): boolean {
  return record.state === 'active' && record.grantType === 'temporary' && statusOf(record, now) !== 'expired'
}

/**
 * Whether the details offer "Keep it connected" for `record` at `now`: only once the act is measured, and only for an
 * `active` temporary agent that has not expired. While this is false the act is absent and Extend renews.
 */
export function keepConnectedOffered(record: AgentConnection, now: number): boolean {
  return KEEP_CONNECTED_MEASURED && recordAllows(record, now)
}

export type KeepConnectedPorts = {
  clock: () => number
  access: Pick<AgentAccessPort, 'findAgentEntries'>
  /** A Trust Task on the owner's VTA; the services send it without waiting on an approval (backlog fb-5). */
  task(type: string, payload: Record<string, unknown>): Promise<unknown>
  /** `keys/sign-document/0.1` on the owner's VTA. */
  vdcSign: VdcSignPort
  /** The persona's signing key id; `personaSigningKeyId` when absent. */
  signingKeyIdOf?: (persona: string) => string
  connections: {
    get(id: string): Promise<AgentConnection | undefined>
    update(id: string, change: (r: AgentConnection) => AgentConnection): Promise<AgentConnection | undefined>
  }
}

/**
 * Why the act did not finish. The screens word each code (`KeepConnected*` keys); none carries copy.
 * - `noRecord`: no record by that id.
 * - `notOffered`: the record is not an `active` temporary agent that has not expired (also when it left that state
 *   while the entry was being changed).
 * - `notListed`: a complete read found no entry for the agent.
 * - `unreachable`: the entry could not be read, or the update was not answered.
 * - `notApplied`: the update was answered but the read-back does not show the entry listed without an expiry. The record
 *   is left as it was.
 * - `vdc`: the entry and the record are persistent, but the new grant could not be issued or stored. The record stays
 *   persistent; the re-issue policy replaces the grant later.
 */
export type KeepConnectedResult =
  | { ok: true }
  | { ok: false; code: 'noRecord' | 'notOffered' | 'notListed' | 'unreachable' | 'notApplied' | 'vdc' }

const fail = (code: Extract<KeepConnectedResult, { ok: false }>['code']): KeepConnectedResult => ({ ok: false, code })

/**
 * Keep the agent `id` connected. It does not check {@link KEEP_CONNECTED_MEASURED}: the screen asks
 * {@link keepConnectedOffered} first. It does check the record's own conditions.
 *
 * 1. Read the entry (`readAgentEntry`): not listed is `notListed`, an unknown read `unreachable`.
 * 2. `acl/update/0.3` with exactly `{ subject, expiresAt: null }`; a throw is `unreachable`.
 * 3. Read back: the entry must be listed with no `expiresAt`, else `notApplied`.
 * 4. The record becomes persistent, with `persistentElectedAt` and no `expiresAt`.
 * 5. A new grant with no entry expiry (7 days) is issued and stored; a failure is `vdc`.
 */
export async function keepConnected(ports: KeepConnectedPorts, id: string): Promise<KeepConnectedResult> {
  const now = ports.clock()
  const record = await ports.connections.get(id)
  if (!record) return fail('noRecord')
  if (!recordAllows(record, now)) return fail('notOffered')

  const read = await readAgentEntry(ports.access, record)
  if (read.kind === 'unknown') return fail('unreachable')
  if (read.kind === 'notListed') return fail('notListed')

  try {
    // version-pinned: an agent's entry is written at acl 0.3 only, and an explicit null is 0.3's form
    await ports.task(ACL_UPDATE_03, { subject: read.entry.subject, expiresAt: null })
  } catch {
    return fail('unreachable')
  }

  const after = await readAgentEntry(ports.access, record)
  if (after.kind !== 'listed' || after.entry.expiresAt !== undefined) return fail('notApplied')

  const electedAt = new Date(now).toISOString()
  const persistent = await ports.connections.update(id, (r) => {
    if (r.state !== 'active') return r
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { expiresAt: _expiresAt, ...rest } = r
    return { ...rest, grantType: 'persistent', persistentElectedAt: electedAt }
  })
  if (!persistent) return fail('noRecord')
  if (persistent.grantType !== 'persistent' || persistent.persistentElectedAt !== electedAt) return fail('notOffered')

  try {
    const keyId = (ports.signingKeyIdOf ?? personaSigningKeyId)(persistent.ownerPersonaDid)
    const unsigned = buildVdcGrant({
      personaDid: persistent.ownerPersonaDid,
      agentDid: persistent.agentDid,
      scope: vdcScopeFor({ memory: persistent.memoryContexts.length > 0, roomAdded: false }),
      now,
    })
    const grant = (await issueVdc(unsigned, vtaVdcSigner(ports.vdcSign, keyId))) as unknown as Record<string, unknown>
    const written = await ports.connections.update(id, (r) => (r.state === 'active' ? { ...r, vdcGrant: grant } : r))
    if (written?.vdcGrant !== grant) return fail('vdc')
  } catch {
    return fail('vdc')
  }
  return { ok: true }
}
