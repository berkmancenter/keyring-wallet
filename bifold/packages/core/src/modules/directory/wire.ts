/**
 * The directory Trust Tasks a member sends, and parsers for what comes back: `vtc/directory/{entries/list,
 * card/show, card/update, fields/list}/0.1`, read from the specs at trust-tasks 0.32, the version VTC 0.12 builds
 * against. The parsers accept only what the specs define and drop anything else, so a malformed or hostile answer
 * can at worst lose a row, never inject one.
 *
 * @module directory/wire
 */
import { toInertText } from '../rooms/inertText'

import {
  DIRECTORY_AUDIENCES,
  NAME_FIELD,
  ROLE_FIELD,
  type CardField,
  type DirectoryAudience,
  type MemberPage,
  type MemberRow,
  type MyCard,
} from './types'

const SPEC = 'https://trusttasks.org/spec/'

export const DIRECTORY_TASK = {
  entriesList: `${SPEC}vtc/directory/entries/list/0.1`,
  cardShow: `${SPEC}vtc/directory/card/show/0.1`,
  cardUpdate: `${SPEC}vtc/directory/card/update/0.1`,
  fieldsList: `${SPEC}vtc/directory/fields/list/0.1`,
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
        connected: typeof e.connected === 'boolean' ? e.connected : undefined,
      },
    ]
  })
  return { rows, nextCursor: str(p?.nextCursor) }
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
      order: int(f.order) ?? Number.MAX_SAFE_INTEGER,
    })
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...field }) => field)
}
