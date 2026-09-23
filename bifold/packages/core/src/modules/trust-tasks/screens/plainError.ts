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
 * An agent or a community that did not answer is the common case by a
 * distance, and it is usually transient — a reply lost before the transport
 * could carry it (VTI-43). It is worth trying again, and saying so.
 */
const NO_ANSWER = /did not answer|no answer|timed? ?out|timeout/i
/** The phone is not allowed to do this; trying again cannot help. */
const NOT_ALLOWED = /not in (the )?ACL|unauthori[sz]ed|forbidden|permission denied|revoked/i
/** The agent cannot publish a new identity; only its operator can fix that. */
const NO_DID_HOST = /no DID host/i
/** Nothing to reach: a wrong address, a service that is down, no network. */
const UNREACHABLE = /network|fetch failed|ECONN|ENOTFOUND|unreachable|could not resolve|did not resolve/i

export function plainError(error: unknown): PlainError {
  const detail = error instanceof Error ? error.message : String(error)
  const bare = withoutOurJargon(detail)
  if (NOT_ALLOWED.test(bare)) return { line: 'Errors.NotAllowed', detail, retry: false }
  if (NO_DID_HOST.test(bare)) return { line: 'Errors.NoDidHost', detail, retry: false }
  if (NO_ANSWER.test(bare)) return { line: 'Errors.NoAnswer', detail, retry: true }
  if (UNREACHABLE.test(bare)) return { line: 'Errors.Unreachable', detail, retry: true }
  // Something we have not met. Say that honestly rather than showing the raw
  // text and calling it an explanation; the text is still one tap away.
  return { line: 'Errors.Unknown', detail, retry: true }
}
