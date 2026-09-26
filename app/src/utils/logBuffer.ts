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
export const LOG_BUFFER_CAPACITY = 3000
// A single line (a dumped DIDComm message, a stack) is cut here so one entry
// can't crowd out the rest of the buffer. Rarely reached now that opaque tokens
// are shortened first — see `shortenOpaqueTokens`.
export const LOG_LINE_MAX_LENGTH = 2000

// Opaque tokens — an encoded `did:peer:4` document, a `ciphertext`/`iv`/`tag`/
// `protected` blob, the DIDs inside a connection's `_tags` dump — are the bulk of
// a report's bytes and carry nothing anyone diagnoses from. Anything longer than
// this is kept only as a recognisable head plus its true length, marked `[…of N]`
// so a reader skimming a plain-text report can't mistake the marker for part of
// the value. 80 is comfortably past the point where two of these diverge.
export const OPAQUE_TOKEN_MAX_LENGTH = 80
// A run of base58/base64url with no separator in it. Deliberately linear (no
// nested quantifiers) because this runs on every console line.
//
// The separators are what make this safe: a message type is a URL, so `/` and `.`
// break it into short runs and it is never matched; `message_count` is a number;
// and a `did:peer:4` keeps its hash intact — `did:peer:4<hash>:<document>` splits
// on `:`, the hash is ~48 characters and survives, only the document is cut. So
// the fields we key on are spared by the shape of the pattern rather than by a
// list someone has to maintain.
const OPAQUE_TOKEN = /[A-Za-z0-9_-]{81,}/g

const lines: string[] = []
let installed = false

// Mediator polling is most of a quiet app's log: every few seconds a Pickup
// status-request, its status answer, and credo's service lookup for the send.
// Left in, it filled all 3,000 lines in about four minutes of an idle app, so a
// report covered 18 s to 5 min and lost the vetting that had gone wrong before
// it (maintainer reports, 2026-09-25). Each minute's polling is collapsed into
// one counted line; every other line is kept, and so is any polling line that
// carries a message waiting or an error.
const POLLING: Array<[RegExp, string]> = [
  [/messagepickup\/[\d.]+\/status-request/, 'status requests'],
  [/messagepickup\/[\d.]+\/delivery-request/, 'delivery requests'],
  [/messagepickup\/[\d.]+\/live-delivery-change/, 'live-delivery changes'],
  [/messagepickup\/[\d.]+\/messages-received/, 'receipts'],
  [/messagepickup\/[\d.]+\/status\b/, 'statuses'],
  [/Retriev(?:ing|ed) (?:\d+ )?services for (?:message to )?connection/, 'service lookups'],
]
/** A polling line that still carries something: a message waiting, or trouble. */
const CARRIES = /"?message_count"?\s*[:=]\s*[1-9]|error|fail|refus|denied|timeout/i

let pollMinute = ''
let pollCounts: Record<string, number> = {}
let pollLines = 0

const pollingKind = (level: string, text: string): string | undefined => {
  if (level === 'warn' || level === 'error') return undefined
  const kind = POLLING.find(([pattern]) => pattern.test(text))?.[1]
  if (!kind || CARRIES.test(text)) return undefined
  return kind
}

const pollSummary = (): string | undefined => {
  if (!pollMinute || pollLines === 0) return undefined
  const parts = Object.entries(pollCounts).map(([kind, n]) => `${n} ${kind}`)
  return `${pollMinute}:00.000Z INFO [log buffer] mediator polling in this minute: ${parts.join(
    ', '
  )}, no messages (${pollLines} lines collapsed)`
}

const flushPolling = (): void => {
  const summary = pollSummary()
  if (summary) lines.push(summary)
  pollMinute = ''
  pollCounts = {}
  pollLines = 0
}

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Shortens opaque tokens, keeping a head long enough to tell two values apart
 * and a marker carrying the original length.
 *
 * The marker is spelled so it can't be misread as part of the value by someone
 * skimming a plain-text report on a phone.
 */
export const shortenOpaqueTokens = (text: string): string =>
  text.replace(OPAQUE_TOKEN, (token) => {
    const shortened = `${token.slice(0, OPAQUE_TOKEN_MAX_LENGTH)}[…of ${token.length}]`
    // A token barely over the limit costs more to annotate than to keep, so
    // leave it alone rather than growing the line we are trying to shrink.
    return shortened.length < token.length ? shortened : token
  })

export const recordLogLine = (level: string, args: unknown[], now: Date = new Date()): void => {
  // LOAD-BEARING ORDER: shorten first, cap second. A connection `_tags` dump
  // arrives at ~5,000 characters, so capping first would throw away ~3,000 of it
  // for good and still leave the largest line in the buffer. Shortening first
  // fits the whole record in a few hundred characters — this recovers evidence
  // the cap currently discards. Do not reorder these two steps.
  let text = shortenOpaqueTokens(args.map(stringify).join(' '))
  if (text.length > LOG_LINE_MAX_LENGTH) {
    text = `${text.slice(0, LOG_LINE_MAX_LENGTH)}… (${text.length - LOG_LINE_MAX_LENGTH} more chars)`
  }
  const stamp = now.toISOString()
  const minute = stamp.slice(0, 16)
  // A new minute closes the one before, so its summary sits in time order.
  if (pollMinute && pollMinute !== minute) flushPolling()
  const kind = pollingKind(level, text)
  if (kind) {
    pollMinute = minute
    pollCounts[kind] = (pollCounts[kind] ?? 0) + 1
    pollLines++
    return
  }
  lines.push(`${stamp} ${level.toUpperCase()} ${text}`)
  if (lines.length > LOG_BUFFER_CAPACITY) {
    lines.splice(0, lines.length - LOG_BUFFER_CAPACITY)
  }
}

/** Oldest first, with the current minute's polling summary last. */
export const getRecentLogLines = (): string[] => {
  const pending = pollSummary()
  return pending ? [...lines, pending] : [...lines]
}

export const clearLogBuffer = (): void => {
  lines.length = 0
  pollMinute = ''
  pollCounts = {}
  pollLines = 0
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
