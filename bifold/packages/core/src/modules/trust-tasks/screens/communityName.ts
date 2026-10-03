/**
 * What to call a community on screen, and how much to claim for the name.
 *
 * Three things can name a community, and they are not equally trustworthy:
 *
 *   published  its join manifest's `branding.displayName`, else the `name` of
 *              its public profile (`GET {VTCRest}/community/public-profile`),
 *              both served by the community's own service under its own DID.
 *              Self-asserted, but that community's own words: shown plainly.
 *   claimed    the `&n=` of a `keyring://vti/community?d=…&n=…` link, asserted
 *              by whoever wrote the link, who may be anyone. Shown, but said
 *              to be what the link claims. A published name replaces it.
 *   neither    nothing has named it. It is "an unnamed community (<ref>)",
 *              where the ref is the DID's last path segment (its operator's
 *              handle), else the end of its SCID — never the host, which
 *              communities share: "Join keyring-vti-vtc.ngrok.app" was offered
 *              to a person as if it were a name (tester report #14,
 *              2026-09-22), and one host made several communities look like
 *              one (IN-26). The full DID is the technical line, for Details.
 *
 * Every fresh community publishes no branding until its admin sets some, so
 * the nameless case is the common one on a maintainer's first day, not an
 * edge: it gets a real sentence rather than a blank.
 *
 * @module trust-tasks/screens/communityName
 */

import type { TFunction } from 'i18next'

import { communityTarget, type CommunityLink } from '../module/vtiCommunityLink'

import { agentHost } from './VtaLink'

export interface CommunityName {
  /** What to show, when anything has named it. */
  name?: string
  /** The name is only what a link's author called it, not the community's own. */
  claimed: boolean
  /** The community in the terms it can be checked in: its full DID, for Details. */
  technical: string
}

/** A DID in a form a person can compare at a glance, without pretending to be a name. */
export function shortDid(did: string): string {
  return did.length <= 28 ? did : `${did.slice(0, 16)}…${did.slice(-8)}`
}

/** The host a DID is served from, for the technical line. */
export function didHost(did: string): string | undefined {
  return agentHost(did)
}

export function communityName(did: string, link?: CommunityLink): CommunityName {
  const named = link && link.communityDid === did ? link.name : undefined
  return {
    name: named,
    claimed: Boolean(named) && !link?.published,
    technical: did,
  }
}

/**
 * What tells one unnamed community from another without naming it: the DID's
 * last path segment, else the end of its SCID (a hash). Never the host — two
 * communities on one host would read as one.
 */
export function unnamedRef(did: string): string {
  const path = didPathName(did)
  if (path) return path
  const parts = did.split(':')
  return `…${(parts[1] === 'webvh' && parts[2] ? parts[2] : did).slice(-6)}`
}

/** "an unnamed community (<ref>)" — said so, and still told apart from the next one. */
export function unnamedCommunityLabel(did: string, t: TFunction): string {
  return t('Community.UnnamedRef', { ref: unnamedRef(did), interpolation: { escapeValue: false } }) as string
}

/**
 * What to call a community in passing — in a list row, a prompt, a share
 * sheet — where there is no room to explain where the name came from.
 *
 * In order: the community's own published name; else the name a link claimed
 * for it, said in words to be a claim ("… (not confirmed by the community)"),
 * because anyone can write any name into a link; else "an unnamed community
 * (<ref>)" (`unnamedRef`). Never the host and never the whole DID (#12): the
 * host used to stand in that ref, which read as a name and made several
 * communities on one host look like one (IN-26); plain "a community" then
 * told nobody which one. The name a community published is kept across
 * launches (`saveCommunityName`), so the fallback is rare. The full DID stays
 * behind the community screen's Details.
 *
 * Not a hook, so it can be used inside a map; a screen that shows several of
 * these subscribes to `communityTarget` once so a name learned later reaches
 * all of them.
 */
export function communityLabelOf(did: string, t: TFunction): string {
  const published = communityTarget.publishedNameOf(did)
  if (published) return published
  const claimed = [communityTarget.getViewing(), communityTarget.getChosen()].find(
    (l) => l?.communityDid === did && l.name && !l.published
  )?.name
  if (claimed) return t('Community.ClaimedName', { name: claimed, interpolation: { escapeValue: false } }) as string
  return unnamedCommunityLabel(did, t)
}

/**
 * What to call a community in a sentence about something it has just
 * answered — "You left …" once its reply to the leave has come back.
 *
 * Its published name first, as everywhere. Without one, the name the link
 * claimed is said WITHOUT "(not confirmed by the community)": right after
 * "You left", that qualifier read as if the leave had not been confirmed,
 * when the community had answered it and erased the record (2026-09-25, lab
 * run B). The answer proves the phone reached that community's DID, not that
 * the link named it truly, so this is used only where the sentence is about
 * the answer; everywhere else the qualifier stays.
 */
export function communityLabelAnsweredOf(did: string, t: TFunction): string {
  const published = communityTarget.publishedNameOf(did)
  if (published) return published
  const claimed = [communityTarget.getViewing(), communityTarget.getChosen()].find(
    (l) => l?.communityDid === did && l.name && !l.published
  )?.name
  if (claimed) return claimed
  return communityLabelOf(did, t)
}

/**
 * The last path segment of a did:webvh — `…:host:keyring-test-vtc` gives
 * "keyring-test-vtc" — which its operator chose as a readable handle. Never
 * the host: a DID with no path has no such segment.
 */
export function didPathName(did: string): string | undefined {
  const parts = did.split(':')
  if (parts[1] !== 'webvh' || parts.length < 5) return undefined
  try {
    return decodeURIComponent(parts[parts.length - 1]) || undefined
  } catch {
    return undefined
  }
}

/**
 * What to call a community where several stand side by side — the cards of
 * "Your agent", one per community — so that two unnamed ones never both read
 * "a community" (2026-09-26, a vetter holding two).
 *
 * As `communityLabelOf` while a name is known. Without one: the DID's path
 * segment on its own, as a card's title; else "an unnamed community (…<end of
 * its SCID>)", a hash rather than a host, to tell it apart. `claim: 'plain'`
 * drops the "(not confirmed …)" qualifier, for a line about a membership the
 * community itself issued, where the qualifier read as if the membership were
 * unconfirmed.
 */
export function communityHeadingOf(did: string, t: TFunction, opts: { claim?: 'qualified' | 'plain' } = {}): string {
  const named = opts.claim === 'plain' ? communityLabelAnsweredOf(did, t) : communityLabelOf(did, t)
  if (named !== unnamedCommunityLabel(did, t)) return named
  return didPathName(did) ?? named
}

/** The same, for where it starts a sentence or stands alone: "An unnamed community (…)". */
export function communityLabelStartOf(did: string, t: TFunction): string {
  const label = communityLabelOf(did, t)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * Whoever a DID is, at the start of a sentence, when it may not be a community
 * — the one asking an agent for an approval, say: its published name if one is
 * known, else "Someone at <host>", else "Someone". Never the DID (#12).
 */
export function partyLabelStartOf(did: string, t: TFunction): string {
  const published = communityTarget.publishedNameOf(did)
  if (published) return published
  const host = didHost(did)
  return (
    host ? t('Community.SomeoneAt', { host, interpolation: { escapeValue: false } }) : t('Community.Someone')
  ) as string
}
