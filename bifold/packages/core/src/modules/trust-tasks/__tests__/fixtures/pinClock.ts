/**
 * Pins the clock the code reads, `new Date()` as well as `Date.now()`. A
 * `jest.spyOn(Date, 'now')` (this package's jestSetup, or a suite's own)
 * leaves the Date constructor on the wall clock, and vtiGrantState reads
 * `new Date()`: a fixture's validUntil then expires under the suite on its own
 * date (boundVettingStatement's 2026-10-31 did). Only Date is faked; the
 * suites' timers and async chains stay real.
 */
export function pinClock(at: number) {
  jest.useFakeTimers({
    now: at,
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'hrtime',
      'performance',
    ],
  })
}

/** Real timers back, and every spy restored, as the suites' afterEach did. */
export function unpinClock() {
  jest.useRealTimers()
  jest.restoreAllMocks()
}
