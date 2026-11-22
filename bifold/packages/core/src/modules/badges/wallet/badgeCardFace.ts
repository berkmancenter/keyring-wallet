/**
 * What a badge card says, in words, from its view (docs/plans/member-badges-plan.md, Wallet; Rules, Words):
 *
 * - the badge's name, and the community named as its giver: the name the credential's issuer gives itself, else the
 *   one the community has published to this phone, else the handle that tells it apart;
 * - when it was earned: the latest award, and how many there are when there are several;
 * - when it is valid until.
 *
 * A badge is a badge: nothing here says verified, checked or proven.
 *
 * @module badges/wallet/badgeCardFace
 */
import type { TFunction } from 'i18next'

import type { BadgeCardView } from '../../trust-tasks/module/badgeCredentials'
import { unnamedRef } from '../../trust-tasks/screens/communityName'
import { localDate } from '../../trust-tasks/screens/localTime'

export interface BadgeCardFace {
  name: string
  /** "From <community>". */
  from: string
  /** The community as it is named on the card. */
  community: string
  /** "Earned 10 Nov 2026", or "Earned 3 times" when there are several awards. */
  earned?: string
  /** Each award's date, latest first. */
  earnedDates: string[]
  validUntil?: string
  accessibilityLabel: string
}

const readable = (iso: unknown): iso is string => typeof iso === 'string' && Number.isFinite(Date.parse(iso))

/** The awards' dates, latest first: each award's acceptance, else the credential's own issue date. */
export function earnedDatesOf(view: BadgeCardView): string[] {
  const accepted = view.evidence.map((e) => e.acceptedAt).filter(readable)
  const dates = accepted.length ? accepted : readable(view.issuedAt) ? [view.issuedAt] : []
  return [...dates].sort((a, b) => Date.parse(b) - Date.parse(a))
}

export function badgeCardFace(view: BadgeCardView, t: TFunction, published?: string): BadgeCardFace {
  const words = (key: string, extra: Record<string, unknown> = {}) =>
    t(key, { ...extra, interpolation: { escapeValue: false } }) as string
  const community = view.communityName?.trim() || published?.trim() || unnamedRef(view.communityDid)
  const dates = earnedDatesOf(view)
  const earned =
    dates.length > 1
      ? words('BadgeCard.EarnedTimes', { count: dates.length })
      : dates.length === 1
        ? words('BadgeCard.Earned', { date: localDate(dates[0]) })
        : undefined
  const validUntil = readable(view.validUntil) ? localDate(view.validUntil) : undefined
  const from = words('BadgeCard.From', { community })
  return {
    name: view.name,
    from,
    community,
    earned,
    earnedDates: dates.map(localDate),
    validUntil,
    accessibilityLabel: [words('BadgeCard.Kind'), view.name, from, earned].filter(Boolean).join(', '),
  }
}
