/**
 * What to call a community on screen, and how much to claim for the name.
 *
 * Three things can name a community, and they are not equally trustworthy:
 *
 *   published  its join manifest's `branding.displayName`, served by the
 *              community's own service under its own DID. Self-asserted, but
 *              authenticated as that community: shown plainly.
 *   claimed    the `&n=` of a `keyring://vti/community?d=…&n=…` link, asserted
 *              by whoever wrote the link, who may be anyone. Shown, but said
 *              to be what the link claims. A published name replaces it.
 *   neither    nothing has named it. The DID is then the only thing anyone can
 *              check, so it is shown as an identifier and never dressed up as
 *              a name — a hostname in the place of a name reads as one, which
 *              is how "Join keyring-vti-vtc.ngrok.app" came to be offered to a
 *              person (tester report #14, 2026-09-22).
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
  /** The community in the terms it can be checked in: its host, else a short DID. */
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
    technical: didHost(did) ?? shortDid(did),
  }
}

/**
 * What to call a community in passing — in a list row, a prompt, a share
 * sheet — where there is no room to explain where the name came from.
 *
 * In order: the community's own published name; else the name a link claimed
 * for it, said in words to be a claim ("… (not confirmed by the community)"),
 * because anyone can write any name into a link; else "an unnamed community
 * (<host>)". Never a bare host and never a DID (#12). The host still never
 * poses as a name — the reasoning of reports #13, #14 and #16 — because it
 * appears only inside words that say the community is unnamed. The full DID
 * stays behind the community screen's Details.
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
  const host = didHost(did)
  return (
    host ? t('Community.UnnamedAt', { host, interpolation: { escapeValue: false } }) : t('Community.Unnamed')
  ) as string
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
