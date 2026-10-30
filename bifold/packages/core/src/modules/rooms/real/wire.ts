/**
 * The rooms Trust Tasks the real service sends, and parsers for what comes back. Every shape is read from
 * the Trust Task specs (dtgwg-trust-tasks-tf, as `@openvtc/trust-tasks` 0.27 ships them:
 * `rooms/keys/{list,browse,read,key-package,welcome,backfill,act,seal}`, `vtc/rooms/{memberships,offers}/*`,
 * `vault/credentials/{receive,query,get}`, `rooms/records/{put,curate}`).
 * The parsers accept only what the specs define and drop anything else, so a malformed or hostile
 * answer can at worst lose a row, never inject one.
 */
import type { HostCheck, RecordPrune, RoomTier, RoomVerb } from '../types'

const SPEC = 'https://trusttasks.org/spec/'

export const ROOMS_TASK = {
  keysList01: `${SPEC}rooms/keys/list/0.1`,
  keysList02: `${SPEC}rooms/keys/list/0.2`,
  // Agents from vta-service 0.67's nightly (upstream e6380bf1) serve browse at 0.3 only; older ones at 0.1.
  keysBrowse03: `${SPEC}rooms/keys/browse/0.3`,
  keysBrowse: `${SPEC}rooms/keys/browse/0.1`,
  keysRead: `${SPEC}rooms/keys/read/0.1`,
  membershipsList: `${SPEC}vtc/rooms/memberships/list/0.1`,
  // 0.4 renames a renewal's `renews` to `renewsAt` (VTC 0.16 serves only 0.4; 0.15 serves 0.2 and 0.4); 0.3 adds the
  // renewals of rooms the member is already in; 0.2 is asked of a community without them.
  offersList04: `${SPEC}vtc/rooms/offers/list/0.4`,
  offersList03: `${SPEC}vtc/rooms/offers/list/0.3`,
  offersList02: `${SPEC}vtc/rooms/offers/list/0.2`,
  offersAccept: `${SPEC}vtc/rooms/offers/accept/0.1`,
  keysKeyPackage: `${SPEC}rooms/keys/key-package/0.2`,
  keysWelcome: `${SPEC}rooms/keys/welcome/0.1`,
  keysBackfill: `${SPEC}rooms/keys/backfill/0.2`,
  vaultReceive: `${SPEC}vault/credentials/receive/0.1`,
  vaultQuery: `${SPEC}vault/credentials/query/0.1`,
  // The spec's 0.2 is asked where served. VTAs up to 0.66 serve only 0.1: the same request, and an answer whose
  // `credential` is the one a room's credentials (JSON objects) come back in under 0.2 as well.
  vaultGet02: `${SPEC}vault/credentials/get/0.2`,
  vaultGet01: `${SPEC}vault/credentials/get/0.1`,
  // The same request and answer at every version; each completes a wider table. 0.9 adds `rooms/records/put/0.4`;
  // 0.8 adds what 0.7 did (`vtc/rooms/offers/list/0.4`, `rooms/records/put/0.3`, …) and pruning; 0.6 adds
  // `vtc/rooms/offers/list/0.3` to 0.5. VTAs from 0.68 serve only 0.8 (main adds 0.9); the lab's pin serves 0.5/0.6.
  keysAct09: `${SPEC}rooms/keys/act/0.9`,
  keysAct08: `${SPEC}rooms/keys/act/0.8`,
  keysAct06: `${SPEC}rooms/keys/act/0.6`,
  keysAct05: `${SPEC}rooms/keys/act/0.5`,
  // 0.2 signs the body as the member before sealing it (`signAsPrincipal`); 0.1 cannot write as the member.
  keysSeal02: `${SPEC}rooms/keys/seal/0.2`,
  recordsPut: `${SPEC}rooms/records/put/0.1`,
  // 0.1 with optional members Keyring does not send (`blobs`, an open room's provenance). Completed only by
  // `rooms/keys/act` from 0.8 (0.7's table added it); hosts from VTA 0.68 serve only 0.3, the lab's pin 0.1 and 0.3.
  recordsPut03: `${SPEC}rooms/records/put/0.3`,
  recordsCurate: `${SPEC}rooms/records/curate/0.1`,
} as const

/** The `rooms/keys/act` versions this client speaks, newest first: the agent is asked at the newest it serves. */
export const KEYS_ACT_TYPES = [
  ROOMS_TASK.keysAct09,
  ROOMS_TASK.keysAct08,
  ROOMS_TASK.keysAct06,
  ROOMS_TASK.keysAct05,
] as const

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

/**
 * One offer of a room the community owns (`vtc/rooms/offers/list` 0.2–0.4 `OfferV2`). The credentials are the
 * community's JSON text, stored in the member's agent on accept and never shown.
 */
export interface OfferRecord {
  roomId: string
  host: string
  label: string
  description?: string
  tier: RoomTier
  actions: RoomVerb[]
  validUntil?: string
  /** `accepted`: kept listed while a repeated accept can still be answered. */
  state: 'open' | 'accepted'
  credentials: { invitation: string; membership: string; authority: string }
}

/** A renewal of an admission the member holds (`vtc/rooms/offers/list` 0.3 and 0.4 `renewals`). */
export interface RenewalRecord {
  roomId: string
  host: string
  validUntil: string
  /** When the authority it replaces expires. */
  renews: string
  issuedAt: string
  credentials: { membership: string; authority: string }
}

const credentialsOf = <K extends string>(v: unknown, keys: readonly K[]): Record<K, string> | undefined => {
  const c = obj(v)
  if (!c) return undefined
  const out = {} as Record<K, string>
  for (const k of keys) {
    const value = str(c[k])
    if (!value) return undefined
    out[k] = value
  }
  return out
}

/** The `vtc/rooms/offers/list` versions this client speaks, newest first. */
export const OFFERS_LIST_TYPES = [ROOMS_TASK.offersList04, ROOMS_TASK.offersList03, ROOMS_TASK.offersList02] as const

export function parseOffers(payload: unknown): {
  items: OfferRecord[]
  renewals: RenewalRecord[]
  nextCursor?: string
} {
  const p = obj(payload)
  const items = arr(p?.items).flatMap((raw): OfferRecord[] => {
    const o = obj(raw)
    const roomId = str(o?.roomId)
    const host = str(o?.host)
    const visibility = str(o?.visibility)
    const state = str(o?.state)
    const credentials = credentialsOf(o?.credentials, ['invitation', 'membership', 'authority'] as const)
    if (!o || !roomId || !host || !TIERS.includes(visibility as RoomTier) || !credentials) return []
    if (state !== 'open' && state !== 'accepted') return []
    return [
      {
        roomId,
        host,
        label: str(o.label) ?? '',
        description: str(o.description),
        tier: visibility as RoomTier,
        actions: arr(o.actions).filter((a): a is RoomVerb => VERBS.includes(a as RoomVerb)),
        validUntil: str(o.validUntil),
        state,
        credentials,
      },
    ]
  })
  const renewals = arr(p?.renewals).flatMap((raw): RenewalRecord[] => {
    const r = obj(raw)
    const roomId = str(r?.roomId)
    const host = str(r?.host)
    const validUntil = str(r?.validUntil)
    // 0.4 names it `renewsAt`, 0.3 `renews`; the same instant.
    const renews = str(r?.renewsAt) ?? str(r?.renews)
    const issuedAt = str(r?.issuedAt)
    const credentials = credentialsOf(r?.credentials, ['membership', 'authority'] as const)
    if (!roomId || !host || !validUntil || !renews || !issuedAt || !credentials) return []
    return [{ roomId, host, validUntil, renews, issuedAt, credentials }]
  })
  return { items, renewals, nextCursor: str(p?.nextCursor) }
}

/** The community's answer to an accept (`vtc/rooms/offers/accept/0.1`). Undefined unless it says `admitted`. */
export function parseAccept(
  payload: unknown
): { roomId: string; epoch?: number; welcome?: string; ratchetTree?: string } | undefined {
  const p = obj(payload)
  const roomId = str(p?.roomId)
  if (!p || !roomId || p.state !== 'admitted') return undefined
  return { roomId, epoch: int(p.epoch), welcome: str(p.welcome), ratchetTree: str(p.ratchetTree) }
}

/** The agent's KeyPackage for an offer's invitation (`rooms/keys/key-package/0.2`). */
export function parseKeyPackage(payload: unknown): { keyPackage: string; alreadyMinted: boolean } | undefined {
  const p = obj(payload)
  const keyPackage = str(p?.keyPackage)
  if (!keyPackage || typeof p?.alreadyMinted !== 'boolean') return undefined
  return { keyPackage, alreadyMinted: p.alreadyMinted }
}

/** The handles a vault query answered with, and the validity the vault computed for each (`vault/credentials/query/0.1`). */
export function parseVaultQuery(payload: unknown): { id: string; validUntil?: string }[] {
  return arr(obj(payload)?.credentials).flatMap((raw) => {
    const d = obj(raw)
    const id = str(d?.id)
    return id ? [{ id, validUntil: str(d?.validUntil) }] : []
  })
}

/** The subject of a stored credential (`vault/credentials/get/0.2`): who it was issued to. */
export function vaultCredentialSubject(payload: unknown): string | undefined {
  return str(obj(obj(obj(payload)?.credential)?.credentialSubject)?.id)
}

/**
 * A room request the agent completed as the member (`rooms/keys/act`): the member it signed as, and the
 * document to send to its recipient unaltered. Undefined unless the document is signed and names that member.
 */
export function parseActed(payload: unknown): { principal: string; document: Record<string, unknown> } | undefined {
  const p = obj(payload)
  const principal = str(p?.principal)
  const document = obj(p?.document)
  if (!principal || !document || document.issuer !== principal || !obj(document.proof)) return undefined
  return { principal, document }
}

/** The host's answer to a write (`rooms/records/put/0.1`): the record's key and the version it was given. */
export function parsePut(payload: unknown): { key: string; version: number } | undefined {
  const p = obj(payload)
  const key = str(p?.key)
  const version = int(p?.version)
  return key && version !== undefined && version >= 1 ? { key, version } : undefined
}

/** One record sealed by the agent (`rooms/keys/seal/0.2`), as `rooms/records/put` takes it: ciphertext only. */
export interface SealedRecord {
  ciphertext: string
  nonce: string
  epoch: number
}

export function parseSealed(payload: unknown): SealedRecord | undefined {
  const s = obj(obj(payload)?.sealed)
  const ciphertext = str(s?.ciphertext)
  const nonce = str(s?.nonce)
  const epoch = int(s?.epoch)
  return ciphertext && nonce && epoch !== undefined && epoch >= 0 ? { ciphertext, nonce, epoch } : undefined
}

/** The host's answer to a curation (`rooms/records/curate/0.1`). */
export function parseCurate(
  payload: unknown
): { key: string; version: number; status: RecordMeta['status'] } | undefined {
  const p = obj(payload)
  const key = str(p?.key)
  const version = int(p?.version)
  if (!key || version === undefined || !STATUSES.includes(p?.status as RecordMeta['status'])) return undefined
  return { key, version, status: p?.status as RecordMeta['status'] }
}

/**
 * The code a refusal carried, without its task prefix: a task's own code where the refusal names one in its
 * `details`, else the framework's. Undefined for anything that is not a refusal (no answer, a dropped
 * connection), which a caller passes on unchanged. Both legs refuse with a `VtiRefusal`.
 */
export function refusalCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'VtiRefusal') return undefined
  const e = error as Error & { code?: unknown; details?: unknown }
  const named = str(obj(e.details)?.code) ?? str(e.code)
  return named?.slice(named.lastIndexOf(':') + 1)
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

/**
 * A listing's `lastPrune`, as the agent passes on the host's mark: `prunedAt` from `rooms/_shared/0.2`, `at` from a
 * host still on 0.1 (vti-rooms `RecordPrune::to_wire` before it was renamed). Undefined without a whole `version`,
 * the one member a reader acts on.
 */
function parsePrune(v: unknown): RecordPrune | undefined {
  const p = obj(v)
  const version = int(p?.version)
  if (version === undefined) return undefined
  return { version, prunedAt: str(p?.prunedAt) ?? str(p?.at) ?? '', removed: int(p?.removed) ?? 0 }
}

export function parseBrowse(payload: unknown): {
  records: RecordMeta[]
  complete: boolean
  check: HostCheck
  lastPrune?: RecordPrune
} {
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
  const lastPrune = parsePrune(p?.lastPrune)
  return {
    records,
    complete: p?.complete !== false,
    check: hostCheckOf(p?.verification),
    ...(lastPrune ? { lastPrune } : {}),
  }
}

/**
 * A sealed record's file: what its author signed about it, sealed with the record (`FileManifest`,
 * `rooms/_shared/0.1/blobs.schema.json`; vti-rooms `files.rs` @ vta-service-v0.67.0). No host task carries it: only a
 * member who opened the record has it. `name` is untrusted text.
 */
export interface FileManifest {
  /** 32 random bytes, base64url without padding. */
  fileId: string
  name: string
  mediaType?: string
  /** Plaintext bytes, before padding. */
  size: number
  /** Digest of the plaintext. */
  digest: string
  epoch: number
  segmentSize: number
  padding?: 'none' | 'padme'
  blobRef: string
}

const FILE_MANIFEST_FIELDS = new Set([
  'fileId',
  'name',
  'mediaType',
  'size',
  'digest',
  'epoch',
  'segmentSize',
  'padding',
  'blobRef',
])
const FILE_ID = /^[A-Za-z0-9_-]{43}$/

/** A body's `file`, or undefined when it is missing or not a manifest: as upstream, an unknown member is refused. */
export function parseFileManifest(v: unknown): FileManifest | undefined {
  const m = obj(v)
  if (!m || Object.keys(m).some((k) => !FILE_MANIFEST_FIELDS.has(k))) return undefined
  const fileId = str(m.fileId)
  const name = typeof m.name === 'string' ? m.name : undefined
  const size = int(m.size)
  const digest = str(m.digest)
  const epoch = int(m.epoch)
  const segmentSize = int(m.segmentSize)
  const blobRef = str(m.blobRef)
  if (!fileId || !FILE_ID.test(fileId) || name === undefined || size === undefined || size < 0) return undefined
  if (!digest || epoch === undefined || segmentSize === undefined || segmentSize <= 0 || !blobRef) return undefined
  if (m.mediaType !== undefined && typeof m.mediaType !== 'string') return undefined
  if (m.padding !== undefined && m.padding !== 'none' && m.padding !== 'padme') return undefined
  return {
    fileId,
    name,
    ...(typeof m.mediaType === 'string' ? { mediaType: m.mediaType } : {}),
    size,
    digest,
    epoch,
    segmentSize,
    ...(m.padding !== undefined ? { padding: m.padding as 'none' | 'padme' } : {}),
    blobRef,
  }
}

/** One opened record (`rooms/keys/read`). The body is decoded text, or the open room's cleartext as JSON text. */
export interface OpenedRecord extends RecordMeta {
  body: string
  check: HostCheck
  /** The file a sealed record carries, from its body's `file`. */
  file?: FileManifest
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
  // A record body is application-defined. Keyring's notes are `{ title, body }` JSON, and a sealed room's body is a
  // signed SealedRecordBody with the same members. A file record has no `body`: its words are none, and its file is
  // the body's `file`, never the JSON shown as text (the 276 display bug). Anything else is shown whole.
  let title: string | undefined
  let body = raw
  let file: FileManifest | undefined
  try {
    const parsed = obj(JSON.parse(raw))
    file = parseFileManifest(parsed?.file)
    if (parsed && (typeof parsed.body === 'string' || file)) {
      body = typeof parsed.body === 'string' ? parsed.body : ''
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
    ...(file ? { file } : {}),
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
