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
 * The community's own published name if it has one, else a short DID. Never
 * the host: a hostname in the place of a name reads as the name, which is the
 * whole of reports #13, #14 and #16. Not a hook, so it can be used inside a
 * map; a screen that shows several of these subscribes to `communityTarget`
 * once so a name learned later reaches all of them.
 */
export function communityLabelOf(did: string): string {
  return communityTarget.publishedNameOf(did) ?? shortDid(did)
}
