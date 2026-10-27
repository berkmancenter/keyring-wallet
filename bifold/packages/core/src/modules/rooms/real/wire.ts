/**
 * The rooms Trust Tasks R1 sends, and parsers for what comes back. Every shape is read from the
 * Trust Task specs (dtgwg-trust-tasks-tf: `rooms/keys/{list,browse,read}`, `vtc/rooms/memberships/list`).
 * The parsers accept only what the specs define and drop anything else, so a malformed or hostile
 * answer can at worst lose a row, never inject one.
 */
import type { HostCheck, RoomTier, RoomVerb } from '../types'

const SPEC = 'https://trusttasks.org/spec/'

export const ROOMS_TASK = {
  keysList01: `${SPEC}rooms/keys/list/0.1`,
  keysList02: `${SPEC}rooms/keys/list/0.2`,
  keysBrowse: `${SPEC}rooms/keys/browse/0.1`,
  keysRead: `${SPEC}rooms/keys/read/0.1`,
  membershipsList: `${SPEC}vtc/rooms/memberships/list/0.1`,
} as const

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const TIERS: readonly RoomTier[] = ['open', 'attributed', 'private']
const VERBS: readonly RoomVerb[] = ['read', 'write', 'curate', 'admin']

/** One room the key holder can open (`rooms/keys/list`, 0.1 or 0.2). Custody only: no name, tier or host. */
export interface HeldRoom {
  roomId: string
  epoch: number
  earliestReadableEpoch: number
  /** 0.2: the member the keys are held as. */
  member?: string
  /** 0.2: the member's own label for the room, asked for with `includePersonal`. */
  personalLabel?: string
}

export function parseKeysList(payload: unknown): HeldRoom[] {
  return arr(obj(payload)?.rooms).flatMap((raw) => {
    const r = obj(raw)
    const roomId = str(r?.roomId)
    const epoch = int(r?.epoch)
    const earliest = int(r?.earliestReadableEpoch)
    if (!r || !roomId || epoch === undefined || earliest === undefined) return []
    const personal = obj(r.personal)
    return [
      { roomId, epoch, earliestReadableEpoch: earliest, member: str(r.member), personalLabel: str(personal?.label) },
    ]
  })
}

/** One room in the community's record of the member (`vtc/_shared` `RoomMembership`). */
export interface RoomMembershipRecord {
  roomId: string
  host: string
  label?: string
  description?: string
  tier: RoomTier
  actions: RoomVerb[]
  validUntil?: string
  state: 'offered' | 'admitted' | 'removed' | 'other'
}

export function parseMemberships(payload: unknown): { items: RoomMembershipRecord[]; nextCursor?: string } {
  const p = obj(payload)
  const items = arr(p?.items).flatMap((raw): RoomMembershipRecord[] => {
    const m = obj(raw)
    const roomId = str(m?.roomId)
    const host = str(m?.host)
    const visibility = str(m?.visibility)
    if (!m || !roomId || !host || !visibility || !TIERS.includes(visibility as RoomTier)) return []
    const state = str(m.state)
    return [
      {
        roomId,
        host,
        label: str(m.label),
        description: str(m.description),
        tier: visibility as RoomTier,
        actions: arr(m.actions).filter((a): a is RoomVerb => VERBS.includes(a as RoomVerb)),
        validUntil: str(m.validUntil),
        state: state === 'offered' || state === 'admitted' || state === 'removed' ? state : 'other',
      },
    ]
  })
  return { items, nextCursor: str(p?.nextCursor) }
}

/** One record's metadata in a listing (`rooms/_shared` `RecordMetadata`). */
export interface RecordMeta {
  key: string
  version: number
  status: 'active' | 'deprecated' | 'retracted'
  updatedAt?: string
  title?: string
  author?: string
}

const STATUSES = ['active', 'deprecated', 'retracted'] as const
const statusOf = (v: unknown): RecordMeta['status'] =>
  STATUSES.includes(v as RecordMeta['status']) ? (v as RecordMeta['status']) : 'active'

export function parseBrowse(payload: unknown): { records: RecordMeta[]; complete: boolean; check: HostCheck } {
  const p = obj(payload)
  const records = arr(p?.records).flatMap((raw) => {
    const r = obj(raw)
    const key = str(r?.key)
    const version = int(r?.version)
    if (!r || !key || version === undefined) return []
    return [
      {
        key,
        version,
        status: statusOf(r.status),
        updatedAt: str(r.updatedAt),
        title: str(r.title),
        author: str(r.author),
      },
    ]
  })
  return { records, complete: p?.complete !== false, check: hostCheckOf(p?.verification) }
}

/** One opened record (`rooms/keys/read`). The body is decoded text, or the open room's cleartext as JSON text. */
export interface OpenedRecord extends RecordMeta {
  body: string
  check: HostCheck
}

export function parseRead(payload: unknown, decodeBase64Url: (s: string) => string): OpenedRecord | undefined {
  const p = obj(payload)
  const key = str(p?.key)
  const version = int(p?.version)
  if (!p || !key || version === undefined) return undefined
  const status = statusOf(p.status)
  const plaintext = str(p.plaintext)
  const cleartext = obj(p.cleartext)
  const raw =
    status === 'retracted' ? '' : plaintext ? decodeBase64Url(plaintext) : cleartext ? JSON.stringify(cleartext) : ''
  // A record body is application-defined. Keyring's notes are `{ title, body }` JSON; anything else is shown whole.
  let title: string | undefined
  let body = raw
  try {
    const parsed = obj(JSON.parse(raw))
    if (parsed && typeof parsed.body === 'string') {
      body = parsed.body
      title = str(parsed.title)
    }
  } catch {
    // Not JSON: shown as it is.
  }
  return {
    key,
    version,
    status,
    updatedAt: str(p.updatedAt),
    author: str(p.author),
    title,
    body,
    check: hostCheckOf(p.verification),
  }
}

/**
 * The agent's verdict on the host's answer (`ReadVerification`), reduced to one word for a screen.
 * Any check that failed is a conflict. All that ran agreeing, with at least one that ran, is
 * consistent. Anything else, checks that could not be made, is unverified.
 */
export function hostCheckOf(verification: unknown): HostCheck {
  const v = obj(verification)
  if (!v) return { verdict: 'unverified', detail: 'the agent reported no verification' }
  const failed = [
    v.priorRoots === 'conflict' && 'the host contradicts what it served before',
    v.anchor === 'conflict' && "the host contradicts the room's witnessed anchor",
    v.anchor === 'behind' && "the host is behind the room's witnessed anchor (a possible rollback)",
    v.trace === 'failed' && "a record does not match the host's commitment",
    v.count === 'short' && 'the host returned fewer records than it committed to',
  ].filter((d): d is string => typeof d === 'string')
  if (failed.length > 0) return { verdict: 'conflict', detail: failed.join('; ') }
  const agreed = [v.priorRoots === 'agree', v.anchor === 'agrees', v.trace === 'verified', v.count === 'agrees']
  const unknown = [
    v.priorRoots === 'noneHeld' || v.priorRoots === 'notChecked',
    v.anchor === 'none' || v.anchor === 'notChecked' || v.anchor === 'ahead',
  ]
  if (agreed.some(Boolean) && !unknown.some(Boolean))
    return { verdict: 'consistent', detail: 'every check made agreed' }
  return { verdict: 'unverified', detail: 'some checks could not be made (a first read, or no anchor published)' }
}
