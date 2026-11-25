/**
 * The phone's Reduce Motion setting, read once and kept current: a screen that moves things checks it so that, with
 * the setting on, movement becomes a dissolve. The value is known only once the system has answered; a screen about
 * to animate awaits `readReduceMotion()` rather than guessing.
 */
import { useSyncExternalStore } from 'react'
import { AccessibilityInfo } from 'react-native'

let known: boolean | undefined
let subscription: { remove: () => void } | undefined
const listeners = new Set<() => void>()

function set(reduce: boolean): void {
  known = reduce
  listeners.forEach((listener) => listener())
}

function start(): Promise<boolean> {
  // Called inside the chain, so a system that throws or answers nothing counts as off rather than breaking the screen.
  const read = Promise.resolve()
    .then(() => AccessibilityInfo.isReduceMotionEnabled())
    .then((answer) => {
      const reduce = answer === true
      set(reduce)
      return reduce
    })
    .catch(() => {
      set(false)
      return false
    })
  if (!subscription) subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', set)
  return read
}

/** Whether Reduce Motion is on: from what is known, else from the system. */
export function readReduceMotion(): Promise<boolean> {
  return known === undefined ? start() : Promise.resolve(known)
}

/** Reduce Motion as known now; undefined until the system has answered. */
export function useReduceMotion(): boolean | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      if (known === undefined) void start()
      return () => listeners.delete(listener)
    },
    () => known
  )
}

/** Forget what is known (tests). */
export function resetReduceMotion(): void {
  known = undefined
  subscription?.remove()
  subscription = undefined
  listeners.clear()
}
