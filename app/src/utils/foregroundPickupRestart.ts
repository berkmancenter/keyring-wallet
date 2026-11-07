/**
 * When the app restarts message pickup on coming back: once per return from
 * the background, never on the first 'active' after launch.
 *
 * The restart is needed. configureMessagePickup's polling loop runs on JS
 * timers that the OS suspends in the background, and nothing else restarts
 * them (the 08-26 stall; see useBCAgentSetup). But an 'active' event is not a
 * return: one arrives at launch, 2 s after the loop was started (277.6, iPhone:
 * three starts in 2 s), and Android can send two in a row (277.4: two restarts
 * 141 ms apart). Each extra restart stops and starts the loop and its 30 s
 * fast-poll window for nothing. So only a return from 'background' restarts,
 * and the restarts run one after another, never side by side.
 *
 * @module utils/foregroundPickupRestart
 */

type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension' | string

export interface ForegroundPickupRestart {
  /** Feed every AppState 'change'. Resolves when any restart it started has finished. */
  onAppStateChange(next: AppStateName): Promise<void>
}

/**
 * `initial` is AppState.currentState when the listener is added: an app woken
 * in the background (a push) has had no 'background' event, but its first
 * 'active' is still a return.
 */
export function foregroundPickupRestart(restart: () => Promise<void>, initial: AppStateName): ForegroundPickupRestart {
  let away = initial === 'background'
  let running: Promise<void> = Promise.resolve()
  return {
    onAppStateChange(next) {
      if (next === 'background') {
        away = true
        return running
      }
      if (next !== 'active' || !away) return running
      away = false
      running = running.then(restart, restart)
      return running
    },
  }
}
