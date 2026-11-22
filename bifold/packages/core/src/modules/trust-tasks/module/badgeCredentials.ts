/**
 * A community badge credential, as a community issues it: a W3C VC 2.0 +
 * Open Badges 3.0 `OpenBadgeCredential` whose issuer is the community (named
 * as it names itself), whose subject is the member's identity in that
 * community, whose `achievement` is the badge, and with one `evidence` entry
 * per accepted award (VTI vtc-service/src/badges/credential.rs `document()`
 * and `achievement()`, VTI-BDG-060 – 063). It arrives on the ordinary
 * credential-exchange delivery and is kept as any community card is
 * (`vtiInbox`), then shown in the Wallet (`vtiWalletCards`).
 *
 * Two things in upstream's shape decide how it is kept and shown:
 *
 * - every issue and every renewal has a new `urn:uuid` id, and a badge only
 *   members see is short-lived and renewed. So a badge is named by its
 *   community, its holder and its Achievement (`badgeKeyOf`), never by the
 *   credential's id: a re-issue replaces the copy it renews;
 * - the credential carries no picture. The Achievement's `image.id` is
 *   `urn:sha256:<hex>`, or the community's public location for a badge its
 *   holders may show outside. A card fetches the picture from the community
 *   with `images/get` (the badges client), never from a URL, so it contacts
 *   nothing but the member's own community.
 *
 * A badge is a badge: nothing here calls one verified, checked or proven.
 *
 * @module trust-tasks/module/badgeCredentials
 */

type Json = Record<string, unknown>

export const OPEN_BADGE_CREDENTIAL_TYPE = 'OpenBadgeCredential'

/** What the Wallet's badge card shows, read from the credential alone. */
export interface BadgeCardView {
  /** Stable across re-issues and renewals: `${communityDid}|${achievementId}`. */
  badgeKey: string
  /** The plain badge id the badges client takes (`show`, `images/get`), when the Achievement names one. */
  badgeId?: string
  /** The Achievement's own id, as the credential gives it. */
  achievementId?: string
  name: string
  description?: string
  /** The Achievement's `criteria.narrative`. */
  criteria?: string
  /** The issuer: the community. */
  communityDid: string
  /** The name the community gives itself, from the issuer's profile. */
  communityName?: string
  /**
   * The picture's digest, lower-case hex, when the Achievement names it by `urn:sha256:`. A badge
   * named by its public location has none: the badges client's `show()` gives it. Never a URL to load.
   */
  imageSha256?: string
  /** The picture's media type, as the Achievement gives it. */
  imageMediaType?: string
  /** `validFrom`. */
  issuedAt?: string
  validUntil?: string
  /** One per accepted award: the giver's note, and when it was accepted. The holder's own; shown on their card only. */
  evidence: { note?: string; acceptedAt?: string }[]
}

const typesOf = (vc: Json): string[] =>
  Array.isArray(vc.type) ? vc.type.map(String) : vc.type ? [String(vc.type)] : []
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const object = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined
const idOf = (v: unknown): string => (typeof v === 'string' ? v : (text(object(v)?.id) ?? ''))

const achievementOf = (vc: Json): Json | undefined => object(object(vc.credentialSubject)?.achievement)

/**
 * Whether a credential is a badge credential: typed `OpenBadgeCredential`,
 * with an Achievement for its subject. Anything else (a membership, a role, a
 * state card, a relationship card) is not.
 */
export function isBadgeCredential(vc: Json): boolean {
  return typesOf(vc).includes(OPEN_BADGE_CREDENTIAL_TYPE) && achievementOf(vc) !== undefined
}

/**
 * The badge id inside an Achievement id, as upstream builds it
 * (`achievement_id`): `urn:vtc:badge:<id>`, or `<public origin>/badges/<id>`.
 * Undefined for any other shape: a card never guesses an id.
 */
export function badgeIdOf(achievementId: string | undefined): string | undefined {
  if (!achievementId) return undefined
  const urn = /^urn:vtc:badge:([^\s/?#]+)$/.exec(achievementId)
  if (urn) return urn[1]
  const url = /^https?:\/\/[^\s?#]*\/badges\/([^\s/?#]+)$/.exec(achievementId)
  return url ? url[1] : undefined
}

/**
 * The key a badge is kept under for one holder: its community, its holder and
 * its Achievement. Undefined when the credential names no Achievement id, so
 * it is kept by its own id as any other card.
 */
export function badgeKeyOf(vc: Json): string | undefined {
  const achievementId = text(achievementOf(vc)?.id)
  const communityDid = idOf(vc.issuer)
  if (!achievementId || !communityDid) return undefined
  return `${communityDid}|${achievementId}`
}

/** The picture's digest from `urn:sha256:<hex>`, in lower case. */
const sha256Of = (id: string | undefined): string | undefined => {
  const m = id ? /^urn:sha256:([0-9a-fA-F]{64})$/.exec(id) : null
  return m ? m[1].toLowerCase() : undefined
}

/** `Accepted <RFC 3339>`, upstream's evidence description; anything else is not read. */
const acceptedAtOf = (description: unknown): string | undefined => {
  const m = typeof description === 'string' ? /^Accepted (\S+)$/.exec(description.trim()) : null
  return m && Number.isFinite(Date.parse(m[1])) ? m[1] : undefined
}

/** What the Wallet's badge card shows, from the credential alone. */
export function badgeCardView(vc: Json): BadgeCardView {
  const achievement = achievementOf(vc) ?? {}
  const issuer = object(vc.issuer)
  const communityDid = idOf(vc.issuer)
  const achievementId = text(achievement.id)
  const image = object(achievement.image)
  const sha256 = sha256Of(text(image?.id))
  const mediaType = text(image?.mediaType)
  const evidence = (Array.isArray(vc.evidence) ? vc.evidence : vc.evidence ? [vc.evidence] : [])
    .map(object)
    .filter((e): e is Json => e !== undefined)
    .map((e) => {
      const note = text(e.narrative)
      const acceptedAt = acceptedAtOf(e.description)
      return { ...(note ? { note } : {}), ...(acceptedAt ? { acceptedAt } : {}) }
    })
  const view: BadgeCardView = {
    badgeKey: badgeKeyOf(vc) ?? `${communityDid}|${text(vc.id) ?? ''}`,
    name: text(achievement.name) ?? text(vc.name) ?? '',
    communityDid,
    evidence,
  }
  const badgeId = badgeIdOf(achievementId)
  if (badgeId) view.badgeId = badgeId
  if (achievementId) view.achievementId = achievementId
  const description = text(achievement.description)
  if (description) view.description = description
  const criteria = text(object(achievement.criteria)?.narrative)
  if (criteria) view.criteria = criteria
  const communityName = text(issuer?.name)
  if (communityName) view.communityName = communityName
  // A picture is named only by digest; its URL is never kept.
  if (sha256) view.imageSha256 = sha256
  if (image && mediaType) view.imageMediaType = mediaType
  const issuedAt = text(vc.validFrom)
  if (issuedAt) view.issuedAt = issuedAt
  const validUntil = text(vc.validUntil)
  if (validUntil) view.validUntil = validUntil
  return view
}

/**
 * Which of two copies of one badge to keep: the one issued later
 * (`validFrom`), so a renewal replaces what it renews and an older copy
 * delivered again afterwards does not bring it back. A copy without a
 * readable `validFrom` never replaces one that has it.
 */
export function laterBadge(kept: Json, arriving: Json): 'kept' | 'arriving' {
  const at = (vc: Json) => {
    const t = Date.parse(String(vc.validFrom ?? ''))
    return Number.isFinite(t) ? t : -Infinity
  }
  return at(arriving) >= at(kept) ? 'arriving' : 'kept'
}
