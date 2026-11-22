import Config from 'react-native-config'

/**
 * The e2e clock switch. Test builds carry `E2E_CLOCKS=short` in their env, so a
 * gate row can wait out the grant window and the auto-lock in about a minute
 * instead of ten. Nothing else sets it, and the store build never does: without
 * it every clock here is the real one.
 */
export const SHORT_GRANT_POLL_WINDOW_MS = 60 * 1000
/**
 * Half a minute: shorter than the 60 s grant window, so a gate row can idle past the lock while the window is still
 * open and see the hold keep it off (with the lock as long as the window, no moment shows that).
 */
export const SHORT_AUTO_LOCK_MINUTES = 0.5

/** True in a test build: E2E_CLOCKS set at all (`short`, or `real` for a real-clocks test build). Never in a store build. */
export const e2eClocksSet = (): boolean => Boolean(Config.E2E_CLOCKS?.trim())

/** True only in a test build that was built with `E2E_CLOCKS=short`. Read on every call, never cached. */
export const shortClocks = (): boolean => Config.E2E_CLOCKS === 'short'

/** How long a grant window really lasts in this build. */
export const effectiveGrantPollWindowMs = (realMs: number): number =>
  shortClocks() ? SHORT_GRANT_POLL_WINDOW_MS : realMs

/** The auto-lock default in minutes in this build. A time the person saved in Settings still wins over it. */
export const effectiveDefaultAutoLockMinutes = (realMinutes: number): number =>
  shortClocks() ? SHORT_AUTO_LOCK_MINUTES : realMinutes

/**
 * How many times faster a disappearing message's clock runs in a short-clock test build: 1 hour (the shortest timer)
 * becomes 60 s, so a two-phone run can watch a read message disappear. Store builds never set E2E_CLOCKS.
 */
export const SHORT_EXPIRY_DIVISOR = 60

/** A disappearing message's `expiresIn` (seconds, as sent and stored) as the time this build waits, in ms. */
export const effectiveExpiresInMs = (expiresInSeconds: number): number =>
  shortClocks() ? (expiresInSeconds * 1000) / SHORT_EXPIRY_DIVISOR : expiresInSeconds * 1000

/**
 * Twenty seconds: a gate row that holds a task for consent no approver will give (linkfail's held swap) re-asks the
 * agent three times instead of about twenty-two, so a night's held rows write a handful of requests to the runner, not
 * dozens (IN-560). Kept off the short auto-lock (30 s) on purpose: the refusal is on screen before the phone locks, so
 * the two never race. The gate's own approvals are given by pnm, whose requests never wait here.
 */
export const SHORT_CONSENT_WAIT_MS = 20 * 1000

/** How long a task held for consent waits for an approver in this build. */
export const effectiveConsentWaitMs = (realMs: number): number => (shortClocks() ? SHORT_CONSENT_WAIT_MS : realMs)
