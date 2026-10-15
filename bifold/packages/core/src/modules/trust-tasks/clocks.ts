/**
 * The real grant windows, in one file the Developer screen can read without
 * loading the screens. A test build with `E2E_CLOCKS=short` waits
 * `SHORT_GRANT_POLL_WINDOW_MS` instead (utils/e2eClocks).
 */

/** How long the phone keeps asking by itself whether the agent host granted it (VtaCreateAgent); after that, "Check again". */
export const GRANT_POLL_WINDOW_MS = 10 * 60 * 1000
/** How long a phone showing its code to another phone asks whether it has been added (VtaLink, #30). */
export const PHONE_GRANT_POLL_WINDOW_MS = 10 * 60 * 1000
