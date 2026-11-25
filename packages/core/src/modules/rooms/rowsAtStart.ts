/**
 * Messages' rows as the last run left them, kept in the agent's encrypted wallet (a generic record), so a cold start
 * shows the member's rooms at once instead of an empty list for the 20-55 s its first listing took on testers' phones
 * (11-17). Each row is shown as reading until that listing replaces them all; a room it does not list is gone with it.
 *
 * What is kept is what a row names: the room, its community and when it was last active. Never a post's words
 * (`lastPost` is left out), as Alberto agreed (11-17: room names, not message text), and no unread count: a row from
 * the last run shows none, and neither does the tab's badge, until the first listing reads it (his word, 11-18). It lives
 * in the wallet, so it is as private as the wallet, goes with it, and is read only while it is open.
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and nothing is read or kept: Messages waits for its first
 *   listing, as before, for everyone at the next start, whatever `on` says, until a release sets it back. That first
 *   start also empties what was kept (`emptyRowsAtStart`): the record is written with no rows, so no room's name stays
 *   in the wallet because of this (ac, 11-18). Emptied in place rather than removed: the record names nothing.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing a person does changes either value; it is read at each start and each keeping, never cached. It fails
 * closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/rowsAtStart
 */
export const ROOMS_ROWS_AT_START: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether Messages may show the last run's rows at a start, and keep this run's: switched on, and not turned off. */
export function isRowsAtStartOn(): boolean {
  return ROOMS_ROWS_AT_START.on === true && ROOMS_ROWS_AT_START.remoteOff === false
}

/** The wallet record the rows are kept in: one per wallet. */
export const ROWS_AT_START_RECORD_ID = 'keyring.rooms.rowsAtStart'

/** How many rows are kept at most, the most recently active first. */
export const ROWS_AT_START_MAX = 64

/** One row as kept: what it names, never a post. */
export interface RowAtStart {
  key: string
  roomId: string
  roomName: string
  nameFrom?: string
  communityDid: string
  communityName?: string
  /** ISO 8601. */
  lastActivityAt?: string
  notJoined?: boolean
}

interface GenericRecordLike {
  content: Record<string, unknown>
}
/** The part of the agent's generic records this uses (Credo `GenericRecordsApi`). */
export interface RowsWallet {
  genericRecords: {
    findById(id: string): Promise<GenericRecordLike | null>
    save(options: { id: string; content: Record<string, unknown>; tags?: Record<string, string> }): Promise<unknown>
    update(record: GenericRecordLike): Promise<void>
  }
}

/** Whether `agent` keeps generic records (the real backend's agent does; the sample's service has none). */
export function isRowsWallet(agent: unknown): agent is RowsWallet {
  const records = (agent as { genericRecords?: Record<string, unknown> } | undefined)?.genericRecords
  return (
    !!records &&
    typeof records.findById === 'function' &&
    typeof records.save === 'function' &&
    typeof records.update === 'function'
  )
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const optionalText = (v: unknown): boolean => v === undefined || typeof v === 'string'

/** A kept row, read strictly: anything not shaped as one is left out. */
function rowOf(raw: unknown): RowAtStart | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!isText(r.key) || !isText(r.roomId) || typeof r.roomName !== 'string' || !isText(r.communityDid)) return undefined
  if (!optionalText(r.nameFrom) || !optionalText(r.communityName) || !optionalText(r.lastActivityAt)) return undefined
  if (r.notJoined !== undefined && typeof r.notJoined !== 'boolean') return undefined
  if (typeof r.lastActivityAt === 'string' && Number.isNaN(Date.parse(r.lastActivityAt))) return undefined
  return {
    key: r.key,
    roomId: r.roomId,
    roomName: r.roomName,
    ...(r.nameFrom !== undefined ? { nameFrom: r.nameFrom as string } : {}),
    communityDid: r.communityDid,
    ...(r.communityName !== undefined ? { communityName: r.communityName as string } : {}),
    ...(r.lastActivityAt !== undefined ? { lastActivityAt: r.lastActivityAt as string } : {}),
    ...(r.notJoined !== undefined ? { notJoined: r.notJoined as boolean } : {}),
  }
}

/** The rows the last run kept, when the switch is on and there are any. A record it cannot read is none. */
export async function readRowsAtStart(agent: RowsWallet): Promise<RowAtStart[] | undefined> {
  if (!isRowsAtStartOn()) return undefined
  const record = await agent.genericRecords.findById(ROWS_AT_START_RECORD_ID)
  const rows = record?.content?.rows
  if (record?.content?.v !== 1 || !Array.isArray(rows)) return undefined
  const read = rows.map(rowOf).filter((row): row is RowAtStart => !!row)
  return read.length > 0 ? read.slice(0, ROWS_AT_START_MAX) : undefined
}

let writing: Promise<void> = Promise.resolve()

/**
 * Writes the kept record with no rows, when there is one with rows: what a start with the switch off does, so the kill
 * undoes what was kept and not only the showing of it. One write in the same turn as the keeps.
 */
export function emptyRowsAtStart(agent: RowsWallet): Promise<void> {
  writing = writing
    .catch(() => undefined)
    .then(async () => {
      const existing = await agent.genericRecords.findById(ROWS_AT_START_RECORD_ID)
      const rows = existing?.content?.rows
      if (!existing || (Array.isArray(rows) && rows.length === 0)) return
      existing.content = { v: 1, rows: [] }
      await agent.genericRecords.update(existing)
    })
  return writing
}

/** Keeps `rows` for the next start, one write after another, when the switch is on. */
export function keepRowsAtStart(agent: RowsWallet, rows: readonly RowAtStart[]): Promise<void> {
  if (!isRowsAtStartOn()) return Promise.resolve()
  const content = { v: 1, rows: rows.slice(0, ROWS_AT_START_MAX) }
  writing = writing
    .catch(() => undefined)
    .then(async () => {
      const existing = await agent.genericRecords.findById(ROWS_AT_START_RECORD_ID)
      if (existing) {
        existing.content = content
        await agent.genericRecords.update(existing)
      } else {
        await agent.genericRecords.save({ id: ROWS_AT_START_RECORD_ID, content, tags: { type: 'rooms.rowsAtStart' } })
      }
    })
  return writing
}
