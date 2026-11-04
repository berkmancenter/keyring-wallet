/**
 * Keeps the end of the log across a kill, so a report can show what the app was
 * doing when it was killed. The log buffer lives in memory, and when the app hangs
 * on the PIN screen killing it is the only way out, so the only evidence goes with
 * it (IN-491).
 *
 * The file holds the lines the buffer holds, so it has the buffer's redaction and
 * nothing more. It is in the app's Caches directory, which is private to the app,
 * not backed up and gone with the app's data, and the OS may clear it, which costs
 * only a diagnostic. It leaves the phone only in a report the person chooses to send.
 *
 * It must not slow the app, the unlock least of all: nothing waits for a write.
 * The JS cost is taking the tail, at most every FLUSH_EVERY_MS and only when
 * something was logged; the file work runs natively. The slowest JS part is
 * reported with each report, so what it costs is read from real phones.
 *
 * The last FLUSH_EVERY_MS before a kill can be lost. A hang lasts longer than that.
 *
 * @module utils/logPersist
 */
import { CachesDirectoryPath, exists, moveFile, readFile, unlink, writeFile } from 'react-native-fs'

import { getLogVersion, getRecentLogLines } from './logBuffer'

/** Bounded in characters: about 3,000 ordinary lines, or fewer long ones. */
export const LOG_TAIL_MAX_CHARS = 256_000
export const FLUSH_EVERY_MS = 2000

export interface LogFiles {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface LogPersistOptions {
  dir: string
  files: LogFiles
  lines?: () => string[]
  version?: () => number
  now?: () => number
}

/** The newest lines that fit in `max` characters, oldest first. A single line over `max` is left out. */
export const tailWithin = (lines: string[], max: number): string[] => {
  let used = 0
  let from = lines.length
  while (from > 0) {
    const size = lines[from - 1].length + 1
    if (used + size > max) break
    used += size
    from--
  }
  return lines.slice(from)
}

export interface LogPersist {
  /** Keeps the last run's file, then keeps this run's up to date. Never rejects. */
  start(): Promise<void>
  stop(): void
  /** Write now if anything is new. Never rejects. */
  flush(): Promise<void>
  /** The last run's log, if it left one. Never rejects. */
  previousRun(): Promise<string | undefined>
  /** The slowest the JS part of a write has been in this run, in ms. */
  slowestJsMs(): number
}

export const createLogPersist = ({
  dir,
  files,
  lines = getRecentLogLines,
  version = getLogVersion,
  now = Date.now,
}: LogPersistOptions): LogPersist => {
  const current = `${dir}/keyring-log-current.txt`
  const writing = `${dir}/keyring-log-current.tmp`
  const previous = `${dir}/keyring-log-previous.txt`
  let timer: ReturnType<typeof setInterval> | undefined
  let written = -1
  let inFlight = false
  let slowest = 0

  const replace = async (from: string, to: string) => {
    if (await files.exists(to)) await files.remove(to)
    await files.move(from, to)
  }

  const flush = async () => {
    const seen = version()
    if (inFlight || seen === written) return
    inFlight = true
    try {
      const startedAt = now()
      const text = tailWithin(lines(), LOG_TAIL_MAX_CHARS).join('\n')
      slowest = Math.max(slowest, now() - startedAt)
      // Written beside the file and moved over it, so a kill mid-write leaves the last good one.
      await files.write(writing, text)
      await replace(writing, current)
      written = seen
    } catch {
      // Never let the log file break the app. The next change tries again.
    } finally {
      inFlight = false
    }
  }

  return {
    async start() {
      try {
        // A kill between the two steps of `replace` can leave only the file being written.
        if (await files.exists(current)) await replace(current, previous)
        else if (await files.exists(writing)) await replace(writing, previous)
      } catch {
        // No last run to show, then. This run still keeps its own.
      }
      if (!timer) timer = setInterval(() => void flush(), FLUSH_EVERY_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
    flush,
    async previousRun() {
      try {
        return (await files.exists(previous)) ? await files.read(previous) : undefined
      } catch {
        return undefined
      }
    },
    slowestJsMs: () => slowest,
  }
}

const rnfsFiles: LogFiles = {
  exists,
  read: (path) => readFile(path, 'utf8'),
  write: (path, text) => writeFile(path, text, 'utf8'),
  move: moveFile,
  remove: unlink,
}

export const logPersist = createLogPersist({ dir: CachesDirectoryPath, files: rnfsFiles })
