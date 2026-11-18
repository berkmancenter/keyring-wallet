import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { DeviceEventEmitter } from 'react-native'

import { LocalStorageKeys } from '../../constants'
import { PersistentStorage } from '../../services/storage'
import { VTA_UNLINKING_EVENT } from '../trust-tasks/module/unlinkEvent'
import { VTI_REMOVED_EVENT } from '../trust-tasks/module/vtiCommunityNotices'
import { onRoomsListed } from './useRoomRows'

/**
 * A room's recent posts, kept on the phone in the agent's encrypted wallet so a room opens on them at once, and emptied
 * the moment the member's access goes (docs/plans/rooms-local-message-cache-plan.md). The room's host stays the source
 * of truth: this is a small, disposable copy of what the member was shown while they had access, never an archive and
 * never evidence of anything.
 *
 * What is kept, per identity and open, attributed or private room: at most {@link MSG_CACHE_POSTS} posts,
 * {@link MSG_CACHE_BYTES} bytes and {@link MSG_CACHE_DAYS} days, across at most {@link MSG_CACHE_ROOMS} rooms (Alberto,
 * 11-18). Each post as the chat draws it: key, version, kind, author, when, its words, what it replies to, reaction
 * counts, its check's verdict. Never a file's bytes, a post the agent could not open, or one whose signature was
 * refused. Rooms whose tier is unknown (custody-only) are never kept (Room.tsx names the tiers kept). An attributed or
 * private room's words, and a private room's author (which its host never sees), are kept as the agent opened them: a
 * copy that removal from the room's group no longer protects; only the emptyings here do (plan, Privacy).
 *
 * Off, and emptied, on a phone without biometric unlock: there the wallet key is kept ACCESSIBLE.ALWAYS
 * (services/keychain.ts), no better than the PIN it comes from (Alberto, 11-18, decision 6).
 *
 * Emptied, never removed: an emptied record names nothing, and a removal would make every change here a store build
 * (tier.mjs, "deletes stored records"), so the kill could not go out by OTA (ac, #1125). Every emptying is written to
 * a journal first and replayed at each start, so one a crash or a failed write cut short is finished then.
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice. **It ships OFF on main** (the coordinator, 11-18, a5's option 1): this is the first
 *   change that stores message text on the phone, and no routine cut from main may start doing that before it is
 *   proven. Turning it on takes, in order: the device proof (plan phase 3: every wipe seen to empty on a phone),
 *   then a ring0 preview cut that carries the flip to `on: true` in its own commit, then Alberto's own word on that
 *   preview. Off, the cache keeps and shows nothing, and every start empties any copy an earlier bundle kept.
 * - `remoteOff`: the release's kill. Set it to `true` and nothing is kept or shown, and the first start empties what
 *   was kept, for everyone, whatever `on` says, until a release sets it back.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing a person does changes either value; it is read at each keeping, reading and start, never cached. It fails
 * closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/messageCache
 */
export const ROOMS_MESSAGE_CACHE: { on: boolean; remoteOff: boolean } = { on: false, remoteOff: false }

export function isMessageCacheOn(): boolean {
  return ROOMS_MESSAGE_CACHE.on === true && ROOMS_MESSAGE_CACHE.remoteOff === false
}

export const MSG_CACHE_POSTS = 50
export const MSG_CACHE_BYTES = 64 * 1024
export const MSG_CACHE_ROOMS = 32
export const MSG_CACHE_DAYS = 7
const DAY_MS = 24 * 3600 * 1000
/** A post's words past this are cut, and the refresh draws the whole post. */
export const MSG_CACHE_BODY_MAX = 8 * 1024

const RECORD_TYPE = 'rooms.msgcache'
const RECORD_PREFIX = 'keyring.rooms.msgcache.'
export const MSG_CACHE_JOURNAL_ID = 'keyring.rooms.msgcache.journal'

/** One post as kept: what the chat draws, never a file's bytes. */
export interface CachedPost {
  key: string
  version: number
  kind?: string
  /** The author's DID, when the host said. */
  author?: string
  /** ISO 8601. */
  writtenAt: string
  body: string
  inReplyTo?: string
  reactions?: Record<string, number>
  /** The record's check as it was when drawn. */
  verdict?: string
  /** Its words were cut to {@link MSG_CACHE_BODY_MAX}. */
  cut?: true
}

/** Whose copy of which room: the identity the room screen acts as, the room, and its community. */
export interface CachedRoom {
  personaDid: string
  roomId: string
  communityDid: string
  /** The room's end, as the community lists it: past it, the copy is emptied. */
  validUntil?: string
}

interface RecordLike {
  id?: string
  content: Record<string, unknown>
  tags?: Record<string, unknown>
  getTags?: () => Record<string, unknown>
}
/** The part of the agent's generic records this uses (Credo `GenericRecordsApi`). */
export interface CacheWallet {
  genericRecords: {
    findById(id: string): Promise<RecordLike | null>
    findAllByQuery(query: Record<string, unknown>): Promise<RecordLike[]>
    save(options: { id: string; content: Record<string, unknown>; tags?: Record<string, string> }): Promise<unknown>
    update(record: RecordLike): Promise<void>
  }
}

export function isCacheWallet(agent: unknown): agent is CacheWallet {
  const r = (agent as { genericRecords?: Record<string, unknown> } | undefined)?.genericRecords
  return (
    !!r &&
    typeof r.findById === 'function' &&
    typeof r.findAllByQuery === 'function' &&
    typeof r.save === 'function' &&
    typeof r.update === 'function'
  )
}

/** A value by a hash of it, so no record's id or tag names a room, community or identity. */
export const hashOf = (value: string): string => bytesToHex(sha256(utf8ToBytes(value))).slice(0, 32)
const recordIdOf = (personaDid: string, roomId: string) => `${RECORD_PREFIX}${hashOf(`${personaDid}\n${roomId}`)}`

/**
 * Whether this phone may keep words at all: the app's biometric unlock is on (preferences `useBiometry`), which is what
 * puts the wallet key behind the device's biometrics rather than ACCESSIBLE.ALWAYS. Unreadable reads as off.
 */
let biometryGate: () => Promise<boolean> = async () => {
  const prefs = await PersistentStorage.fetchValueForKey<{ useBiometry?: unknown }>(LocalStorageKeys.Preferences)
  return prefs?.useBiometry === true
}
/** For tests: how the biometric unlock is read. */
export function setMessageCacheBiometryGate(gate: () => Promise<boolean>): void {
  biometryGate = gate
}

/**
 * The biometric unlock as the app holds it this run (`useMessageCacheBiometryGuard`), ahead of the saved preference,
 * which is written a moment after the person turns it off: no keep slips in between.
 */
let biometryNow: boolean | undefined

/** Whether words may be kept and shown now: the switch on, and biometric unlock on. */
export async function messageCacheAllowed(): Promise<boolean> {
  if (!isMessageCacheOn()) return false
  if (biometryNow === false) return false
  try {
    return (await biometryGate()) === true
  } catch {
    return false
  }
}

/**
 * The person turned biometric unlock on or off. Off empties every copy at once, not at the next start: no words are
 * kept without biometric protection (Alberto, 11-18, decision 6; the coordinator's ask, #1130).
 */
export async function noteBiometricUnlock(on: boolean): Promise<void> {
  const was = biometryNow
  biometryNow = on
  const agent = bound
  if (!on && was !== false && agent) await emptyMessageCache(agent, { all: true }, 'biometryOff')
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function postOf(raw: unknown): CachedPost | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  if (!isText(p.key) || typeof p.version !== 'number' || !Number.isInteger(p.version) || p.version < 0) return undefined
  if (!isText(p.writtenAt) || Number.isNaN(Date.parse(p.writtenAt)) || typeof p.body !== 'string') return undefined
  for (const k of ['kind', 'author', 'inReplyTo', 'verdict'] as const)
    if (p[k] !== undefined && typeof p[k] !== 'string') return undefined
  if (p.cut !== undefined && p.cut !== true) return undefined
  let reactions: Record<string, number> | undefined
  if (p.reactions !== undefined) {
    if (!p.reactions || typeof p.reactions !== 'object' || Array.isArray(p.reactions)) return undefined
    reactions = {}
    for (const [value, n] of Object.entries(p.reactions as Record<string, unknown>)) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return undefined
      reactions[value] = n
    }
  }
  return {
    key: p.key,
    version: p.version,
    ...(p.kind !== undefined ? { kind: p.kind as string } : {}),
    ...(p.author !== undefined ? { author: p.author as string } : {}),
    writtenAt: p.writtenAt,
    body: p.body,
    ...(p.inReplyTo !== undefined ? { inReplyTo: p.inReplyTo as string } : {}),
    ...(reactions ? { reactions } : {}),
    ...(p.verdict !== undefined ? { verdict: p.verdict as string } : {}),
    ...(p.cut ? { cut: true as const } : {}),
  }
}

/** The posts to keep: none past {@link MSG_CACHE_DAYS}, newest first, within the post and byte caps. */
export function trimPosts(posts: readonly CachedPost[], now: number): CachedPost[] {
  const fresh = posts
    .filter((p) => now - Date.parse(p.writtenAt) <= MSG_CACHE_DAYS * DAY_MS)
    .map((p) =>
      p.body.length > MSG_CACHE_BODY_MAX ? { ...p, body: p.body.slice(0, MSG_CACHE_BODY_MAX), cut: true as const } : p
    )
    .sort((a, b) => Date.parse(b.writtenAt) - Date.parse(a.writtenAt))
    .slice(0, MSG_CACHE_POSTS)
  // Drop the oldest until the serialized posts fit.
  while (fresh.length > 0 && utf8ToBytes(JSON.stringify(fresh)).length > MSG_CACHE_BYTES) fresh.pop()
  return fresh
}

/** A record's content, when it is a kept copy this build reads (v 1, not emptied). */
function contentOf(
  record: RecordLike | null | undefined
): (CachedRoom & { keptAt: number; posts: unknown[] }) | undefined {
  const c = record?.content
  if (!c || c.v !== 1 || c.emptied === true || !Array.isArray(c.posts)) return undefined
  if (!isText(c.personaDid) || !isText(c.roomId) || !isText(c.communityDid) || typeof c.keptAt !== 'number')
    return undefined
  if (c.validUntil !== undefined && (typeof c.validUntil !== 'string' || Number.isNaN(Date.parse(c.validUntil))))
    return undefined
  return {
    personaDid: c.personaDid,
    roomId: c.roomId,
    communityDid: c.communityDid,
    ...(c.validUntil !== undefined ? { validUntil: c.validUntil as string } : {}),
    keptAt: c.keptAt,
    posts: c.posts,
  }
}

const EMPTIED = { v: 1, emptied: true }

// Every write, keep or empty, one after another: an emptying never interleaves with a keep of the same room.
let turn: Promise<unknown> = Promise.resolve()
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const next = turn.catch(() => undefined).then(fn)
  turn = next
  return next
}

/** What an emptying covers: every copy, or those of a community, of an identity, or of a room (every identity's). */
export type EmptyScope = { all: true } | { community: string } | { persona: string } | { room: string }

interface JournalEntry {
  scope: 'all' | 'community' | 'persona' | 'room'
  h?: string
  reason: string
}

const entryOf = (scope: EmptyScope, reason: string): JournalEntry =>
  'all' in scope
    ? { scope: 'all', reason }
    : 'room' in scope
      ? { scope: 'room', h: hashOf(scope.room), reason }
      : 'community' in scope
        ? { scope: 'community', h: hashOf(scope.community), reason }
        : { scope: 'persona', h: hashOf(scope.persona), reason }

const sameEntry = (a: JournalEntry, b: JournalEntry) => a.scope === b.scope && a.h === b.h

async function journalOf(agent: CacheWallet): Promise<{ record: RecordLike | null; entries: JournalEntry[] }> {
  const record = await agent.genericRecords.findById(MSG_CACHE_JOURNAL_ID)
  const raw = record?.content?.pending
  const entries = Array.isArray(raw)
    ? raw.filter(
        (e): e is JournalEntry =>
          !!e &&
          typeof e === 'object' &&
          ['all', 'community', 'persona', 'room'].includes((e as JournalEntry).scope) &&
          ((e as JournalEntry).scope === 'all' || isText((e as JournalEntry).h))
      )
    : []
  return { record, entries }
}

async function writeJournal(agent: CacheWallet, record: RecordLike | null, entries: JournalEntry[]): Promise<void> {
  const content = { v: 1, pending: entries }
  if (record) {
    record.content = content
    await agent.genericRecords.update(record)
  } else if (entries.length > 0)
    await agent.genericRecords.save({ id: MSG_CACHE_JOURNAL_ID, content, tags: { type: `${RECORD_TYPE}.journal` } })
}

/** The kept copies an entry covers. */
async function coveredBy(agent: CacheWallet, entry: JournalEntry): Promise<RecordLike[]> {
  const query: Record<string, unknown> = { type: RECORD_TYPE }
  if (entry.scope === 'community') query.community = entry.h
  if (entry.scope === 'persona') query.persona = entry.h
  if (entry.scope === 'room') query.room = entry.h
  return agent.genericRecords.findAllByQuery(query)
}

async function emptyRecords(agent: CacheWallet, records: RecordLike[]): Promise<number> {
  let n = 0
  for (const record of records) {
    if (record.content?.emptied === true) continue
    record.content = { ...EMPTIED }
    await agent.genericRecords.update(record)
    n++
  }
  return n
}

/**
 * Every scope emptied this run, so a keep that was already on its way (the writer waits 2 s for a room's posts to
 * settle) cannot put the posts back once the journal entry is done (b0's finding, #1130). For the run only: at the
 * next start the sweep decides from the memberships again.
 */
let emptiedThisRun: JournalEntry[] = []

/** Applies one entry, then takes it off the journal. A failure leaves it there for the next start. */
async function apply(agent: CacheWallet, entry: JournalEntry): Promise<number> {
  if (!emptiedThisRun.some((e) => sameEntry(e, entry))) emptiedThisRun.push(entry)
  const n = await emptyRecords(agent, await coveredBy(agent, entry))
  const { record, entries } = await journalOf(agent)
  await writeJournal(
    agent,
    record,
    entries.filter((e) => !sameEntry(e, entry))
  )
  return n
}

/**
 * Empties the kept copies `scope` covers, writing the intent to the journal first: one cut short is finished at the
 * next start ({@link sweepMessageCache}), and nothing the journal names is ever shown. Says how many, never which.
 */
export async function emptyMessageCache(agent: CacheWallet, scope: EmptyScope, reason: string): Promise<number> {
  const n = await inTurn(async () => {
    const entry = entryOf(scope, reason)
    const { record, entries } = await journalOf(agent)
    if (!entries.some((e) => sameEntry(e, entry))) await writeJournal(agent, record, [...entries, entry])
    return apply(agent, entry)
  })
  await sayCounts(agent, reason)
  return n
}

/** Whether a kept copy is one the journal still means to empty. */
function journaled(entries: JournalEntry[], room: CachedRoom): boolean {
  return entries.some(
    (e) =>
      e.scope === 'all' ||
      (e.scope === 'room' && e.h === hashOf(room.roomId)) ||
      (e.scope === 'community' && e.h === hashOf(room.communityDid)) ||
      (e.scope === 'persona' && e.h === hashOf(room.personaDid))
  )
}

/**
 * Keeps `posts` as the identity's copy of an open, attributed or private room, trimmed to the caps, when allowed.
 * The room used longest ago goes first past {@link MSG_CACHE_ROOMS}. Nothing is kept for a room the journal means to
 * empty.
 */
export function keepRoomPosts(
  agent: CacheWallet,
  room: CachedRoom,
  posts: readonly CachedPost[],
  now = Date.now()
): Promise<boolean> {
  return inTurn(async () => {
    if (!(await messageCacheAllowed())) return false
    const { entries } = await journalOf(agent)
    if (journaled([...entries, ...emptiedThisRun], room)) return false
    const kept = trimPosts(posts, now)
    const id = recordIdOf(room.personaDid, room.roomId)
    const content = {
      v: 1,
      personaDid: room.personaDid,
      roomId: room.roomId,
      communityDid: room.communityDid,
      ...(room.validUntil ? { validUntil: room.validUntil } : {}),
      keptAt: now,
      posts: kept,
    }
    const existing = await agent.genericRecords.findById(id)
    if (existing) {
      existing.content = content
      await agent.genericRecords.update(existing)
    } else
      await agent.genericRecords.save({
        id,
        content,
        tags: {
          type: RECORD_TYPE,
          community: hashOf(room.communityDid),
          persona: hashOf(room.personaDid),
          room: hashOf(room.roomId),
        },
      })
    // Past the room cap, the copies used longest ago are emptied.
    const live = (await agent.genericRecords.findAllByQuery({ type: RECORD_TYPE }))
      .map((record) => ({ record, content: contentOf(record) }))
      .filter((r) => r.content)
      .sort((a, b) => (b.content?.keptAt ?? 0) - (a.content?.keptAt ?? 0))
    await emptyRecords(
      agent,
      live.slice(MSG_CACHE_ROOMS).map((r) => r.record)
    )
    return true
  })
}

/**
 * The identity's copy of a room, when the cache is allowed and the copy may be shown: this build's shape, the same
 * identity, not past the room's end, not named by the journal, and only the posts within {@link MSG_CACHE_DAYS}.
 * A copy past the room's end is emptied, not shown.
 */
export async function readRoomPosts(
  agent: CacheWallet,
  personaDid: string,
  roomId: string,
  now = Date.now()
): Promise<{ room: CachedRoom; posts: CachedPost[] } | undefined> {
  const read = await readInTurn(agent, personaDid, roomId, now).catch(() => undefined)
  if (read === 'ended') {
    // Emptied journal first, as every emptying is; the reader hears nothing either way (b0's note, #1130).
    await emptyMessageCache(agent, { room: roomId }, 'room ended').catch(() => undefined)
    return undefined
  }
  return read
}

/**
 * The kept copy a room opens on before the room itself is known (useRoomPosts `seedBeforeRoom`): at a cold start the
 * room screen learns which identity acts in a room only from the first rooms listing, seconds away (6 s on 279.3,
 * 20-55 s on slower phones), and the copy waited for it. Here the identity comes from what the phone already holds:
 * `communities`, each community this phone is a member of now and the identity it acts as there (the rooms backend's
 * `communities`, read from the wallet alone, the same answer the listing names a room's `actingAs` by).
 *
 * A copy is drawn only when exactly one of the room's kept copies is of a community and identity among them, and that
 * community is acted as by that identity alone. Otherwise nothing: never a guess between two identities, whose copies
 * are each shown only on their own screen. The read itself is {@link readRoomPosts}'s, with every check it makes (the
 * switch, biometric unlock, the journal, the room's end, the age), and the room screen takes the copy down if the room,
 * once known, acts as another identity or is not kept.
 *
 * A room's id is taken to name one room across communities (a did:webvh of its own), so a copy found by its room tag is
 * this room's. Were room ids ever scoped by community, a copy of another room of the member's could be drawn here for
 * a moment; the takedown, which checks the room's community as well as its identity, is what covers that (ac).
 */
export async function readRoomPostsBeforeRoom(
  agent: CacheWallet,
  roomId: string,
  communities: ReadonlyArray<{ did: string; personaDid: string }>,
  now = Date.now()
): Promise<{ room: CachedRoom; posts: CachedPost[] } | undefined> {
  if (!(await messageCacheAllowed())) return undefined
  const records = await agent.genericRecords.findAllByQuery({ type: RECORD_TYPE, room: hashOf(roomId) })
  const mine = records
    .map(contentOf)
    .filter((c): c is NonNullable<typeof c> => !!c && c.roomId === roomId)
    .filter((c) => {
      const actedAs = communities.filter((m) => m.did === c.communityDid)
      return actedAs.length === 1 && actedAs[0].personaDid === c.personaDid
    })
  if (mine.length !== 1) return undefined
  return readRoomPosts(agent, mine[0].personaDid, roomId, now)
}

function readInTurn(
  agent: CacheWallet,
  personaDid: string,
  roomId: string,
  now: number
): Promise<{ room: CachedRoom; posts: CachedPost[] } | 'ended' | undefined> {
  return inTurn(async () => {
    if (!(await messageCacheAllowed())) return undefined
    const record = await agent.genericRecords.findById(recordIdOf(personaDid, roomId))
    const content = contentOf(record)
    if (!content || content.personaDid !== personaDid || content.roomId !== roomId) return undefined
    const { entries } = await journalOf(agent)
    if (journaled(entries, content)) return undefined
    if (content.validUntil && Date.parse(content.validUntil) <= now) return 'ended' as const
    const posts = content.posts
      .map(postOf)
      .filter((p): p is CachedPost => !!p)
      .filter((p) => now - Date.parse(p.writtenAt) <= MSG_CACHE_DAYS * DAY_MS)
    if (posts.length === 0) return undefined
    const { keptAt: _keptAt, posts: _raw, ...room } = content
    return { room, posts }
  })
}

/**
 * At each start: finishes every emptying the journal still holds; with the cache not allowed (the kill, or no
 * biometric unlock), empties every copy; else empties each copy whose membership no longer stands (`current`: each
 * community and identity the member is in now, not removed), whose room has ended, or whose posts are all past
 * {@link MSG_CACHE_DAYS}. That catches what happened with the app closed: a removal, an identity let go.
 */
type Memberships = ReadonlyArray<{ communityDid: string; personaDid: string }>

export function sweepMessageCache(
  agent: CacheWallet,
  current: Memberships | (() => Promise<Memberships>),
  now = Date.now()
): Promise<number> {
  return inTurn(async () => {
    let n = 0
    // First and whatever else fails: the journal, and with the cache not allowed, every copy. A membership read that
    // fails only skips the standing check (b0's finding, #1130): a store that fails at every start must not keep a
    // kill or an emptying from ever running.
    const { entries } = await journalOf(agent)
    for (const entry of entries) n += await apply(agent, entry)
    const records = await agent.genericRecords.findAllByQuery({ type: RECORD_TYPE })
    if (!(await messageCacheAllowed())) return n + (await emptyRecords(agent, records))
    let members: Memberships | undefined
    try {
      members = typeof current === 'function' ? await current() : current
    } catch {
      members = undefined
    }
    const standing = members ? new Set(members.map((m) => `${m.communityDid}\n${m.personaDid}`)) : undefined
    const standingByTag = members
      ? new Set(members.map((m) => `${hashOf(m.communityDid)}\n${hashOf(m.personaDid)}`))
      : undefined
    const ended = records.filter((record) => {
      const c = contentOf(record)
      if (!c) {
        // A copy in a shape this build does not read (a newer one's) is never shown; its tags still say whose it is,
        // so one whose membership no longer stands is emptied too (b0's note).
        if (record.content?.emptied === true || !standingByTag) return false
        const tags = record.tags ?? record.getTags?.() ?? {}
        return !standingByTag.has(`${String(tags.community)}\n${String(tags.persona)}`)
      }
      if (standing && !standing.has(`${c.communityDid}\n${c.personaDid}`)) return true
      if (c.validUntil && Date.parse(c.validUntil) <= now) return true
      return !c.posts.some((p) => {
        const post = postOf(p)
        return !!post && now - Date.parse(post.writtenAt) <= MSG_CACHE_DAYS * DAY_MS
      })
    })
    return n + (await emptyRecords(agent, ended))
  })
}

/**
 * The memberships a kept copy stands on: none when the agent no longer accepts this phone (the link `revoked`: a lost
 * phone revoked from another device), whatever the wallet still lists; else each one not removed (a2's finding, #1130).
 */
export function standingMemberships(
  linkKind: string,
  memberships: ReadonlyArray<{ communityDid: string; personaDid: string }>
): ReadonlyArray<{ communityDid: string; personaDid: string }> {
  return linkKind === 'revoked' ? [] : memberships
}

/** A room as a listing gives it: its id, its standing and end. */
export interface ListedRoom {
  roomId: string
  standing?: string
  validUntil?: string
}

/** Empties the copy of each listed room the listing says is gone: listed as removed or lapsed, or past its end. */
export async function emptyGoneRooms(agent: CacheWallet, rooms: readonly ListedRoom[], now = Date.now()) {
  let n = 0
  for (const room of rooms) {
    const gone =
      room.standing === 'removed' ||
      room.standing === 'lapsed' ||
      (room.validUntil !== undefined && Date.parse(room.validUntil) <= now)
    if (gone) n += await emptyMessageCache(agent, { room: room.roomId }, 'access gone')
  }
  return n
}

let bound: CacheWallet | undefined
let listening = false
let cacheLog: ((line: string) => void) | undefined

/**
 * How many copies are kept, how many hold posts, and how many emptyings wait in the journal: counts only, never which.
 * What a report reads to see an emptying happen (the device proof reads it, plan phase 3).
 */
export async function messageCacheCounts(
  agent: CacheWallet
): Promise<{ records: number; kept: number; journal: number; bytes: number }> {
  const records = await agent.genericRecords.findAllByQuery({ type: RECORD_TYPE })
  const { entries } = await journalOf(agent)
  const kept = records.map(contentOf).filter((c) => !!c)
  // The posts' bytes as kept, what the caps count (the device proof reports them: c0).
  const bytes = kept.reduce((n, c) => n + utf8ToBytes(JSON.stringify(c?.posts ?? [])).length, 0)
  return { records: records.length, kept: kept.length, journal: entries.length, bytes }
}

/** Says the counts, after `reason`: one line, counts and a kind only. */
async function sayCounts(agent: CacheWallet, reason: string): Promise<void> {
  if (!cacheLog) return
  try {
    const c = await messageCacheCounts(agent)
    cacheLog(`[Rooms:cache] records ${c.records}, kept ${c.kept}, bytes ${c.bytes}, journal ${c.journal} (${reason})`)
  } catch {
    // Only a line.
  }
}
/** The agent the cache answers events for: the app's, bound when its rooms service starts (`bindMessageCache`). */
export function boundCacheAgent(): CacheWallet | undefined {
  return bound
}

/**
 * Binds the cache to the app's agent, listens once for what ends access without a screen in view (a community's
 * removal notice, an agent being unlinked), and sweeps. A failure is said by kind only, and the next start sweeps again.
 */
export async function bindMessageCache(
  agent: unknown,
  current: () => Promise<ReadonlyArray<{ communityDid: string; personaDid: string }>>,
  log?: (line: string) => void
): Promise<void> {
  if (!isCacheWallet(agent)) return
  bound = agent
  if (log) cacheLog = log
  log?.(
    `[Rooms:cache] ROOMS_MESSAGE_CACHE on=${ROOMS_MESSAGE_CACHE.on === true} remoteOff=${ROOMS_MESSAGE_CACHE.remoteOff === true} biometrics=${await biometryGate().catch(() => false)}`
  )
  if (!listening) {
    listening = true
    DeviceEventEmitter.addListener(VTI_REMOVED_EVENT, (e: { communityDid?: unknown } | undefined) => {
      const target = bound
      if (target && typeof e?.communityDid === 'string')
        emptyMessageCache(target, { community: e.communityDid }, 'removed').catch(() =>
          log?.('[Rooms:cache] a removal was not applied to the kept posts; the next start does')
        )
    })
    // Each listing of the member's rooms: a room listed as removed, lapsed or past its end loses its kept posts.
    onRoomsListed((_service, rooms) => {
      const target = bound
      if (target)
        emptyGoneRooms(target, rooms).catch(() =>
          log?.('[Rooms:cache] a room gone was not applied to the kept posts; the next start does')
        )
    })
    DeviceEventEmitter.addListener(VTA_UNLINKING_EVENT, () => {
      const target = bound
      if (target)
        emptyMessageCache(target, { all: true }, 'unlinked').catch(() =>
          log?.('[Rooms:cache] an unlink was not applied to the kept posts; the next start does')
        )
    })
  }
  try {
    // The memberships are read inside the sweep's turn, so no read or keep runs before it.
    const n = await sweepMessageCache(agent, current)
    if (n > 0) log?.(`[Rooms:cache] ${n} rooms' kept posts emptied at start`)
    await sayCounts(agent, 'start')
  } catch {
    log?.('[Rooms:cache] the kept posts were not swept at start; the next start does')
  }
}

/** For tests: forget what is bound. */
export function resetMessageCache(): void {
  emptiedThisRun = []
  bound = undefined
  cacheLog = undefined
  biometryNow = undefined
  turn = Promise.resolve()
}
