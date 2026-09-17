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

export interface VtiManagerIdentity {
  /** The VTA this identity manages. */
  vtaDid: string
  /** The phone's own DID, enrolled on that VTA's ACL. */
  did: string
  createdAt: string
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
  label?: string
  createdAt: string
}

export interface VtiIdentityStore {
  getManager(vtaDid: string): Promise<VtiManagerIdentity | undefined>
  setManager(identity: VtiManagerIdentity): Promise<void>
  getPersona(communityDid: string): Promise<VtiPersona | undefined>
  listPersonas(): Promise<VtiPersona[]>
  setPersona(persona: VtiPersona): Promise<void>
}

const RECORD_TYPE = 'keyring/vti-identity'

/**
 * Credo generic records as the store: each identity is one record, tagged by
 * kind and key so it can be found without scanning, and kept in the same
 * encrypted store as everything else the wallet holds.
 */
export class GenericRecordsIdentityStore implements VtiIdentityStore {
  constructor(private readonly agent: Agent) {}

  private async find<T>(kind: string, key: string): Promise<T | undefined> {
    const records = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind, key })
    return records[0]?.content as T | undefined
  }

  private async put(kind: string, key: string, content: Record<string, unknown>): Promise<void> {
    const existing = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind, key })
    if (existing[0]) {
      existing[0].content = content
      await this.agent.genericRecords.update(existing[0])
      return
    }
    await this.agent.genericRecords.save({ content, tags: { recordType: RECORD_TYPE, kind, key } })
  }

  getManager(vtaDid: string) {
    return this.find<VtiManagerIdentity>('manager', vtaDid)
  }

  setManager(identity: VtiManagerIdentity) {
    return this.put('manager', identity.vtaDid, { ...identity })
  }

  getPersona(communityDid: string) {
    return this.find<VtiPersona>('persona', communityDid)
  }

  async listPersonas() {
    const records = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: 'persona' })
    return records.map((record) => record.content as unknown as VtiPersona)
  }

  setPersona(persona: VtiPersona) {
    return this.put('persona', persona.communityDid, { ...persona })
  }
}
