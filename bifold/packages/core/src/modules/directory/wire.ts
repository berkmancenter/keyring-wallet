/**
 * The directory Trust Tasks a member sends, and parsers for what comes back: `vtc/directory/{entries/list,
 * card/show, card/update, fields/list}/0.1`, read from the specs at trust-tasks 0.32, the version VTC 0.12 builds
 * against. The parsers accept only what the specs define and drop anything else, so a malformed or hostile answer
 * can at worst lose a row, never inject one.
 *
 * @module directory/wire
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { toInertText } from '../rooms/inertText'

import {
  DIRECTORY_AUDIENCES,
  NAME_FIELD,
  PICTURE_FIELD,
  PICTURE_MEDIA_TYPES,
  ROLE_FIELD,
  type CardEntry,
  type CardField,
  type CardPicture,
  type CardValue,
  type DirectoryAudience,
  type MemberCard,
  type MemberPage,
  type MemberRow,
  type MyCard,
  type PictureMediaType,
} from './types'

const SPEC = 'https://trusttasks.org/spec/'

export const DIRECTORY_TASK = {
  // vtc-service 0.16 serves the members list at 0.2 only, 0.12 at 0.1 only; 0.2's last page has no `nextCursor`.
  entriesList02: `${SPEC}vtc/directory/entries/list/0.2`,
  entriesList: `${SPEC}vtc/directory/entries/list/0.1`,
  cardShow: `${SPEC}vtc/directory/card/show/0.1`,
  cardUpdate: `${SPEC}vtc/directory/card/update/0.1`,
  fieldsList: `${SPEC}vtc/directory/fields/list/0.1`,
  query: `${SPEC}vtc/directory/query/0.1`,
  entriesShow: `${SPEC}vtc/directory/entries/show/0.1`,
  // vtc-service 0.13 and later; an older community refuses it as an unsupported type.
  imagesGet: `${SPEC}vtc/directory/images/get/0.1`,
  imagesUpload: `${SPEC}vtc/directory/images/upload/0.1`,
} as const

/** A page as the community serves it by default; at most 100 (`entries/list/0.1`). */
export const MEMBERS_PAGE = 25

const ENTRY_ID = /^dir_[A-Za-z0-9_-]{16,64}$/
const FIELD_KEY = /^([a-z][a-z0-9-]*\.)*[a-z][a-zA-Z0-9]{0,63}$/

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const audienceOf = (v: unknown): DirectoryAudience | undefined =>
  (DIRECTORY_AUDIENCES as readonly unknown[]).includes(v) ? (v as DirectoryAudience) : undefined

/** A text value, capped as the card schema caps a value. */
const text = (v: unknown, max: number) => {
  const s = str(v)?.trim()
  return s ? toInertText(Array.from(s).slice(0, max).join('')) : undefined
}

const SHA256_HEX = /^[0-9a-f]{64}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/
/** The most bytes a stored picture has (`CardBlobRef.size`). */
export const PICTURE_MAX_BYTES = 262_144

const pictureType = (v: unknown): PictureMediaType | undefined =>
  (PICTURE_MEDIA_TYPES as readonly unknown[]).includes(v) ? (v as PictureMediaType) : undefined

/** A `CardBlobRef` as a picture to read; undefined for anything else, or a type a phone doesn't show. */
export function pictureOf(v: unknown): CardPicture | undefined {
  const ref = obj(v)
  const digest = str(ref?.sha256)
  const mediaType = pictureType(ref?.mediaType)
  return digest && SHA256_HEX.test(digest) && mediaType ? { sha256: digest, mediaType } : undefined
}

/**
 * An `images/get/0.1` answer as a `data:` URI, only when it is the picture asked for: the answer names its digest, the
 * bytes are within the size a card holds, and their SHA-256 is that digest. Anything else is no picture.
 */
export function parsePicture(payload: unknown, wanted: CardPicture): string | undefined {
  const p = obj(payload)
  const image = pictureOf(p?.image)
  const data = str(p?.data)
  if (!image || image.sha256 !== wanted.sha256 || !data || !BASE64URL.test(data)) return undefined
  let bytes: Uint8Array
  try {
    bytes = TypedArrayEncoder.fromBase64Url(data)
  } catch {
    return undefined
  }
  if (bytes.length === 0 || bytes.length > PICTURE_MAX_BYTES || bytesToHex(sha256(bytes)) !== wanted.sha256)
    return undefined
  return `data:${image.mediaType};base64,${TypedArrayEncoder.toBase64(bytes)}`
}

/**
 * A `data:` URI (the profile photo) as an `images/upload/0.1` payload: its media type, and its bytes base64url without
 * padding. Undefined for a type a card can't hold, bytes that aren't base64, or more than a card holds.
 */
export function uploadPayload(photo: string): { mediaType: PictureMediaType; data: string } | undefined {
  const m = /^data:([a-z/]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo)
  const mediaType = pictureType(m?.[1])
  if (!m || !mediaType) return undefined
  let bytes: Uint8Array
  try {
    bytes = TypedArrayEncoder.fromBase64(m[2])
  } catch {
    return undefined
  }
  if (bytes.length === 0 || bytes.length > PICTURE_MAX_BYTES) return undefined
  return { mediaType, data: TypedArrayEncoder.toBase64Url(bytes) }
}

/**
 * The reference an `images/upload/0.1` answer gives, as a card's value holds it: digest, media type and size, nothing
 * else (a stored value never carries a URL). Undefined for an answer that is not one.
 */
export function parseUploaded(
  payload: unknown
): { sha256: string; mediaType: PictureMediaType; size?: number } | undefined {
  const image = obj(obj(payload)?.image)
  const picture = pictureOf(image)
  if (!picture) return undefined
  const size = int(image?.size)
  return size !== undefined && size > 0 && size <= PICTURE_MAX_BYTES ? { ...picture, size } : picture
}

/** One page of the members list (`entries/list/0.1` response). */
export function parseEntries(payload: unknown): MemberPage {
  const p = obj(payload)
  const rows = arr(p?.items).flatMap((raw): MemberRow[] => {
    const e = obj(raw)
    const entryId = str(e?.entryId)
    const fields = obj(e?.fields)
    if (!e || !entryId || !ENTRY_ID.test(entryId) || !fields) return []
    return [
      {
        entryId,
        name: text(fields[NAME_FIELD], 64),
        role: text(fields[ROLE_FIELD], 64),
        picture: pictureOf(fields[PICTURE_FIELD]),
        connected: typeof e.connected === 'boolean' ? e.connected : undefined,
      },
    ]
  })
  return { rows, nextCursor: str(p?.nextCursor) }
}

/** The name in a `query/0.1` answer, if it is about `memberDid` and carries one. */
export function parseQueryName(payload: unknown, memberDid: string): string | undefined {
  const p = obj(payload)
  if (str(p?.subject) !== memberDid) return undefined
  return text(obj(p?.fields)?.[NAME_FIELD], 64)
}

/** The member's own card (`card/show/0.1` and `card/update/0.1` responses). */
export function parseCard(payload: unknown): MyCard | undefined {
  const p = obj(payload)
  const card = obj(p?.card)
  const entryId = str(card?.entryId)
  const revision = int(card?.revision)
  const updatedAt = str(card?.updatedAt)
  const values = obj(card?.values)
  if (!card || !entryId || !ENTRY_ID.test(entryId) || revision === undefined || revision < 0 || !updatedAt || !values)
    return undefined
  const visibility: Record<string, DirectoryAudience> = {}
  for (const [key, value] of Object.entries(obj(card.visibility) ?? {})) {
    const audience = audienceOf(value)
    if (FIELD_KEY.test(key) && audience) visibility[key] = audience
  }
  return {
    entryId,
    revision,
    name: text(values[NAME_FIELD], 64),
    picture: pictureOf(values[PICTURE_FIELD]),
    visibility,
    missingRequired: arr(p?.missingRequired).flatMap((k) => (typeof k === 'string' && FIELD_KEY.test(k) ? [k] : [])),
    updatedAt,
  }
}

/**
 * The card's fields, with who sees each (`fields/list/0.1` response), in the community's order. The member's choice
 * on `card` wins over a field's default. Retired and disabled fields are left out.
 */
export function parseFields(payload: unknown, card?: Pick<MyCard, 'visibility'>): CardField[] {
  const out: Array<CardField & { order: number }> = []
  for (const raw of arr(obj(payload)?.fields)) {
    const f = obj(raw)
    const key = str(f?.key)
    const label = text(f?.label, 64)
    const ceiling = audienceOf(f?.ceiling)
    const defaultVisibility = audienceOf(f?.defaultVisibility)
    if (!f || !key || !FIELD_KEY.test(key) || !label || !ceiling || !defaultVisibility) continue
    if (f.state !== 'active') continue
    out.push({
      key,
      label,
      audience: card?.visibility[key] ?? defaultVisibility,
      ceiling,
      writable: f.source === 'member',
      required: f.required === true,
      type: str(f.type),
      order: int(f.order) ?? Number.MAX_SAFE_INTEGER,
    })
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...field }) => field)
}

// Shown in the card's head (name, role, picture), or not shown as a value at all: the identifier, and other pictures.
const NOT_A_CARD_LINE = new Set([NAME_FIELD, ROLE_FIELD, PICTURE_FIELD, 'did'])

/** One value as a card line shows it, by its field's type; undefined for a value of no shape the card schema defines. */
function cardValue(raw: unknown, type: string | undefined): CardValue | undefined {
  if (type === 'image') return undefined
  if (typeof raw === 'boolean') return { kind: 'yesNo', yes: raw }
  if (typeof raw === 'string') {
    const shown = type === 'date' ? raw.slice(0, 10) : raw
    const t = text(shown, 2000)
    return t ? { kind: 'text', text: t } : undefined
  }
  if (Array.isArray(raw)) {
    const items = raw.slice(0, 32).flatMap((item) => {
      const t = text(item, 500)
      return t ? [t] : []
    })
    return items.length ? { kind: 'list', items } : undefined
  }
  const v = obj(raw)
  // A `VerifiedValue`: what a credential the member presented says, with who issued it and when it was checked.
  if (v && str(v.issuer) && str(v.verifiedAt) && v.value !== undefined) {
    const t = text(typeof v.value === 'string' ? v.value : String(v.value), 2000)
    return t ? { kind: 'verified', text: t } : undefined
  }
  return undefined
}

/**
 * Another member's card from the fields the community projected for this member, labelled and ordered by the
 * community's field definitions. A field the definitions do not name is left out: its label could only be its key.
 */
export function parseMemberCard(fields: unknown, definitions: readonly CardField[]): MemberCard {
  const values = obj(fields) ?? {}
  const entries: CardEntry[] = []
  for (const def of definitions) {
    if (NOT_A_CARD_LINE.has(def.key) || !(def.key in values)) continue
    const value = cardValue(values[def.key], def.type)
    if (value) entries.push({ key: def.key, label: def.label, value })
  }
  return {
    name: text(values[NAME_FIELD], 64),
    role: text(values[ROLE_FIELD], 64),
    picture: pictureOf(values[PICTURE_FIELD]),
    entries,
  }
}

/** The fields of an `entries/show/0.1` answer about `entryId`. */
export function entryFields(payload: unknown, entryId: string): Record<string, unknown> | undefined {
  const entry = obj(obj(payload)?.entry)
  return entry && str(entry.entryId) === entryId ? obj(entry.fields) : undefined
}

/** The fields of a `query/0.1` answer about `memberDid`. */
export function queryFields(payload: unknown, memberDid: string): Record<string, unknown> | undefined {
  const p = obj(payload)
  return p && str(p.subject) === memberDid ? obj(p.fields) : undefined
}
