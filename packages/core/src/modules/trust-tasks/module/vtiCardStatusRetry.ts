/**
 * A delivered card whose status list could not be read, tried again.
 *
 * A card is kept only once its status list has been read (vtiDeliveredCheck),
 * and that does not change here: until a read succeeds the card is not filed.
 * What changes is that the wait is no longer silent. Before, a list the phone
 * could not reach left the delivery on the mediator with a log line and
 * nothing else, so a member the community had admitted saw "not accepted" with
 * no word of why, and a restart did not help (IN-258, report X8YZ-X2FP: three
 * deliveries, each dropped 11 ms after it came, "Network request failed").
 *
 * Now the delivery is held here: tried again on a growing interval, said on
 * the community's card ("Keyring couldn't check this card's status"), and tried
 * at once from that card's Try again. Held in memory only: after a restart the
 * community delivers the card again, as it did before, and it is held again.
 *
 * @module trust-tasks/module/vtiCardStatusRetry
 */
import { DeviceEventEmitter } from 'react-native'

import { VtiCardStatusUnreadable } from './vtiDeliveredCheck'

/** Emitted with `{ communityDid }` whenever what is held for a community changes. */
export const VTI_CARD_STATUS_PENDING_EVENT = 'vti:card-status-pending'

/** The waits between tries; the last repeats. */
export const CARD_STATUS_RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000]

/** What the community's card reads: whether a card is held for its status, and where it was sought. */
export type CardStatusPending = { communityDid: string; host?: string; attempts: number; nextAt?: number }

type Held = CardStatusPending & {
  retry: () => Promise<unknown>
  timer?: ReturnType<typeof setTimeout>
  running?: Promise<CardStatusOutcome>
}

/** How a try ended: the card was taken, its list is still unreadable, or it failed some other way. */
export type CardStatusOutcome = 'kept' | 'stillUnreadable' | 'failed' | 'none'

const held = new Map<string, Held>()

const delayFor = (attempts: number) =>
  CARD_STATUS_RETRY_DELAYS_MS[Math.min(attempts, CARD_STATUS_RETRY_DELAYS_MS.length - 1)]

const announce = (communityDid: string) => DeviceEventEmitter.emit(VTI_CARD_STATUS_PENDING_EVENT, { communityDid })

function schedule(key: string, entry: Held): void {
  if (entry.timer) clearTimeout(entry.timer)
  const wait = delayFor(entry.attempts)
  entry.nextAt = Date.now() + wait
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    void run(key)
  }, wait)
}

async function run(key: string): Promise<CardStatusOutcome> {
  const entry = held.get(key)
  if (!entry) return 'none'
  if (entry.running) return entry.running
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = undefined
  entry.running = (async (): Promise<CardStatusOutcome> => {
    try {
      // The same take as the delivery's: it checks the card again, status and
      // all, and files it only if it holds up.
      await entry.retry()
      held.delete(key)
      return 'kept'
    } catch (e) {
      if (!(e instanceof VtiCardStatusUnreadable)) {
        // Some other refusal: the take's own path has said it. Nothing to wait for.
        held.delete(key)
        return 'failed'
      }
      entry.attempts += 1
      if (e.host) entry.host = e.host
      schedule(key, entry)
      return 'stillUnreadable'
    } finally {
      entry.running = undefined
      announce(entry.communityDid)
    }
  })()
  return entry.running
}

/**
 * Hold a delivery whose card's status list could not be read: try `retry` again
 * later, on a growing interval, until it no longer throws `VtiCardStatusUnreadable`.
 * `key` names the delivery (the community and the message), so a redelivery of
 * the same message does not start a second schedule.
 */
export function holdForStatusCheck(
  key: string,
  options: { communityDid: string; host?: string; retry: () => Promise<unknown> }
): void {
  const existing = held.get(key)
  if (existing) {
    // A redelivery, or the retry itself coming back through the take: keep the
    // schedule, and the newest way to try.
    existing.retry = options.retry
    if (options.host) existing.host = options.host
    if (!existing.timer && !existing.running) schedule(key, existing)
    announce(existing.communityDid)
    return
  }
  const entry: Held = { communityDid: options.communityDid, host: options.host, attempts: 0, retry: options.retry }
  held.set(key, entry)
  schedule(key, entry)
  announce(options.communityDid)
}

/** Whether a card is held for this community's status list, for its card to say. */
export function pendingStatusCheck(communityDid: string): CardStatusPending | undefined {
  let found: CardStatusPending | undefined
  for (const entry of held.values()) {
    if (entry.communityDid !== communityDid) continue
    if (!found || entry.attempts > found.attempts)
      found = { communityDid, host: entry.host, attempts: entry.attempts, nextAt: entry.nextAt }
  }
  return found
}

/**
 * Try every card held for this community now (the card's Try again). `kept`
 * when one was taken; otherwise how the tries ended, the schedule carrying on.
 */
export async function retryStatusCheckNow(communityDid: string): Promise<CardStatusOutcome> {
  const keys = [...held.entries()].filter(([, e]) => e.communityDid === communityDid).map(([k]) => k)
  if (!keys.length) return 'none'
  const outcomes = await Promise.all(keys.map(run))
  if (outcomes.includes('kept')) return 'kept'
  if (outcomes.includes('stillUnreadable')) return 'stillUnreadable'
  return outcomes.includes('failed') ? 'failed' : 'none'
}

/** Forget everything held (tests). */
export function clearStatusChecks(): void {
  for (const entry of held.values()) if (entry.timer) clearTimeout(entry.timer)
  const communities = new Set([...held.values()].map((e) => e.communityDid))
  held.clear()
  for (const c of communities) announce(c)
}
