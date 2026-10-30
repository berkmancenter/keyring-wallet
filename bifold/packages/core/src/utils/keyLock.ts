/**
 * Work in turn, per key: a task for a key starts only once every earlier task for that key has settled, and tasks for
 * different keys don't wait for each other. Two writers of one stored record at once would otherwise each find none and
 * each create one, or each write the record without the other's change.
 *
 * - A task that fails is its caller's failure only: the next task for that key still runs.
 * - A key's entry is let go once its last task has settled, so the map holds only keys with work outstanding. That
 *   is checked by reading, not by a test: the map is closed over, and keeping an entry too long costs only memory,
 *   which no caller can see.
 * - Each `createKeyLock()` is its own lock, so one module's keys never queue behind another's.
 *
 * @module utils/keyLock
 */

/** Runs `task` once every earlier task for `key` on this lock has settled, and gives back its result. */
export type KeyLock = <T>(key: string, task: () => Promise<T>) => Promise<T>

export function createKeyLock(): KeyLock {
  const queues = new Map<string, Promise<unknown>>()
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task)
    queues.set(key, next)
    const done = () => {
      if (queues.get(key) === next) queues.delete(key)
    }
    next.then(done, done)
    return next
  }
}
