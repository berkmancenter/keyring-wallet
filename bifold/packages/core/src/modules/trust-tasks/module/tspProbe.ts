/**
 * The TSP 1.0 probe: how a phone learns that an upstream service (a VTA or a
 * community) answers TSP 1.0 when its DID document does not say which TSP
 * version it speaks. TSP 1.0 cutover plan §6.2, row 4, with the changes made
 * on its approval (2026-10-23).
 *
 * - **What.** One `XRFI` invite and one read-only task, both in TSP 1.0. The
 *   leg supplies the sending and the waiting; this module owns when a probe may
 *   run, what its outcome is called, what is kept, and what is said.
 * - **Never in a person's way.** The session's real asks go over DIDComm from
 *   the first one; a probe runs beside them, and only its answer moves later
 *   asks to TSP 1.0.
 * - **At most one per peer per hour**, whatever the last outcome. A record is
 *   written before anything is sent, so a phone reconnecting every few minutes
 *   on a poor link cannot probe at each reconnect.
 * - **Down is not wrong.** A silent probe is "unanswered" (24 h before the next
 *   probe) only if the peer answered something else in the same session;
 *   otherwise the peer may simply be down, and the outcome is "inconclusive"
 *   (the hourly cap only).
 *
 * @module trust-tasks/module/tspProbe
 */
import type { Agent } from '@credo-ts/core'

import { didPrefix } from './didPrefix'
import { releaseWarn } from './releaseLog'

export const LOG_PREFIX = '[TrustTasks:TspProbe]'

/** How long a probe waits for its answer: half a leg's 30 s answer clock. */
export const TSP_PROBE_TIMEOUT_MS = 15_000
/** The least time between two probes of one peer, whatever the outcome. */
export const TSP_PROBE_MIN_INTERVAL_MS = 60 * 60 * 1000
/** After a probe the peer did not answer while answering otherwise: no probe for a day. */
export const TSP_PROBE_UNANSWERED_BACKOFF_MS = 24 * 60 * 60 * 1000

export type TspProbeOutcome = 'started' | 'answered' | 'unanswered' | 'inconclusive'

export interface TspProbeRecord {
  did: string
  outcome: TspProbeOutcome
  /** When this outcome was recorded (ISO). */
  at: string
  /** No probe of this peer before this time (ISO). */
  notBefore: string
  /** The id of the `TSPTransport` service probed, when the document gives one. */
  serviceId?: string
}

export interface TspProbeStore {
  get(did: string): Promise<TspProbeRecord | undefined>
  put(record: TspProbeRecord): Promise<void>
}

const RECORD_TYPE = 'keyring/tsp-probe'

export class GenericRecordsTspProbeStore implements TspProbeStore {
  constructor(private readonly agent: Agent) {}

  async get(did: string): Promise<TspProbeRecord | undefined> {
    const [record] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, did })
    return record ? (record.content as unknown as TspProbeRecord) : undefined
  }

  async put(next: TspProbeRecord): Promise<void> {
    const [existing] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, did: next.did })
    if (existing) {
      existing.content = { ...next }
      await this.agent.genericRecords.update(existing)
    } else {
      await this.agent.genericRecords.save({ content: { ...next }, tags: { recordType: RECORD_TYPE, did: next.did } })
    }
  }
}

/** In-memory twin, for tests and for a session with no wallet at hand. */
export class MemoryTspProbeStore implements TspProbeStore {
  readonly records = new Map<string, TspProbeRecord>()
  async get(did: string) {
    return this.records.get(did)
  }
  async put(record: TspProbeRecord) {
    this.records.set(record.did, { ...record })
  }
}

/** The record an outcome leaves, and so when the next probe of this peer may run. */
export function probeRecord(
  did: string,
  outcome: TspProbeOutcome,
  serviceId: string | undefined,
  now: number
): TspProbeRecord {
  const wait = outcome === 'unanswered' ? TSP_PROBE_UNANSWERED_BACKOFF_MS : TSP_PROBE_MIN_INTERVAL_MS
  return {
    did,
    outcome,
    at: new Date(now).toISOString(),
    notBefore: new Date(now + wait).toISOString(),
    ...(serviceId ? { serviceId } : {}),
  }
}

/**
 * Whether a probe of this peer may run now. Never within the hour of the last
 * one. After an unanswered probe, not for a day — unless the peer's TSP
 * service changed, which is the evidence that it may have moved; even then,
 * not within the hour.
 */
export function probeAllowed(record: TspProbeRecord | undefined, serviceId: string | undefined, now: number): boolean {
  if (!record) return true
  const at = Date.parse(record.at)
  const notBefore = Date.parse(record.notBefore)
  // A record whose dates cannot be read holds nothing: read as no record,
  // rather than blocking this peer's probe for ever.
  if (Number.isNaN(at) || Number.isNaN(notBefore)) return true
  if (!(now - at >= TSP_PROBE_MIN_INTERVAL_MS)) return false
  if (record.outcome === 'unanswered' && serviceId && record.serviceId && serviceId !== record.serviceId) return true
  return now >= notBefore
}

export interface TspProbeRun {
  /** The peer probed. */
  did: string
  /** Its document's `TSPTransport` service id, when it has one. */
  serviceId?: string
  store: TspProbeStore
  /** For the Debug line a skipped probe leaves; outcomes are said in Release (`releaseWarn`). */
  logger: Pick<Agent['config']['logger'], 'info' | 'debug'>
  /** Send the invite and the read-only task, in TSP 1.0. */
  send: () => Promise<void>
  /** Resolve true when the probe's answer arrives within `timeoutMs`, else false. */
  waitForAnswer: (timeoutMs: number) => Promise<boolean>
  /** Whether the peer answered anything else in this session: the evidence it is up. */
  peerAnsweredOtherwise: () => boolean
  /** The probe was answered: the leg speaks TSP 1.0 to the peer for the rest of the session. */
  onAnswered: () => void
  timeoutMs?: number
  now?: () => number
}

/**
 * Run one probe, if one may run. Returns its outcome, or `'skipped'` when the
 * cap or back-off held it (said at Debug only: a skip is the cap working).
 */
export async function runTspProbe(run: TspProbeRun): Promise<TspProbeOutcome | 'skipped'> {
  const now = run.now ?? Date.now
  const timeoutMs = run.timeoutMs ?? TSP_PROBE_TIMEOUT_MS
  const last = await run.store.get(run.did).catch(() => undefined)
  if (!probeAllowed(last, run.serviceId, now())) {
    run.logger.debug(`${LOG_PREFIX} not probing ${run.did}: last probe ${last?.outcome} at ${last?.at}`)
    return 'skipped'
  }
  // Written before anything is sent: a reconnect while this probe waits finds it.
  await run.store.put(probeRecord(run.did, 'started', run.serviceId, now())).catch(() => undefined)
  const startedAt = now()
  let answered = false
  let sendFailed = false
  try {
    await run.send()
  } catch (error) {
    // Our failure, not the peer's silence: never "unanswered", never a day's back-off.
    sendFailed = true
    run.logger.debug(`${LOG_PREFIX} probe of ${run.did} could not be sent: ${error}`)
  }
  if (!sendFailed) answered = await run.waitForAnswer(timeoutMs).catch(() => false)
  const outcome: TspProbeOutcome = answered
    ? 'answered'
    : !sendFailed && run.peerAnsweredOtherwise()
      ? 'unanswered'
      : 'inconclusive'
  await run.store.put(probeRecord(run.did, outcome, run.serviceId, now())).catch(() => undefined)
  // Said in Release, by DID prefix only: a tester's report shows what each probe found.
  if (answered) {
    releaseWarn(
      `${LOG_PREFIX} ${didPrefix(run.did)} answered a TSP 1.0 probe in ${now() - startedAt} ms — TSP 1.0 for this session`
    )
    run.onAnswered()
  } else {
    releaseWarn(
      `${LOG_PREFIX} ${didPrefix(run.did)} did not answer a TSP 1.0 probe in ${Math.round(timeoutMs / 1000)} s — DIDComm for this session (${outcome})`
    )
  }
  return outcome
}
