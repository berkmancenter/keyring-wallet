/**
 * How a community's card reads in the Wallet (226, agent-kept cards): the
 * membership card, a role card and a vetter grant, copied from the community
 * store by vtiWalletCards.
 *
 * These cards carry no `name` and a bare-DID issuer, so the generic W3C
 * display read them as "Membership Credential" from "Unknown". Here they are
 * named for what they are and for whom: "Member of Keyring Lab Community",
 * "Vetter for …", issued by the community by its own name (never its DID or
 * host), with the dates the card itself states.
 *
 * @module trust-tasks/screens/communityCardDisplay
 */

import type { TFunction } from 'i18next'

import { i18n } from '../../../localization'
import { registerW3cDisplayOverride, type W3cDisplayOverride } from '../../openid/display'
import type { W3cCredentialJson } from '../../openid/types'
import { classifyCredential } from '../module/vtiInbox'
import { isCommunityCard } from '../module/vtiWalletCards'

import { communityHeadingOf } from './communityName'

const day = (iso: unknown): string | undefined =>
  typeof iso === 'string' && !Number.isNaN(Date.parse(iso)) ? iso.slice(0, 10) : undefined

/** The display of a community card, or undefined for any other credential. */
export function communityCardDisplay(vc: Record<string, unknown>, t: TFunction): W3cDisplayOverride | undefined {
  if (!isCommunityCard(vc)) return undefined
  const { kind, communityDid } = classifyCredential(vc)
  if (!communityDid) return undefined
  const community = communityHeadingOf(communityDid, t, { claim: 'plain' })
  const endorsement = (vc.credentialSubject as Record<string, unknown> | undefined)?.endorsement as
    | Record<string, unknown>
    | undefined
  const role = typeof endorsement?.role === 'string' ? endorsement.role : undefined
  const words = (key: string, extra: Record<string, unknown> = {}) =>
    t(key, { community, ...extra, interpolation: { escapeValue: false } }) as string

  const name: unknown =
    kind === 'membership'
      ? words('Community.CardMemberOf')
      : kind === 'vetter-grant'
        ? words('Community.CardVetterFor')
        : words('Community.CardRoleIn', { role: role ?? '' })
  const label = (key: string) => t(key) as unknown
  const labels = [
    label('Community.CardCommunity'),
    label('Community.CardRole'),
    label('Community.CardSince'),
    label('Community.CardUntil'),
  ]
  // Words not loaded (no language yet): the generic display, rather than a card
  // titled "undefined".
  if (typeof name !== 'string' || typeof community !== 'string' || labels.some((l) => typeof l !== 'string')) {
    return undefined
  }
  const [communityLabel, roleLabel, sinceLabel, untilLabel] = labels as string[]
  const attributes: Record<string, string> = { [communityLabel]: community }
  if (kind !== 'membership' && role) attributes[roleLabel] = role
  const from = day(vc.validFrom ?? vc.issuanceDate)
  const until = day(vc.validUntil ?? vc.expiryDate)
  if (from) attributes[sinceLabel] = from
  if (until) attributes[untilLabel] = until
  return { name, issuerName: community, attributes }
}

let registered: (() => void) | undefined

/** Make the Wallet read community cards this way (idempotent). `t` is the app's i18n unless a test gives one. */
export function registerCommunityCardDisplay(t?: TFunction): void {
  if (registered) return
  registered = registerW3cDisplayOverride((vc: W3cCredentialJson) =>
    communityCardDisplay(vc as unknown as Record<string, unknown>, t ?? (i18n.t.bind(i18n) as TFunction))
  )
}

/** For tests. */
export function unregisterCommunityCardDisplay(): void {
  registered?.()
  registered = undefined
}

registerCommunityCardDisplay()
