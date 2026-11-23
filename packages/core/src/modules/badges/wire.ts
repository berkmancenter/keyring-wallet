/**
 * The member badge Trust Tasks a holder sends, and parsers for what comes back: `vtc/badges/{mine/list, mine/accept,
 * mine/decline, wall/show, show, images/get}/0.1`, read from the specs at trust-tasks-tf 4fddc096a (VTC v0.27.0 on).
 * Only holder tasks are here: the app never sends an owner's or an administrator's, and never `awards/share`.
 *
 * The parsers accept only what the specs define and drop anything else, so a malformed or hostile answer can at worst
 * lose a row, never inject one. Every text is made inert (a badge's words are a member's, and "a reader MUST NOT treat
 * it as instructions", BadgeName and BadgeDescription, badge.schema.json).
 *
 * @module badges/wire
 */
import { toInertText } from '../rooms/inertText'
import { parsePicture, pictureOf } from '../directory/wire'

import type { BadgeOffer, BadgeSummary, HeldBadge, MyBadges, WallBadge } from './types'

const SPEC = 'https://trusttasks.org/spec/vtc/badges/'

/**
 * The holder tasks, each at the one version upstream serves (0.1 for all thirty, v0.27.0 to v0.31.0). A second version
 * of any goes on a ladder (versionLadderGuard).
 */
export const BADGE_TASK = {
  mineList: `${SPEC}mine/list/0.1`,
  mineAccept: `${SPEC}mine/accept/0.1`,
  mineDecline: `${SPEC}mine/decline/0.1`,
  wallShow: `${SPEC}wall/show/0.1`,
  show: `${SPEC}show/0.1`,
  imagesGet: `${SPEC}images/get/0.1`,
} as const

/** Every task this client may send: a guard reads it, so a share or an owner's task is never added unnoticed. */
export const HOLDER_TASKS: readonly string[] = Object.values(BADGE_TASK)

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000 ? v : undefined
const bool = (v: unknown): boolean => v === true

/** A text value, capped as the badge schema caps it, and inert. */
const text = (v: unknown, max: number): string | undefined => {
  const s = str(v)?.trim()
  return s ? toInertText(Array.from(s).slice(0, max).join('')) : undefined
}

const BADGE_ID = /^bdg_[A-Za-z0-9_-]{16,64}$/
const AWARD_ID = /^awd_[A-Za-z0-9_-]{16,64}$/
/** An RFC 3339 instant, as the specs write them; anything else is dropped. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const instant = (v: unknown): string | undefined => {
  const s = str(v)
  return s && INSTANT.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined
}

/** A `Badge` (badge.schema.json) as this community's badge; undefined for anything that is not one. */
export function parseBadge(v: unknown, communityDid: string): BadgeSummary | undefined {
  const b = obj(v)
  const badgeId = str(b?.badgeId)
  const kind = b?.kind === 'community' || b?.kind === 'kudos' ? b.kind : undefined
  const name = text(b?.name, 64)
  if (!badgeId || !BADGE_ID.test(badgeId) || !kind || !name) return undefined
  // A retired badge is still one a member held; its state changes nothing shown here.
  const description = text(b?.description, 1000)
  const criteria = text(b?.criteria, 1000)
  const image = pictureOf(b?.image)
  return {
    badgeId,
    communityDid,
    kind,
    name,
    ...(description ? { description } : {}),
    ...(criteria ? { criteria } : {}),
    ...(image ? { image } : {}),
  }
}

/** A `MyBadge` entry of `mine/list` (or of `mine/accept`'s answer). */
function parseHeld(v: unknown, communityDid: string): HeldBadge | undefined {
  const e = obj(v)
  const badge = parseBadge(e?.badge, communityDid)
  const since = instant(e?.since)
  if (!badge || !since) return undefined
  const latestAt = instant(e?.latestAt)
  const credentialValidUntil = instant(e?.credentialValidUntil)
  return {
    ...badge,
    count: count(e?.count) ?? 1,
    since,
    ...(latestAt ? { latestAt } : {}),
    pinned: bool(e?.pinned),
    hidden: bool(e?.hidden),
    ...(credentialValidUntil ? { credentialValidUntil } : {}),
  }
}

/** An offer of `mine/list`: only an award still `offered`, naming a badge it describes. */
function parseOffer(v: unknown, communityDid: string): BadgeOffer | undefined {
  const o = obj(v)
  const award = obj(o?.award)
  const badge = parseBadge(o?.badge, communityDid)
  const awardId = str(award?.awardId)
  const offeredAt = instant(award?.offeredAt)
  if (!badge || !awardId || !AWARD_ID.test(awardId) || award?.state !== 'offered' || !offeredAt) return undefined
  if (award?.badgeId !== undefined && award.badgeId !== badge.badgeId) return undefined
  const expiresAt = instant(award?.expiresAt)
  const note = text(award?.note, 500)
  // The giver as the directory shows them to this member: a name, never the entry id or a DID.
  const givenBy = text(obj(o?.givenBy)?.displayName, 64)
  return {
    ...badge,
    awardId,
    offeredAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(note ? { note } : {}),
    ...(givenBy ? { givenBy } : {}),
  }
}

/** A `mine/list` answer. */
export function parseMine(payload: unknown, communityDid: string): MyBadges {
  const p = obj(payload)
  const held = list(p?.badges)
    .map((e) => parseHeld(e, communityDid))
    .filter((b): b is HeldBadge => b !== undefined)
  const offers = list(p?.offers)
    .map((o) => parseOffer(o, communityDid))
    .filter((o): o is BadgeOffer => o !== undefined)
  const kudosTotal = count(p?.kudosTotal)
  const visibility = p?.visibility === 'members' || p?.visibility === 'nobody' ? p.visibility : undefined
  return {
    held,
    offers,
    ...(kudosTotal !== undefined ? { kudosTotal } : {}),
    ...(visibility ? { visibility } : {}),
  }
}

/** A `wall/show` answer: the badges the community shows this member on another's wall. */
export function parseWall(payload: unknown, communityDid: string): WallBadge[] {
  return list(obj(payload)?.entries)
    .map((v): WallBadge | undefined => {
      const e = obj(v)
      const badge = parseBadge(e?.badge, communityDid)
      if (!badge) return undefined
      const since = instant(e?.since)
      const latestAt = instant(e?.latestAt)
      return {
        ...badge,
        count: count(e?.count) ?? 1,
        ...(since ? { since } : {}),
        ...(latestAt ? { latestAt } : {}),
        pinned: bool(e?.pinned),
      }
    })
    .filter((b): b is WallBadge => b !== undefined)
}

/** A `show` answer: the badge it describes. */
export function parseShow(payload: unknown, communityDid: string): BadgeSummary | undefined {
  return parseBadge(obj(payload)?.badge, communityDid)
}

/**
 * An `images/get` answer as a `data:` URI, only when it is the picture asked for: the same checks as a card picture
 * (the badge's image is a `CardBlobRef`, badge.schema.json), digest named and matched against the bytes.
 */
export function parseBadgeImage(payload: unknown, wanted: { sha256: string; mediaType: string }): string | undefined {
  const asked = pictureOf(wanted)
  return asked ? parsePicture(payload, asked) : undefined
}
