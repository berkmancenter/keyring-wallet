/**
 * What a community card's pass says in the Wallet: the community once (its own name, else the handle its DID
 * carries), what the card is (Member, a role, Vetter, Identity checked), one date that matters for it, and how
 * soon it lapses when that is soon. Everything else is on the card's details.
 *
 * Pure: the same card and words give the same face. `published` is the name the community published, when the
 * phone has it (communityTarget).
 *
 * @module trust-tasks/screens/communityPass
 */
import type { TFunction } from 'i18next'

import { classifyCredential, roleNameOf } from '../module/vtiInbox'
import { isCommunityCard } from '../module/vtiWalletCards'

import { cardAgentNameOf, roleWords } from './communityCardDisplay'
import { unnamedRef } from './communityName'
import { localDate } from './localTime'

const DAY = 24 * 60 * 60 * 1000
/** A card that lapses within this many days says how many are left. */
export const LAPSING_WITHIN_DAYS = 30

export interface PassFace {
  communityDid: string
  /** The community's own name, when it has published one: the monogram is drawn from it. */
  published?: string
  /** The pass's title: the published name, else the DID's handle. */
  title: string
  /** Set when the community has published no name: said under the title. */
  unnamedNote?: string
  /** What the card is, small above or beside the title. */
  kind: string
  /** The one date shown on the face. */
  field?: { label: string; value: string }
  /** A second date, for the front pass only. */
  secondField?: { label: string; value: string }
  /** "19 days left", when the card lapses within {@link LAPSING_WITHIN_DAYS} days. */
  lapsing?: string
  /** The agent holding this card's identity, when the phone has several: whose card it is. */
  agent?: string
  /** Read by screen readers: the whole face in one sentence. */
  accessibilityLabel: string
}

const dateOf = (value: unknown): number | undefined =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : undefined

/** The pass face of a community card, or undefined for any other credential. */
export function passFace(
  vc: Record<string, unknown>,
  t: TFunction,
  published: string | undefined,
  now: number = Date.now()
): PassFace | undefined {
  if (!isCommunityCard(vc)) return undefined
  const { kind, communityDid } = classifyCredential(vc)
  if (!communityDid) return undefined
  const words = (key: string, extra: Record<string, unknown> = {}) =>
    t(key, { ...extra, interpolation: { escapeValue: false } }) as string

  const roleName = roleNameOf(vc)
  const kindWords =
    kind === 'membership'
      ? words('Community.PassMember')
      : kind === 'vetter-grant'
        ? words('Community.PassVetter')
        : kind === 'identity-check'
          ? words('Community.PassIdentityChecked')
          : roleName
            ? roleWords(roleName, t)
            : words('Community.PassRole')

  const from = dateOf(vc.validFrom ?? vc.issuanceDate)
  const until = dateOf(vc.validUntil ?? vc.expiryDate)
  const fromField = from
    ? {
        label: words(
          kind === 'membership'
            ? 'Community.PassMemberSince'
            : kind === 'identity-check'
              ? 'Community.PassCheckedOn'
              : 'Community.PassSince'
        ),
        value: localDate(new Date(from).toISOString()),
      }
    : undefined
  const untilField = until
    ? { label: words('Community.PassValidUntil'), value: localDate(new Date(until).toISOString()) }
    : undefined
  // A vetter grant is about how long it lasts; every other card about when it began.
  const [field, secondField] = kind === 'vetter-grant' ? [untilField, fromField] : [fromField, untilField]

  const daysLeft = until !== undefined ? Math.ceil((until - now) / DAY) : undefined
  const lapsing =
    daysLeft !== undefined && daysLeft > 0 && daysLeft <= LAPSING_WITHIN_DAYS
      ? words('Community.PassDaysLeft', { count: daysLeft })
      : undefined

  const name = published?.trim() || undefined
  const title = name ?? unnamedRef(communityDid)
  const unnamedNote = name ? undefined : words('Community.PassNoName')
  const agent = cardAgentNameOf((vc.credentialSubject as { id?: unknown } | undefined)?.id)
  const accessibilityLabel = [title, kindWords, agent, field && `${field.label} ${field.value}`, lapsing]
    .filter(Boolean)
    .join(', ')

  return {
    communityDid,
    published: name,
    title,
    unnamedNote,
    kind: kindWords,
    field,
    secondField,
    lapsing,
    agent,
    accessibilityLabel,
  }
}
