/**
 * What to show a person when something failed, and where to keep the rest.
 *
 * A tester on a shipped build met this, verbatim, on the screen where they
 * were making an identity (report #17, 2026-09-22):
 *
 *   [TrustTasks:VtaClient] the VTA did not answer
 *   https://trusttasks.org/spec/vta/webvh/dids/create/1.0
 *
 * Every part of that is for us: the module prefix, the task URI, the verb
 * "answer". None of it tells the person what happened or what to do, and the
 * thing they needed to know — tap it again, it usually works — was not there.
 *
 * So a failure has two forms. The **sentence** says what happened in the words
 * of someone who does not know what a task URI is, and names the one action
 * worth taking. The **detail** is the original text, kept for Details and for a
 * feedback report, because the people who read those need exactly what the
 * sentence throws away.
 *
 * @module trust-tasks/screens/plainError
 */

export interface PlainError {
  /** The i18n key of the sentence to show. */
  line: string
  /** The original message: under Details, and in a report, never on its own. */
  detail: string
  /** Whether trying the same thing again is worth suggesting. */
  retry: boolean
}

/** Strip what only we can read: our log prefixes, and bare task URIs. */
function withoutOurJargon(detail: string): string {
  return detail
    .replace(/\[[A-Za-z]+:[A-Za-z]+\]\s*/g, '')
    .replace(/https?:\/\/\S*trusttasks\.org\/\S*/g, '')
    .trim()
}

/**
 * A request the community was sent and has not answered yet
 * (`VtiSentNoAnswer`). Not "your agent didn't answer, try again": it was the
 * community that owes the answer, it may well have received the request — a
 * submit it deferred looks exactly like this — and sending it again is a
 * second request. So it is its own sentence, with no retry offered.
 */
const SENT_NO_ANSWER = /the community has not answered yet/i
/**
 * An agent or a community that did not answer is the common case by a
 * distance, and it is usually transient — a reply lost before the transport
 * could carry it (VTI-43). It is worth trying again, and saying so.
 */
const NO_ANSWER = /did not answer|no answer|timed? ?out|timeout/i
/** The phone is not allowed to do this; trying again cannot help. */
const NOT_ALLOWED = /not in (the )?ACL|unauthori[sz]ed|forbidden|permission denied|revoked/i
/** The agent cannot publish a new identity; only its operator can fix that. */
const NO_DID_HOST = /no DID host/i

/**
 * A join-request refusal, by the code's last part — never the prose, which a
 * community words as it likes (vtiAgent joinRequestRefusal reads it the same
 * way). Each one says what already stands, so none is worth retrying.
 */
const JOIN_REFUSALS: Record<string, string> = {
  requestAlreadyOpen: 'Errors.AlreadyAsked',
  alreadyDecided: 'Errors.AlreadyDecided',
  notFound: 'Errors.NothingOpen',
  notAwaitingEvidence: 'Errors.NotAwaitingEvidence',
}

/** Nothing to reach: a wrong address, a service that is down, no network. */
const UNREACHABLE = /network|fetch failed|ECONN|ENOTFOUND|unreachable|could not resolve|did not resolve/i

export function plainError(error: unknown): PlainError {
  const detail = error instanceof Error ? error.message : String(error)
  const bare = withoutOurJargon(detail)
  const code = String((error as { code?: unknown } | undefined)?.code ?? '')
    .split(':')
    .pop()
  if (code && JOIN_REFUSALS[code]) return { line: JOIN_REFUSALS[code], detail, retry: false }
  // By name, not `instanceof`: this module stays free of the agent's imports.
  if ((error instanceof Error && error.name === 'VtiSentNoAnswer') || SENT_NO_ANSWER.test(bare)) {
    return { line: 'Errors.SentNoAnswer', detail, retry: false }
  }
  if (NOT_ALLOWED.test(bare)) return { line: 'Errors.NotAllowed', detail, retry: false }
  if (NO_DID_HOST.test(bare)) return { line: 'Errors.NoDidHost', detail, retry: false }
  if (NO_ANSWER.test(bare)) return { line: 'Errors.NoAnswer', detail, retry: true }
  if (UNREACHABLE.test(bare)) return { line: 'Errors.Unreachable', detail, retry: true }
  // Something we have not met. Say that honestly rather than showing the raw
  // text and calling it an explanation; the text is still one tap away.
  return { line: 'Errors.Unknown', detail, retry: true }
}
