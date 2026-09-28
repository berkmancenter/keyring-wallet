/**
 * "Scan its code" on the phone that is adding another one (#30): the scanner
 * is opened for a device code, and what it reads comes back to that screen
 * instead of being routed as a link — a bare did:key would otherwise be
 * answered as "a key, not an agent or a community". One request at a time;
 * the screen that asked cancels it when it goes away.
 *
 * @module trust-tasks/module/deviceCodeScan
 */

import { deviceCodeIn } from './vtaOwner'

let waiting: ((code: string) => void) | undefined

export const deviceCodeScan = {
  /** The next device code the scanner reads goes to `deliver`. */
  request(deliver: (code: string) => void): void {
    waiting = deliver
  },
  cancel(): void {
    waiting = undefined
  },
  pending(): boolean {
    return waiting !== undefined
  },
  /**
   * For the scanner: undefined when nobody is waiting (scan as usual);
   * `taken: true` when the code went to the screen that asked (go back to
   * it); `taken: false` when what was read is not a device code (say so, and
   * keep scanning).
   */
  claim(value: string): { taken: boolean } | undefined {
    if (!waiting) return undefined
    const code = deviceCodeIn(value)
    if (!code) return { taken: false }
    const deliver = waiting
    waiting = undefined
    deliver(code)
    return { taken: true }
  },
}
