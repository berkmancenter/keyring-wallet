/**
 * Whether a community card still stands: held, expired or revoked, read
 * synchronously by the screens and by the Wallet mirror (vtiWalletCards).
 *
 * Expiry is the card's own `validUntil`. Revocation is the last status-list
 * read recorded for the card (`recordCardRevocation`): reading the list means
 * a fetch, so the answer here is the last one known, never a fetch.
 * `readJoinState` records every read it makes of a membership card.
 *
 * @module trust-tasks/module/vtiCardStanding
 */
import type { Agent } from '@credo-ts/core'
import { DeviceEventEmitter } from 'react-native'

import { listKeyed, putKeyed } from './keyedRecords'

/** A card's recorded revocation changed: `{ credentialId }`. */
export const VTI_CARD_STANDING_EVENT = 'vti:card-standing'

export type CardStanding =
  | { state: 'held' }
  /** Past its `validUntil`, the date given. */
  | { state: 'expired'; at: string }
  /** Its community withdrew it, as its status list said when read at `at`. */
  | { state: 'revoked'; at: string }

interface RevocationRecord {
  credentialId: string
  revoked: boolean
  checkedAt: string
}

const RECORD_TYPE = 'keyring/vti-card-standing'
const KIND = 'revocation'
const known = new Map<string, RevocationRecord>()

/** Clocks on a phone and a server disagree by seconds. */
const SKEW_MS = 60 * 1000

const HELD: CardStanding = Object.freeze({ state: 'held' })
/** The last answer per card, so the same answer is the same object (a stable useSyncExternalStore snapshot). */
const answered = new Map<string, CardStanding>()

function same(id: string, standing: CardStanding): CardStanding {
  const before = answered.get(id)
  if (before && before.state === standing.state && (before as { at?: string }).at === (standing as { at?: string }).at)
    return before
  if (id) answered.set(id, standing)
  return standing
}

/**
 * A card's standing now, from its own dates and the last status read recorded
 * for it. The same answer is the same object until it changes.
 */
export function cardStandingOf(card: Record<string, unknown>, now = Date.now()): CardStanding {
  const id = typeof card.id === 'string' ? card.id : ''
  const revocation = id ? known.get(id) : undefined
  if (revocation?.revoked) return same(id, { state: 'revoked', at: revocation.checkedAt })
  const until = String(card.validUntil ?? card.expirationDate ?? '')
  const ends = Date.parse(until)
  if (Number.isFinite(ends) && now > ends + SKEW_MS) return same(id, { state: 'expired', at: until })
  return HELD
}

/** Record a status-list read of a card. A change is announced. */
export async function recordCardRevocation(
  agent: Agent,
  credentialId: string,
  revoked: boolean,
  checkedAt = new Date().toISOString()
): Promise<void> {
  if (!credentialId) return
  const before = known.get(credentialId)
  const record = { credentialId, revoked, checkedAt }
  known.set(credentialId, record)
  await putKeyed(agent, RECORD_TYPE, KIND, credentialId, record as unknown as Record<string, unknown>)
  if (before?.revoked !== revoked) DeviceEventEmitter.emit(VTI_CARD_STANDING_EVENT, { credentialId })
}

/** Fill the cache from what this phone recorded (once the agent exists). */
export async function loadCardStanding(agent: Agent): Promise<void> {
  for (const r of await listKeyed<RevocationRecord>(agent, RECORD_TYPE, KIND)) known.set(r.credentialId, r)
}

/** Called whenever a card's recorded revocation changes. Returns the unsubscribe. */
export function subscribeCardStanding(onChange: () => void): () => void {
  const sub = DeviceEventEmitter.addListener(VTI_CARD_STANDING_EVENT, onChange)
  return () => sub.remove()
}

/** For tests: forget what is known. */
export function resetCardStanding(): void {
  known.clear()
  answered.clear()
}
