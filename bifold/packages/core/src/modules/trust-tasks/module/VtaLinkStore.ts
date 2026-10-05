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
  /**
   * The agent was created from this phone ("Create my agent"), so it belongs
   * to this phone: My Agent says so. Absent for an agent linked any other way,
   * which says nothing either way about who else administers it.
   */
  owner?: boolean
  /**
   * When this phone last reached the agent, and the first time since that its
   * address was answered "not found" (epoch ms). Not whether it is reachable
   * now — that stays live — but the history that says an agent is gone for
   * good across restarts (agentGone.ts).
   */
  lastOnlineAt?: number
  notFoundAt?: number
  /**
   * What the agent said it is called, when last asked. Kept so an agent that
   * is not the current one keeps its name across a restart: names were learned
   * only from a live session, and after a relaunch the other agent read "your
   * agent" (several-agents device check, R6, 10-04).
   */
  agentName?: AgentLabel
}

export interface VtaLinkStore {
  /** The current agent's link (the one this phone acts with), if any. */
  get(): Promise<VtaLink | undefined>
  /**
   * Keep a link: updates the one for the same agent, never another agent's.
   * The first agent kept becomes current; a later one waits for `use`.
   */
  set(link: VtaLink): Promise<void>
  /** Take the current agent's link out (unlinking); the oldest remaining becomes current. */
  clear(): Promise<void>
  /** Every linked agent, oldest first. Optional: a store without it holds one. */
  list?(): Promise<VtaLink[]>
  /** The current agent's DID. */
  current?(): Promise<string | undefined>
  /** Make a linked agent the current one. */
  use?(vtaDid: string): Promise<void>
  /** Take one agent's link out; if it was current, the oldest remaining becomes current. */
  remove?(vtaDid: string): Promise<void>
}

import type { AgentLabel } from './agentLabel'

const RECORD_TYPE = 'keyring.vta-link'
/** Which agent is current: one record, its DID. */
const CURRENT_TYPE = 'keyring.vta-link.current'

const oldestFirst = (a: VtaLink, b: VtaLink) => String(a.linkedAt).localeCompare(String(b.linkedAt))

/**
 * Every linked agent, one record each, in the wallet's encrypted store, and a
 * record naming the current one. A phone from before kept one record and no
 * marker: it reads as a list of one, current.
 */
export class GenericRecordsVtaLinkStore implements VtaLinkStore {
  constructor(private readonly agent: Agent) {}

  private records() {
    return this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE })
  }

  private async marker() {
    const [record] = await this.agent.genericRecords.findAllByQuery({ recordType: CURRENT_TYPE })
    return record
  }

  private async mark(vtaDid: string | undefined) {
    const record = await this.marker()
    if (!vtaDid) {
      if (record) await this.agent.genericRecords.delete(record)
      return
    }
    if (record) {
      record.content = { vtaDid }
      await this.agent.genericRecords.update(record)
      return
    }
    await this.agent.genericRecords.save({ content: { vtaDid }, tags: { recordType: CURRENT_TYPE } })
  }

  async list(): Promise<VtaLink[]> {
    return (await this.records()).map((r) => r.content as unknown as VtaLink).sort(oldestFirst)
  }

  async current(): Promise<string | undefined> {
    const links = await this.list()
    const marked = (await this.marker())?.content?.vtaDid as string | undefined
    if (marked && links.some((l) => l.vtaDid === marked)) return marked
    // No marker (a phone from before), or one naming a link that is gone: the oldest.
    return links[0]?.vtaDid
  }

  async get(): Promise<VtaLink | undefined> {
    const current = await this.current()
    return (await this.list()).find((l) => l.vtaDid === current)
  }

  async set(link: VtaLink): Promise<void> {
    const records = await this.records()
    const content = { ...link } as Record<string, unknown>
    const same = records.find((r) => (r.content as unknown as VtaLink).vtaDid === link.vtaDid)
    if (same) {
      same.content = content
      await this.agent.genericRecords.update(same)
    } else {
      await this.agent.genericRecords.save({ content, tags: { recordType: RECORD_TYPE, vtaDid: link.vtaDid } })
    }
    // The first agent kept is the current one; a later one waits for `use`.
    if (records.length === 0) await this.mark(link.vtaDid)
  }

  async use(vtaDid: string): Promise<void> {
    if (!(await this.list()).some((l) => l.vtaDid === vtaDid)) throw new Error('no link to that agent')
    await this.mark(vtaDid)
  }

  async remove(vtaDid: string): Promise<void> {
    const wasCurrent = (await this.current()) === vtaDid
    for (const record of await this.records()) {
      if ((record.content as unknown as VtaLink).vtaDid === vtaDid) await this.agent.genericRecords.delete(record)
    }
    if (wasCurrent) await this.mark((await this.list())[0]?.vtaDid)
  }

  async clear(): Promise<void> {
    const current = await this.current()
    if (current) await this.remove(current)
  }
}
