/**
 * The last "Send me a test request" outcome, per agent, kept on the phone.
 *
 * A test the agent let through (it did not ask) sends nothing to the phone,
 * so a person who sends one and puts the phone away concludes "no
 * notifications" — twice, for the sign-in reporter (IN-277). A line on
 * screen was missed, so the outcome is kept: Ask me before… shows it until it
 * is dismissed or the next test replaces it, and says it again beside the
 * button. It records only what the agent did, never why: no task reports
 * whether approvals are enforced where the agent is hosted.
 *
 * @module trust-tasks/module/testRequestOutcome
 */
import type { Agent } from '@credo-ts/core'

export interface TestRequestOutcome {
  vtaDid: string
  /** `held`: the agent asked. `letThrough`: it did not, and created the test context. */
  kind: 'held' | 'letThrough'
  /** For `letThrough`: whether the test context was deleted again. */
  cleanedUp?: boolean
  at: string
  /** The person closed the card; the line beside the button still says it. */
  dismissed?: boolean
}

const RECORD_TYPE = 'keyring.vta-test-request'

/** Each agent's last test outcome, in the wallet's encrypted store. */
export class GenericRecordsTestRequestStore {
  constructor(private readonly agent: Agent) {}

  private async record(vtaDid: string) {
    const [found] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, vtaDid })
    return found
  }

  async get(vtaDid: string): Promise<TestRequestOutcome | undefined> {
    const content = (await this.record(vtaDid))?.content as Partial<TestRequestOutcome> | undefined
    // Read as an outcome only when it is one: a record of another shape says nothing.
    if (!content || (content.kind !== 'held' && content.kind !== 'letThrough') || content.vtaDid !== vtaDid) {
      return undefined
    }
    return content as TestRequestOutcome
  }

  /** The newest test replaces the last. */
  async set(outcome: TestRequestOutcome): Promise<void> {
    const content = { ...outcome } as Record<string, unknown>
    const found = await this.record(outcome.vtaDid)
    if (found) {
      found.content = content
      await this.agent.genericRecords.update(found)
    } else {
      await this.agent.genericRecords.save({ content, tags: { recordType: RECORD_TYPE, vtaDid: outcome.vtaDid } })
    }
  }

  async dismiss(vtaDid: string): Promise<TestRequestOutcome | undefined> {
    const current = await this.get(vtaDid)
    if (!current) return undefined
    const next = { ...current, dismissed: true }
    await this.set(next)
    return next
  }
}

/** The card: a test let through, not yet dismissed. */
export const letThroughCardShown = (outcome: TestRequestOutcome | undefined): boolean =>
  outcome?.kind === 'letThrough' && !outcome.dismissed

/** Beside the button, before the next press: the last test was let through. */
export const lastTestLetThrough = (outcome: TestRequestOutcome | undefined): boolean => outcome?.kind === 'letThrough'
