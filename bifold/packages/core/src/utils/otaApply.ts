/**
 * Hooks for applying a downloaded over-the-air update when the person comes back.
 *
 * The app (the wallet's withOta) may reload into a staged update at one moment
 * only: when it returns from the background and bifold has just locked the person
 * out for inactivity (activity.tsx). They land on the PIN screen anyway, so the
 * reload interrupts nothing they see. Bifold reports that moment here, with how
 * long the app was away; the app decides.
 *
 * Anything a reload would lose registers a blocker while it lasts: a request to the
 * VTA waiting on its reply, a sign-in between claim and answer, an unsent chat
 * draft. While any is open, the app doesn't apply. It looks again at the next
 * return (nothing is deferred), and a cold start applies as it always has.
 * A relationship exchange needs no blocker: an interrupted one is resumed after a
 * restart (resumeInterruptedExchanges in trust-tasks/ceremony.ts).
 */

const blockers = new Map<number, string>()
let nextBlocker = 0

/** Blocks applying an update until the returned function is called (calling it twice is safe). */
export const registerOtaApplyBlocker = (reason: string): (() => void) => {
  const id = ++nextBlocker
  blockers.set(id, reason)
  return () => {
    blockers.delete(id)
  }
}

export const hasOtaApplyBlockers = (): boolean => blockers.size > 0

/** Why applying is blocked right now, for logs. */
export const otaApplyBlockerReasons = (): string[] => [...blockers.values()]

// unknown, not void: an async listener's promise is caught below.
type ReturnLockedListener = (awayMs: number) => unknown
const returnLockedListeners = new Set<ReturnLockedListener>()

/** Called when the app returns from the background and locks the person out for inactivity. */
export const onReturnLocked = (listener: ReturnLockedListener): (() => void) => {
  returnLockedListeners.add(listener)
  return () => {
    returnLockedListeners.delete(listener)
  }
}

/**
 * Tests only: forget every return-locked listener. The wallet's withOta subscribes
 * once per call for the life of the process, so its tests, each calling withOta,
 * reset here to keep driving the real notifyReturnLocked with one listener at a time.
 * Exported from the index because those tests live in the wallet: a deep import
 * of this file there would load a second copy of the module, and the reset would
 * clear a set nothing had registered in. The ForTests suffix marks it at the call
 * site, because a production caller would silently stop apply-on-return.
 */
export const resetOtaReturnLockedListenersForTests = (): void => returnLockedListeners.clear()

/** activity.tsx: the app came back after `awayMs` and has just locked the person out. */
export const notifyReturnLocked = (awayMs: number): void => {
  for (const listener of [...returnLockedListeners]) {
    try {
      // An async listener's rejection is caught too, not left unhandled.
      Promise.resolve(listener(awayMs)).catch(() => undefined)
    } catch {
      // A listener's failure must never stop the lock.
    }
  }
}
