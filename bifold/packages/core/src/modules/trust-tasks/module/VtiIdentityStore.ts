/**
 * VtiIdentityStore — the identities this wallet holds towards the VTI world,
 * kept behind an interface so the two architectures the plan weighed (the phone
 * as its own agent, or the phone managing a VTA) and the two stores a phone
 * might use (Credo's records, a hardware-backed one later) stay swappable.
 *
 * Two kinds of identity live here:
 *
 *   - the **manager** identity a phone presents to *its* VTA — one per VTA,
 *     minted once and enrolled on the VTA's access list (§2.4 B of
 *     `community_vetting_subtask.md`);
 *   - a **persona** per community — a `did:webvh` the VTA minted and holds the
 *     keys for; the phone keeps only the DID and the VTA's key ids, plus the
 *     KMS ids of any key it has borrowed.
 *
 * Nothing secret is stored here. Keys live in the KMS (or the VTA); this is the
 * map from "which community / which VTA" to "which DID, which key ids".
 *
 * @module trust-tasks/module/VtiIdentityStore
 */

import type { Agent } from '@credo-ts/core'
import { currentAgentDid } from './currentAgent'
import { getKeyed, listKeyed, putKeyed, withKeyLock } from './keyedRecords'

export interface VtiManagerIdentity {
  /** The VTA this identity manages. */
  vtaDid: string
  /** The phone's own DID, enrolled on that VTA's ACL. */
  did: string
  createdAt: string
  /**
   * `temporary` while it is the key an admin granted for an hour at linking;
   * `permanent` once the phone has rotated its grant onto a long-lived key
   * (`acl/swap-key/0.1`). Absent on identities minted before linking existed.
   */
  stage?: 'temporary' | 'permanent'
  /**
   * A successor key sent to the VTA in an `acl/swap-key/0.1` whose outcome
   * this phone has not seen yet. Recorded before the swap leaves the phone, so
   * a lost answer (a timeout, a dropped socket, the app killed) cannot strand
   * the one key the VTA may now know: the VTA moves the grant onto it and
   * retires `did` (`operations::acl::swap_acl`). While it is set, which of the
   * two is live is settled by asking the VTA before anything else is done.
   * Absent on every record written before this existed, and once settled.
   */
  pendingNext?: { did: string; createdAt: string }
  /**
   * The key a completed swap retired, until the agent's approval rules have
   * been moved onto `did` (`VtaClient.carryApproversAcrossSwap`). Set when a
   * swap is seen to complete; cleared once the rules no longer name it, or
   * when this phone may not change them.
   */
  approversFrom?: string
}

export interface VtiPersona {
  /** The community this persona is presented to. */
  communityDid: string
  /** The VTA that minted and holds it. */
  vtaDid: string
  /** The persona's `did:webvh`. */
  did: string
  /** The VTA context the persona's keys were minted in. */
  contextId: string
  /** The VTA's ids for the persona's keys — never the keys. */
  vtaKeyIds: { signing: string; keyAgreement: string }
  /** The KMS ids of borrowed copies, when the phone holds any. */
  kmsKeyIds?: { signing?: string; keyAgreement?: string }
  /**
   * Copies kept in the wallet's store before persona keys moved to memory
   * (#10), recorded while they wait to be deleted: set before the copies move,
   * cleared once they are gone, so an interrupted move finishes next time.
   */
  legacyKmsKeyIds?: { signing?: string; keyAgreement?: string }
  label?: string
  createdAt: string
}

/** A persona mint's arguments, kept with its idempotency key so a retry is the same request. */
export type VtiMintRequest = { contextId: string; serverId?: string; didUrl?: string; label: string }

export interface VtiIdentityStore {
  getManager(vtaDid: string): Promise<VtiManagerIdentity | undefined>
  setManager(identity: VtiManagerIdentity): Promise<void>
  /**
   * Forget this phone's manager identity for a VTA, so nothing signs as it
   * again (unlinking). The VTA's ACL is not touched: a client cannot remove its
   * own entry (VTI-Q23). Optional: a store without it keeps the record.
   */
  forgetManager?(vtaDid: string): Promise<void>
  /** Every agent's manager identity this phone holds. */
  listManagers?(): Promise<VtiManagerIdentity[]>
  /**
   * This community's identity under an agent: `vtaDid`, else the agent this
   * phone acts with now (`currentAgentDid`). Identities are kept per agent and
   * community, so a second agent's identity for the same community is its own.
   */
  getPersona(communityDid: string, vtaDid?: string): Promise<VtiPersona | undefined>
  listPersonas(): Promise<VtiPersona[]>
  setPersona(persona: VtiPersona): Promise<void>
  /** Drop the persona record for a community (the VTA still holds the keys). */
  forgetPersona(communityDid: string, vtaDid?: string): Promise<void>
  /**
   * The idempotency key of a persona mint that has not yet been recorded as a
   * persona — kept so a retry (even after a restart) re-asks with the same key
   * and the VTA returns the first mint instead of minting an orphan (VTI-Q17).
   * Optional: a store without it mints with a fresh key each time, as before.
   */
  getMintKey?(communityDid: string): Promise<string | undefined>
  /**
   * `request` is the mint as first asked (context, server or URL, label). The
   * VTA compares a keyed retry's whole payload with the first one's and refuses
   * any difference ("idempotency key reused for a different request"), so a
   * retry must re-send it unchanged, not rebuild it.
   */
  setMintKey?(communityDid: string, key: string, request?: VtiMintRequest): Promise<void>
  /** The request saved with the key, when there is one (keys saved before 2026-09-25 have none). */
  getMintRequest?(communityDid: string): Promise<VtiMintRequest | undefined>
  clearMintKey?(communityDid: string): Promise<void>
}

const RECORD_TYPE = 'keyring/vti-identity'

/** A record key per agent and community; the community alone when no agent is known. */
export const agentScoped = (vtaDid: string | undefined, communityDid: string): string =>
  vtaDid ? `${vtaDid}|${communityDid}` : communityDid

/**
 * Credo generic records as the store: each identity is one record, tagged by
 * kind and key so it can be found without scanning, and kept in the same
 * encrypted store as everything else the wallet holds.
 */
export class GenericRecordsIdentityStore implements VtiIdentityStore {
  constructor(private readonly agent: Agent) {}

  // One record per key, whoever writes it and however many at once (keyedRecords).
  private find<T>(kind: string, key: string): Promise<T | undefined> {
    return getKeyed<T>(this.agent, RECORD_TYPE, kind, key)
  }

  private put(kind: string, key: string, content: Record<string, unknown>): Promise<void> {
    return putKeyed(this.agent, RECORD_TYPE, kind, key, content)
  }

  getManager(vtaDid: string) {
    return this.find<VtiManagerIdentity>('manager', vtaDid)
  }

  setManager(identity: VtiManagerIdentity) {
    return this.put('manager', identity.vtaDid, { ...identity })
  }

  listManagers() {
    return listKeyed<VtiManagerIdentity>(this.agent, RECORD_TYPE, 'manager')
  }

  async forgetManager(vtaDid: string) {
    const records = await this.agent.genericRecords.findAllByQuery({
      recordType: RECORD_TYPE,
      kind: 'manager',
      key: vtaDid,
    })
    for (const record of records) await this.agent.genericRecords.deleteById(record.id)
  }

  /**
   * Records whose content passes `which`, kept under (kind, key): removed under
   * the key's lock, so a write in progress is not undone.
   */
  private removeWhere(kind: string, key: string, which: (content: Record<string, unknown>) => boolean) {
    return withKeyLock(`${RECORD_TYPE}|${kind}|${key}`, async () => {
      const records = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind, key })
      for (const record of records) {
        if (which((record.content ?? {}) as Record<string, unknown>)) await this.agent.genericRecords.delete(record)
      }
    })
  }

  async getPersona(communityDid: string, vtaDid: string | undefined = currentAgentDid()) {
    if (vtaDid) {
      const own = await this.find<VtiPersona>('persona', agentScoped(vtaDid, communityDid))
      if (own) return own
    }
    // Kept by community alone, before identities were kept per agent: this
    // agent's, or any one when no agent is known. Moved under its agent at the
    // next write (setPersona).
    const kept = await this.find<VtiPersona>('persona', communityDid)
    return kept && (!vtaDid || kept.vtaDid === vtaDid) ? kept : undefined
  }

  async listPersonas() {
    return listKeyed<VtiPersona>(this.agent, RECORD_TYPE, 'persona')
  }

  async setPersona(persona: VtiPersona) {
    await this.put('persona', agentScoped(persona.vtaDid, persona.communityDid), { ...persona })
    // The same identity kept by community alone is now kept under its agent:
    // not listed twice.
    if (persona.vtaDid) await this.removeWhere('persona', persona.communityDid, (c) => c.vtaDid === persona.vtaDid)
  }

  async forgetPersona(communityDid: string, vtaDid: string | undefined = currentAgentDid()) {
    if (vtaDid) await this.removeWhere('persona', agentScoped(vtaDid, communityDid), () => true)
    await this.removeWhere('persona', communityDid, (c) => !vtaDid || c.vtaDid === vtaDid)
  }

  /** A mint is asked of the agent this phone acts with now, so its key is kept under that agent. */
  private async mintRecord(communityDid: string) {
    const vtaDid = currentAgentDid()
    const own = vtaDid
      ? await this.find<{ key?: string; request?: VtiMintRequest }>('mint-key', agentScoped(vtaDid, communityDid))
      : undefined
    return own ?? (await this.find<{ key?: string; request?: VtiMintRequest }>('mint-key', communityDid))
  }

  async getMintKey(communityDid: string) {
    return (await this.mintRecord(communityDid))?.key
  }

  setMintKey(communityDid: string, key: string, request?: VtiMintRequest) {
    return this.put('mint-key', agentScoped(currentAgentDid(), communityDid), { key, ...(request ? { request } : {}) })
  }

  async getMintRequest(communityDid: string) {
    return (await this.mintRecord(communityDid))?.request
  }

  async clearMintKey(communityDid: string) {
    const vtaDid = currentAgentDid()
    if (vtaDid) await this.removeWhere('mint-key', agentScoped(vtaDid, communityDid), () => true)
    await this.removeWhere('mint-key', communityDid, () => true)
  }
}
