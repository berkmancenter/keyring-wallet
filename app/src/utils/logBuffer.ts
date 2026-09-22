/**
 * Keeps the most recent console output in memory so a tester can send it with a
 * problem report. Release builds keep logging at debug level (credo, the agent,
 * the app logger all go through console), so these lines are the same ones a
 * device log shows — without needing a cable or a log server.
 *
 * Installed first thing in index.js, before anything else logs.
 */

type ConsoleMethod = 'debug' | 'log' | 'info' | 'warn' | 'error'

const METHODS: ConsoleMethod[] = ['debug', 'log', 'info', 'warn', 'error']
export const LOG_BUFFER_CAPACITY = 500
// A single line (a dumped DIDComm message, a stack) is cut here so one entry
// can't crowd out the rest of the buffer.
export const LOG_LINE_MAX_LENGTH = 2000

const lines: string[] = []
let installed = false

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const recordLogLine = (level: string, args: unknown[], now: Date = new Date()): void => {
  let text = args.map(stringify).join(' ')
  if (text.length > LOG_LINE_MAX_LENGTH) {
    text = `${text.slice(0, LOG_LINE_MAX_LENGTH)}… (${text.length - LOG_LINE_MAX_LENGTH} more chars)`
  }
  lines.push(`${now.toISOString()} ${level.toUpperCase()} ${text}`)
  if (lines.length > LOG_BUFFER_CAPACITY) {
    lines.splice(0, lines.length - LOG_BUFFER_CAPACITY)
  }
}

/** Oldest first. */
export const getRecentLogLines = (): string[] => [...lines]

export const clearLogBuffer = (): void => {
  lines.length = 0
}

export const installLogBuffer = (target: Console = console): void => {
  if (installed) return
  installed = true
  for (const method of METHODS) {
    const original = target[method]?.bind(target)
    if (!original) continue
    target[method] = (...args: unknown[]) => {
      try {
        recordLogLine(method, args)
      } catch {
        // Never let the buffer break logging.
      }
      original(...args)
    }
  }
}
