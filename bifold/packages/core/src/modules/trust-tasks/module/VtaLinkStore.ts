/**
 * VtaLinkStore — which agent this phone is linked to.
 *
 * Linking is something the person does once, by scanning an enrolment offer
 * (plan §5.1), so the agent is no longer fixed per build: the link record
 * names it. Only what survives a restart is kept here — the agent, its label,
 * when the phone was linked. Whether the agent is reachable right now is live
 * state and belongs to the controller, never to this record (plan §4.2).
 *
 * @module trust-tasks/module/VtaLinkStore
 */

import type { Agent } from '@credo-ts/core'

export interface VtaLink {
  /** The agent this phone manages. */
  vtaDid: string
  /** The agent host's human name, from the enrolment offer. */
  label: string
  linkedAt: string
  /** When the person dismissed the first-link introduction; absent until then. */
  introSeenAt?: string
}

export interface VtaLinkStore {
  get(): Promise<VtaLink | undefined>
  set(link: VtaLink): Promise<void>
  clear(): Promise<void>
}

const RECORD_TYPE = 'keyring.vta-link'

/** One record, the current link, in the wallet's encrypted store. */
export class GenericRecordsVtaLinkStore implements VtaLinkStore {
  constructor(private readonly agent: Agent) {}

  private records() {
    return this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE })
  }

  async get(): Promise<VtaLink | undefined> {
    const [record] = await this.records()
    return record?.content as unknown as VtaLink | undefined
  }

  async set(link: VtaLink): Promise<void> {
    const [existing] = await this.records()
    const content = { ...link } as Record<string, unknown>
    if (existing) {
      existing.content = content
      await this.agent.genericRecords.update(existing)
      return
    }
    await this.agent.genericRecords.save({ content, tags: { recordType: RECORD_TYPE } })
  }

  async clear(): Promise<void> {
    for (const record of await this.records()) await this.agent.genericRecords.delete(record)
  }
}
