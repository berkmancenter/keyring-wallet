/**
 * Keep the agent's wake channel in step with the phone's notification
 * permission.
 *
 * A person can block Keyring's notifications in the phone's own Settings
 * while Keyring's switch stays on. The agent then still holds a wake channel
 * for this phone, and every wake is spent at Apple or Google and dropped on the
 * phone (measured on an iPhone 11 with TestFlight 235: delivered, then
 * "Saving notification: NO"). So, at launch and whenever the app comes back to
 * the foreground:
 *
 * - permission now denied, switch on: clear the wake channel, and remember
 *   that it was cleared for this reason;
 * - permission granted again after that: make the phone wakeable again.
 *
 * Keyring's own switch is left as the person set it: it says what they want,
 * and Settings → Notifications already shows the blocked state.
 */
import type { PushWakeOutcome } from './pushWake'

export type OsPermission = 'granted' | 'denied' | 'unknown'

export interface PermissionWatchDeps {
  /** Whether the person has Keyring's notifications switch on. */
  optedIn(): boolean
  /** Whether this phone is linked to an agent, with the link up. */
  linked(): boolean
  /** The phone's notification permission, without asking. */
  permission(): Promise<OsPermission>
  /** Whether the wake channel was cleared because the permission was denied. Kept across launches. */
  clearedForDenial: { get(): Promise<boolean>; set(cleared: boolean): Promise<void> }
  clearWake(): Promise<unknown>
  enableWake(): Promise<PushWakeOutcome>
  log(message: string, data?: Record<string, unknown>): void
  /** The clock, in ms; replaceable in tests. */
  now?: () => number
}

/** What started a check: the watcher's first run, a return to the foreground, or the agent link coming up. */
export type CheckTrigger = 'start' | 'foreground' | 'link-up'

/**
 * How far apart two denied readings must be before the wake channel is
 * cleared. A clear the person did not ask for silently stops their
 * notifications: on 10-06 (GS-1) an iPhone on build 238 read "denied" once at
 * the link-up after a cold start, cleared a channel set a second earlier, and
 * received no request after that, with nobody touching a setting. A start-up
 * burst (launch, foreground, link-up) can span tens of seconds (37 s there),
 * so the second reading must come from a later check at least this long after
 * the first. A real block in the phone's settings persists and is cleared at
 * the next check past the gap; meanwhile only wakes the phone would drop anyway
 * are lost.
 */
export const DENIAL_CONFIRM_GAP_MS = 30_000

/** The first denied reading not yet confirmed: when, and at which check. */
export interface DenialMark {
  at: number
  trigger: CheckTrigger
}

/** Kept by one watcher between its checks. */
export interface DenialState {
  mark?: DenialMark
}

export type ReconcileResult = 'none' | 'cleared' | 'restored' | 'failed' | 'marked'

/**
 * Compare the permission with the wake channel once, and act on a difference.
 * With `denial` (as the watcher passes it), a denied reading clears only when
 * it confirms an earlier one at least DENIAL_CONFIRM_GAP_MS before; without it,
 * one reading is enough.
 */
export async function reconcilePushPermission(
  deps: PermissionWatchDeps,
  denial?: { state: DenialState; trigger: CheckTrigger }
): Promise<ReconcileResult> {
  const cleared = await deps.clearedForDenial.get()
  if (!deps.optedIn()) {
    // Switched off in Keyring: the switch cleared the channel itself, and
    // turning it on again registers anew. Nothing is owed here.
    if (cleared) await deps.clearedForDenial.set(false)
    if (denial) denial.state.mark = undefined
    return 'none'
  }
  // Not linked (as at a cold start before the saved link is restored): no
  // reading, so no mark either.
  if (!deps.linked()) return 'none'

  const permission = await deps.permission()
  if (denial && permission !== 'denied') denial.state.mark = undefined
  try {
    if (permission === 'denied' && !cleared) {
      if (denial) {
        const now = (deps.now ?? Date.now)()
        const mark = denial.state.mark
        if (!mark || now - mark.at < DENIAL_CONFIRM_GAP_MS) {
          if (!mark) denial.state.mark = { at: now, trigger: denial.trigger }
          deps.log('push wake: denied, waiting for a later check before clearing', {
            at: denial.trigger,
            firstSeenAt: (mark ?? denial.state.mark)?.trigger,
          })
          return 'marked'
        }
        denial.state.mark = undefined
        await deps.clearWake()
        await deps.clearedForDenial.set(true)
        deps.log('push wake: cleared, notifications blocked in the phone settings', {
          confirmedAt: denial.trigger,
          firstSeenAt: mark.trigger,
          apartMs: now - mark.at,
        })
        return 'cleared'
      }
      await deps.clearWake()
      await deps.clearedForDenial.set(true)
      deps.log('push wake: cleared, notifications blocked in the phone settings')
      return 'cleared'
    }
    if (permission === 'granted' && cleared) {
      const outcome = await deps.enableWake()
      deps.log('push wake: enable, notifications allowed again', { status: outcome.status })
      // No token yet: try again at the next foreground.
      if (outcome.status === 'noToken') return 'failed'
      await deps.clearedForDenial.set(false)
      return 'restored'
    }
  } catch (e) {
    deps.log('push wake: permission follow-up failed', {
      permission,
      error: e instanceof Error ? e.message : String(e),
    })
    return 'failed'
  }
  return 'none'
}

/** The parts of React Native's `AppState` this uses. */
export interface AppStateSource {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void }
}

/** Changes to the agent link (bifold's `vtaAgent.subscribe`). */
export type LinkChanges = (listener: () => void) => () => void

/**
 * Reconcile now, every time the app becomes active, and every time the agent
 * link comes up (`linked()` turns true); returns the unsubscribe. A check still
 * running when the next one is due is not doubled.
 *
 * The link matters at a cold start. Android kills Keyring when notifications
 * are switched off in its settings, so the next open is a cold start, and there
 * the first check runs before the saved link is restored: not linked yet,
 * nothing done. Measured on an Android emulator (10-04): the clear came only on
 * the next background-foreground. Checking again when the link comes up clears
 * it on that first open.
 */
export function watchPushPermission(
  deps: PermissionWatchDeps,
  appState: AppStateSource,
  linkChanges?: LinkChanges
): () => void {
  let running = false
  // Per watcher: a second instance would have to confirm on its own.
  const denial: DenialState = {}
  const check = (trigger: CheckTrigger) => {
    if (running) return
    running = true
    void reconcilePushPermission(deps, { state: denial, trigger })
      .catch((e) =>
        deps.log('push wake: permission check failed', { error: e instanceof Error ? e.message : String(e) })
      )
      .finally(() => {
        running = false
      })
  }
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'active') check('foreground')
  })
  let wasLinked = deps.linked()
  const unsubscribeLink = linkChanges?.(() => {
    const linked = deps.linked()
    if (linked && !wasLinked) check('link-up')
    wasLinked = linked
  })
  check('start')
  return () => {
    subscription.remove()
    unsubscribeLink?.()
  }
}
