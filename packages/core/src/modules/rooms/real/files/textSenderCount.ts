/**
 * How many text posts' signatures hold: a count for the log and nothing else. It says how real posts read against the
 * `SealedRecordBody` reading rules, which only a count on real rooms can say, since nobody can read other people's
 * rooms to find out. The same check as a file's (`sender.ts`), and nothing is decided on it.
 *
 * What it must never do:
 *  - change what is shown, or slow a read or a scroll: the check runs long after the read has answered, one at a time,
 *    with a long gap, once animations have settled. A verify is synchronous work on the JS thread: measured under
 *    Hermes on a fast Mac, about 15 ms each, about 260 ms for the first in an app run (noble builds its tables then),
 *    and over 400 ms for a 1 MiB body, so a body that long is not verified at all;
 *  - log anything but counts and kinds: no room, record, author, community or error's words (`SenderOutcome.why` holds
 *    all of those, so it is never read here). A problem report carries these lines into shared folders;
 *  - ask more of an author's host than files do: `senderDocuments.ts` fetches each author's DID document at most once
 *    until the wallet locks, and gives up after {@link SENDER_RESOLVE_MS}. A fetch still tells that host this phone
 *    is reading, so it is capped by {@link MAX_CHECKS_PER_UNLOCK} as well;
 *  - outlive the lock: what it holds is memory only, and a lock forgets it, bodies waiting included.
 *
 * @module rooms/real/files/textSenderCount
 */
import { InteractionManager } from 'react-native'

import { checkSender, type ReadAt, type ResolveSender, type SenderCheck, type SenderKind } from './sender'

/** The most posts checked until the wallet locks. Past it they are counted as skipped: it is a sample, not a rule. */
export const MAX_CHECKS_PER_UNLOCK = 200
/** The most bodies waiting at once; a burst beyond it is counted as skipped rather than held in memory. */
export const MAX_WAITING = 30
/** The wait before the first check after a quiet spell, so it does not land while a room is opening. */
export const START_DELAY_MS = 10_000
/** The pause before each later check, so verifies (work on the JS thread) never run back to back. */
export const CHECK_GAP_MS = 1000
/** The longest body verified, as JSON: past this a verify could hold the JS thread for a visible time. */
export const MAX_CHECKED_CHARS = 32_768
/** The least time between two log lines, unless the wallet locks. */
export const LOG_EVERY_MS = 60_000

/** The kinds this count adds to `SenderKind`: what a check of a whole body can say that `checkSender` can't. */
export type TextSenderKind = SenderKind | 'not-a-body' | 'past-version' | 'too-long' | 'check-threw'

interface Waiting {
  body: Record<string, unknown> | null
  at: ReadAt
  recordVersion: number
}

interface Tally {
  checks: Record<SenderCheck, number>
  kinds: Map<TextSenderKind, number>
  attributed: number
  private: number
  skipped: number
  authors: Set<string>
  verifyMs: number
  verifyMaxMs: number
  documentMs: number
  documentMaxMs: number
}

const emptyTally = (): Tally => ({
  checks: { confirmed: 0, unconfirmed: 0, refused: 0 },
  kinds: new Map(),
  attributed: 0,
  private: 0,
  skipped: 0,
  authors: new Set(),
  verifyMs: 0,
  verifyMaxMs: 0,
  documentMs: 0,
  documentMaxMs: 0,
})

export interface TextSenderCountOptions {
  startDelayMs?: number
  gapMs?: number
  logEveryMs?: number
  now?: () => number
  /** Resolves when nothing is animating. */
  whenIdle?: () => Promise<void>
}

/**
 * React Native's `InteractionManager`, read once as this module loads. Its export is a getter that requires the module
 * on first use, and the first use here comes from a timer (`START_DELAY_MS`): read then, a timer that outlived its
 * caller required a module after the environment was gone, which a test run reports as an error and exits 1 on.
 */
const interactions = InteractionManager

const afterInteractions = () =>
  new Promise<void>((done) => {
    interactions.runAfterInteractions(() => done())
  })

export class TextSenderCount {
  private tally = emptyTally()
  private waiting: Waiting[] = []
  /** Each record version is counted once until the lock: a post read again, or by both tabs, is one post. */
  private seen = new Set<string>()
  private running = false
  /** Moves at a lock: a check still out when it moved is not counted. */
  private generation = 0
  private lastLineAt: number | undefined
  private lastLine = ''
  private readonly startDelayMs: number
  private readonly gapMs: number
  private readonly logEveryMs: number
  private readonly now: () => number
  private readonly whenIdle: () => Promise<void>

  public constructor(
    private readonly resolve: ResolveSender,
    private readonly log: (line: string) => void,
    {
      startDelayMs = START_DELAY_MS,
      gapMs = CHECK_GAP_MS,
      logEveryMs = LOG_EVERY_MS,
      now = Date.now,
      whenIdle = afterInteractions,
    }: TextSenderCountOptions = {}
  ) {
    this.startDelayMs = startDelayMs
    this.gapMs = gapMs
    this.logEveryMs = logEveryMs
    this.now = now
    this.whenIdle = whenIdle
  }

  /** Counts a sealed text record's body, later. Returns at once and never throws. */
  public add(body: Record<string, unknown> | null, at: ReadAt, recordVersion: number): void {
    const id = `${at.roomId}\n${at.key}\n${recordVersion}`
    if (this.seen.has(id)) return
    if (this.seen.size >= MAX_CHECKS_PER_UNLOCK || this.waiting.length >= MAX_WAITING) {
      this.tally.skipped++
      return
    }
    this.seen.add(id)
    this.waiting.push({ body, at, recordVersion })
    if (!this.running) {
      this.running = true
      const generation = this.generation
      // Nothing is waiting on this to answer, so nothing may escape from it. What failed stays queued for the next post.
      void this.drain(generation).catch(() => {
        if (generation === this.generation) this.running = false
      })
    }
  }

  /** The wallet locked: says what was counted, and forgets it all. */
  public lock(): void {
    this.writeLine()
    this.generation++
    this.tally = emptyTally()
    this.waiting = []
    this.seen.clear()
    this.running = false
    this.lastLineAt = undefined
    this.lastLine = ''
  }

  private async drain(generation: number): Promise<void> {
    let pause = this.startDelayMs
    while (generation === this.generation) {
      await new Promise((done) => setTimeout(done, pause))
      pause = this.gapMs
      await this.whenIdle()
      if (generation !== this.generation) return
      const next = this.waiting.shift()
      if (!next) break
      await this.check(next, generation)
    }
    if (generation !== this.generation) return
    this.running = false
    const at = this.now()
    if (this.lastLineAt === undefined || at - this.lastLineAt >= this.logEveryMs) this.writeLine()
  }

  private async check({ body, at, recordVersion }: Waiting, generation: number): Promise<void> {
    let check: SenderCheck
    let kind: TextSenderKind
    let documentMs = 0
    let author: unknown
    const started = this.now()
    try {
      author = body?.author
      if (body === null) {
        check = 'refused'
        kind = 'not-a-body'
      } else if (at.version > recordVersion) {
        check = 'refused'
        kind = 'past-version'
      } else if (JSON.stringify(body).length > MAX_CHECKED_CHARS) {
        check = 'unconfirmed'
        kind = 'too-long'
      } else {
        const outcome = await checkSender(body, at, async (did) => {
          const asked = this.now()
          try {
            return await this.resolve(did)
          } finally {
            documentMs = this.now() - asked
          }
        })
        check = outcome.check
        kind = outcome.kind
      }
    } catch {
      // A body built to break the check: its words stay out of the log, and it is no reason to stop counting.
      check = 'unconfirmed'
      kind = 'check-threw'
    }
    if (generation !== this.generation) return
    const verifyMs = this.now() - started - documentMs
    const t = this.tally
    t.checks[check]++
    t.kinds.set(kind, (t.kinds.get(kind) ?? 0) + 1)
    if (at.hostAuthor !== undefined) t.attributed++
    else t.private++
    if (typeof author === 'string') t.authors.add(author)
    t.verifyMs += verifyMs
    t.verifyMaxMs = Math.max(t.verifyMaxMs, verifyMs)
    t.documentMs += documentMs
    t.documentMaxMs = Math.max(t.documentMaxMs, documentMs)
  }

  /** One line of counts and closed words, if anything changed since the last one. */
  private writeLine(): void {
    const t = this.tally
    const { confirmed, unconfirmed, refused } = t.checks
    const checked = confirmed + unconfirmed + refused
    if (checked === 0 && t.skipped === 0) return
    const kinds = [...t.kinds.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ')
    const line =
      `rooms: text post signatures since unlock: checked ${checked} (confirmed ${confirmed}, unconfirmed ${unconfirmed}, refused ${refused}); ` +
      `attributed ${t.attributed}, private ${t.private}; kinds: ${kinds || 'none'}; skipped ${t.skipped}; authors ${t.authors.size}; ` +
      `verify ms ${t.verifyMs} (max ${t.verifyMaxMs}); document wait ms ${t.documentMs} (max ${t.documentMaxMs})`
    if (line === this.lastLine) return
    this.lastLine = line
    this.lastLineAt = this.now()
    this.log(line)
  }
}
