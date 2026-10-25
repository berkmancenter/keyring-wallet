/**
 * When to apply a downloaded update without waiting for the next cold start:
 * the person comes back after a while and bifold has just locked them out
 * (bifold utils/otaApply, onReturnLocked). They land on the PIN screen anyway,
 * so reloading into the update then interrupts nothing they see.
 *
 * The reload itself: on Android, hot-updater's reload restarts the process, so
 * the launch is a cold start and the update watchdog (MainActivity) arms as on
 * any first launch. On iOS it is an in-process reload; React Native asks the
 * AppDelegate for the bundle URL again, so the watchdog there arms too
 * (AppDelegate.mm). But an in-process reload is the call that failed during
 * crash recovery on iOS, and a reload that failed would be rolled back as if the
 * update were bad. So iOS applies on return only once a healthy reload is proven
 * on a device (APPLY_ON_RETURN_IOS); until then it applies on the next cold start.
 */

/** How long the app must have been away before a return may apply an update. */
export const OTA_APPLY_AFTER_BACKGROUND_MS = 30 * 60 * 1000

/** Whether iOS applies on return: off until a healthy in-process reload is proven on a device. */
export const APPLY_ON_RETURN_IOS = false

export interface ApplyOnReturnInput {
  /** How long the app was away, from bifold's return-locked notice. */
  awayMs: number
  /** The update hot-updater has staged for its next launch (stagedUpdate.ts), if any. */
  stagedBundleId?: string
  /** The key an update was staged under when it is not this build's (stagedUpdate.ts), if any. */
  stagedUnderKey?: string
  /** The bundle running now (HotUpdater.getBundleId()). */
  runningBundleId?: string
  /** Why applying is blocked right now (bifold otaApplyBlockerReasons()). */
  blockers: string[]
  platform: string
  iosAllowed?: boolean
}

export type ApplyOnReturnDecision = { apply: true } | { apply: false; reason: string }

export const decideApplyOnReturn = ({
  awayMs,
  stagedBundleId,
  stagedUnderKey,
  runningBundleId,
  blockers,
  platform,
  iosAllowed = APPLY_ON_RETURN_IOS,
}: ApplyOnReturnInput): ApplyOnReturnDecision => {
  if (platform === 'ios' && !iosAllowed) return { apply: false, reason: 'iOS applies on the next cold start' }
  if (platform !== 'ios' && platform !== 'android') return { apply: false, reason: `not on ${platform}` }
  if (!stagedBundleId && stagedUnderKey) return { apply: false, reason: 'staged under another key' }
  if (!stagedBundleId) return { apply: false, reason: 'no update staged' }
  if (stagedBundleId === runningBundleId) return { apply: false, reason: 'the staged update is already running' }
  if (!(awayMs >= OTA_APPLY_AFTER_BACKGROUND_MS)) return { apply: false, reason: 'away for less than 30 min' }
  if (blockers.length > 0) return { apply: false, reason: `blocked: ${blockers.join(', ')}` }
  return { apply: true }
}
