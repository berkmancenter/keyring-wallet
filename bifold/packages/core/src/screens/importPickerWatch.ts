/**
 * IN-537: on one iPhone, "Select Backup File" on Import Wallet opened nothing and
 * nothing said so. The picker's promise never settled. This watches each tap's
 * picker call so the screen can say something when it hasn't settled in time.
 *
 * - Each tap starts a new call; only the newest call's outcome counts. The picker
 *   module rejects an older unsettled call (ASYNC_OP_IN_PROGRESS) when a newer one
 *   starts, and that rejection is not an error to show.
 * - If the newest call hasn't settled within IMPORT_PICKER_SLOW_MS, onSlow(true)
 *   fires once for it. While the system picker is open it covers the screen, so
 *   whatever the screen shows in response is only seen when no picker is in front.
 * - Settling the newest call, starting a new one, or disposing clears it.
 */

/** The system picker normally appears well within a second. */
export const IMPORT_PICKER_SLOW_MS = 6000

export interface PickCall {
  /** False once a newer tap has started: ignore this call's result and errors. */
  isCurrent: () => boolean
  /** Call when this call's picker resolves or rejects (only acts if it's current). */
  settle: () => void
}

export interface PickWatcher {
  start: () => PickCall
  dispose: () => void
}

export const createPickWatcher = (
  slowMs: number,
  onSlow: (slow: boolean) => void,
  onSlowNoted?: (slowMs: number) => void
): PickWatcher => {
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    start: () => {
      const call = ++latest
      clear()
      onSlow(false)
      timer = setTimeout(() => {
        timer = undefined
        if (call !== latest) return
        onSlowNoted?.(slowMs)
        onSlow(true)
      }, slowMs)
      const isCurrent = () => call === latest
      return {
        isCurrent,
        settle: () => {
          if (!isCurrent()) return
          clear()
          onSlow(false)
        },
      }
    },
    dispose: () => {
      // A disposed watcher treats every outstanding call as superseded.
      latest++
      clear()
    },
  }
}
