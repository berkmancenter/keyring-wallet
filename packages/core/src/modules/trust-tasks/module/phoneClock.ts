/**
 * Whether the person's own agent refused a document this phone just signed
 * because the phone's clock is wrong.
 *
 * Every task this phone sends its agent carries `issuedAt` and a proof
 * `created` from the phone's own clock, and the agent refuses either one
 * outside its window. The refusal carries no time of the agent's own, so this
 * reads the refusal, never the phone's clock (the thing in doubt), and the
 * words it leads to say the clock looks wrong without saying which way.
 *
 * Matched on the code AND the upstream wire words together. Line numbers are
 * for trust-tasks-rs 0.41.2 and affinidi-data-integrity 0.9.2, the versions
 * in VTI bf35b6787's Cargo.lock (VTI-Fig, vta-service 0.87.2); 0.39.0 and
 * 0.8.7 at 97fda9813, and 0.37.2 and 0.8.0 at f7b78e29d, word them the same
 * way, with the same 60 s skews.
 *
 * - `malformedRequest` with `FUTURE_ISSUED_AT`, "issuedAt is in the future
 *   beyond the consumer's skew tolerance" (the const at `freshness.rs:322`, its text at `:323`): `issuedAt`
 *   more than 60 s ahead (`DEFAULT_SKEW`, `:49`). The wire message is the
 *   variant's Display, "malformed request: <reason>" (`error.rs:608`).
 * - `expired` with `STALE_WIRE_MESSAGE`, "document is outside the consumer's
 *   acceptance window" (the const at `error.rs:844`, its text at `:845`): `issuedAt` older than the window plus
 *   60 s, and the VTA's window is 10 min (vti-common `acceptance.rs:61-62`,
 *   `trust_task/mod.rs:66`), checked on every task it is sent
 *   (vta-service `trust_tasks/mod.rs:1978`). Not the `expired` of a reached
 *   `expiresAt`, which is worded differently and is about the document's own
 *   stated end.
 * - `proofInvalid` with "Created date is in the future (beyond the 60s
 *   clock-skew allowance)" (affinidi-data-integrity `lib.rs:888`,
 *   `DEFAULT_CLOCK_SKEW` `options.rs:183`): the proof's `created` more than
 *   60 s ahead. The VTA checks `issuedAt` first, so this is the rarer one.
 *
 * Each pattern matches only part of the message, on purpose: the words come
 * after a variant's prefix ("malformed request: ") and go on with a section
 * reference ("(SPEC §7.2)"), either of which may change on its own. The
 * tests pin the whole messages these versions send.
 *
 * Anything else, including one of these codes with other words, is not the
 * clock. A VTA that words these differently falls back to what the phone did
 * before (the screen's own failure), never to a wrong claim about the clock.
 *
 * Structural on purpose, with no imports, as `deviceRefusalOf` reads codes:
 * suites that stub VtaClient or vtiAgent with hand-written export lists still
 * reach this.
 *
 * @module trust-tasks/module/phoneClock
 */

/** The refusals that say the phone's clock is wrong: each code, with the words that must come with it. */
const CLOCK_WORDS: Readonly<Record<string, RegExp>> = {
  malformedRequest: /issuedAt is in the future beyond the consumer's skew tolerance/,
  expired: /document is outside the consumer's acceptance window/,
  proofInvalid: /Created date is in the future \(beyond the \d+s clock-skew allowance\)/,
}

/** The agent's code when it refused a document for the phone's clock, else undefined. */
export function phoneClockRefusal(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'VtiRefusal') return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(CLOCK_WORDS, code)) return undefined
  return CLOCK_WORDS[code].test(error.message) ? code : undefined
}
