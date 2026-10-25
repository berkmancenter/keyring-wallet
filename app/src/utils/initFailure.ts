/**
 * What the start-up error card says about a failed agent start.
 *
 * Starting the agent connects to the message service (the DIDComm mediator).
 * When that service does not answer, Credo fails its didcomm start-up step
 * and the card used to show Credo's own sentence — "Error during call to
 * 'onInitializeContext' method in module 'didcomm' … TimeoutError" — under
 * "Oops! Something went wrong" (IN-75, a first run while the hosted mediator
 * was down). That is not the person's doing and not something wrong with
 * their wallet, so it gets its own plain words and Retry; the raw text stays
 * in the problem report, which is built from the error itself.
 */

/** The didcomm module's start-up step, as Credo names it when it fails. */
const DIDCOMM_START = /onInitializeContext.*\bdidcomm\b/i

/** The service did not answer, or could not be reached at all. */
const NO_ANSWER =
  /timeout|timed out|network request failed|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|websocket|unreachable|could not connect/i

const chainOf = (error: unknown): Error[] => {
  const chain: Error[] = []
  let current: unknown = error
  while (current instanceof Error && !chain.includes(current) && chain.length < 8) {
    chain.push(current)
    current = (current as Error & { cause?: unknown }).cause
  }
  return chain
}

/**
 * Whether a failed start is the message service not answering: the didcomm
 * start-up step failed, and a cause under it is a timeout or a network
 * failure. A timeout anywhere else, or a didcomm failure of another kind, is
 * not claimed.
 */
export function messageServiceUnreachable(error: unknown): boolean {
  const chain = chainOf(error)
  const step = chain.findIndex((e) => DIDCOMM_START.test(e.message))
  if (step < 0) return false
  return chain
    .slice(step)
    .some((e) => !DIDCOMM_START.test(e.message) && (e.name === 'TimeoutError' || NO_ANSWER.test(e.message)))
}

export interface InitFailureWords {
  /** Translation keys for the card. */
  title: string
  description: string
  /** Whether the card offers the error's own text behind "details". */
  showRawText: boolean
}

export function initFailureWords(error: unknown): InitFailureWords {
  if (messageServiceUnreachable(error)) {
    return { title: 'Init.MessageServiceTitle', description: 'Init.MessageServiceBody', showRawText: false }
  }
  return { title: 'Error.Title2026', description: 'Error.Message2026', showRawText: true }
}

/**
 * The card's words as the person read them, for the problem report's "Shown
 * to the user" line: a report says what was on the screen, not the error's
 * own description.
 */
export function initFailureShown(words: InitFailureWords, t: (key: string) => string): string {
  return `${t(words.title)}. ${t(words.description)}`
}
