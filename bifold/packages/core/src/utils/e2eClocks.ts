import Config from 'react-native-config'

/**
 * The e2e clock switch. Test builds carry `E2E_CLOCKS=short` in their env, so a
 * gate row can wait out the grant window and the auto-lock in about a minute
 * instead of ten. Nothing else sets it, and the store build never does: without
 * it every clock here is the real one.
 */
export const SHORT_GRANT_POLL_WINDOW_MS = 60 * 1000
export const SHORT_AUTO_LOCK_MINUTES = 1

/** True only in a test build that was built with `E2E_CLOCKS=short`. Read on every call, never cached. */
export const shortClocks = (): boolean => Config.E2E_CLOCKS === 'short'

/** How long a grant window really lasts in this build. */
export const effectiveGrantPollWindowMs = (realMs: number): number =>
  shortClocks() ? SHORT_GRANT_POLL_WINDOW_MS : realMs

/** The auto-lock default in minutes in this build. A time the person saved in Settings still wins over it. */
export const effectiveDefaultAutoLockMinutes = (realMinutes: number): number =>
  shortClocks() ? SHORT_AUTO_LOCK_MINUTES : realMinutes
