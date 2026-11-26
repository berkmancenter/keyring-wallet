/**
 * The ballot box's HTTPS door: where a cast goes, and the receipt it is believed only once checked.
 *
 * The cast travels on its own connection, with no session and no identity attached (VTI-VOT-004): plain HTTPS to the
 * `TrustTaskHTTPS` service the ballot box's verified DID document names, the way room files reach a host's door, but
 * with nothing else sent to it first and no cookies. It never passes through the community.
 *
 * Resending the same cast after a lost answer is safe: the ballot box answers a replay of the same bytes with the
 * first receipt. A cast built again is not the same bytes (the agent signs each under a new one-time key), which is why
 * `pollService` keeps the built cast until its receipt is kept.
 *
 * @module polls/ballotBox
 */
import { POLL_TASK, parseCastAnswer } from './pollTasks'

const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'

/** The longest pause before a cast is sent, so its arrival is not timed to the moment the member tapped Vote (pnm's bound). */
export const MAX_CAST_DELAY_MS = 20_000

/** A random pause in [0, MAX_CAST_DELAY_MS). */
export function castDelayMs(random: () => number = Math.random): number {
  return Math.floor(random() * MAX_CAST_DELAY_MS)
}

/**
 * Why a cast did not end in a kept receipt.
 * - `unreachable`: no answer, or not one the ballot box signed as a refusal. The same cast is sent again later.
 * - `refused`: the ballot box said no (`code`). Sending the same cast again changes nothing.
 * - `receiptInvalid`: an answer that is not this cast's receipt from this ballot box. Not believed, and not retried at
 *   once: the same bytes would bring the same answer.
 */
export class CastFailure extends Error {
  constructor(
    readonly kind: 'unreachable' | 'refused' | 'receiptInvalid',
    detail: string,
    readonly code?: string
  ) {
    super(detail)
    this.name = 'CastFailure'
  }
}

export interface BallotBoxDoor {
  /** `<TrustTaskHTTPS base>/trust-tasks` for this ballot box. */
  endpointOf(ballotBoxDid: string): Promise<string>
  /** POST one document; the status and the JSON body, if any. */
  post(url: string, document: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  /** The document's proof checked against its signer's DID document; the signer when it verifies. */
  verify(document: Record<string, unknown>): Promise<{ ok: true; signer: string } | { ok: false; detail: string }>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A DID without its fragment: a proof's signer may name the method, `did:…#key-1`. */
const didOf = (id: string) => id.split('#')[0]

/**
 * Send a cast the agent built to the ballot box the poll names, and return its receipt: the whole signed answer, which
 * the agent keeps (`vta/pcs/voter/receipt`).
 *
 * The receipt is believed only once it is the ballot box's (its proof verifies and names the ballot box), answers this
 * cast (threaded to it, addressed back to the cast's one-time key) and is for this poll.
 */
export async function postCast(
  cast: Record<string, unknown>,
  ballotBoxDid: string,
  door: BallotBoxDoor
): Promise<Record<string, unknown>> {
  if (cast.recipient !== ballotBoxDid) throw new CastFailure('refused', 'the cast is addressed to another ballot box')
  let answer: { status: number; body: unknown }
  try {
    answer = await door.post(await door.endpointOf(ballotBoxDid), cast)
  } catch (e) {
    throw new CastFailure('unreachable', e instanceof Error ? e.message : String(e))
  }
  const doc = answer.body
  if (!isObject(doc)) throw new CastFailure('unreachable', `the ballot box answered ${answer.status} with no document`)
  const type = typeof doc.type === 'string' ? doc.type : ''
  if (type.startsWith(TASK_ERROR)) {
    const code = String((isObject(doc.payload) ? doc.payload.code : undefined) ?? 'refused')
    // A refusal the ballot box did not sign could be anyone's: not believed, and the cast is tried again.
    const signed = await door.verify(doc).catch(() => undefined)
    if (!signed?.ok || didOf(signed.signer) !== ballotBoxDid)
      throw new CastFailure('unreachable', `an unsigned refusal (${code})`)
    throw new CastFailure('refused', `the ballot box refused the cast (${code})`, code)
  }
  if (answer.status < 200 || answer.status >= 300)
    throw new CastFailure('unreachable', `the ballot box answered ${answer.status}`)
  const invalid = (why: string) => new CastFailure('receiptInvalid', why)
  if (type !== `${POLL_TASK.cast}#response`) throw invalid(`the answer is a ${type || 'document with no type'}`)
  const verdict = await door.verify(doc).catch((e: unknown) => ({ ok: false as const, detail: String(e) }))
  if (!verdict.ok) throw invalid(`the receipt's proof does not verify (${verdict.detail})`)
  if (didOf(verdict.signer) !== ballotBoxDid || doc.issuer !== ballotBoxDid)
    throw invalid('the receipt is not the ballot box’s')
  if (doc.threadId !== (cast.threadId ?? cast.id)) throw invalid('the receipt answers another cast')
  if (doc.recipient !== cast.issuer) throw invalid('the receipt is addressed to someone else')
  const payload = parseCastAnswer(doc.payload)
  const electionId = isObject(cast.payload) ? cast.payload.electionId : undefined
  if (!payload || payload.electionId !== electionId) throw invalid('the receipt is for another poll')
  return doc
}
