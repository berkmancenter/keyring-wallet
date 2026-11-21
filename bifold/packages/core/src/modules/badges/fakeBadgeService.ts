/**
 * A badge service with fixed answers, for the screens and the room-post chip to build and test against while the real
 * client lands (docs/plans/member-badges-plan.md). Not used by the app.
 *
 * @module badges/fakeBadgeService
 */
import type { BadgeService, BadgeSummary, MyBadges, WallBadge } from './types'

const COMMUNITY = 'did:webvh:example:community'

export const FAKE_BADGES: Record<string, BadgeSummary> = {
  helper: {
    badgeId: 'bdg_helper',
    communityDid: COMMUNITY,
    kind: 'community',
    name: 'Helper',
    description: 'Answered a newcomer’s question.',
    image: { sha256: 'a'.repeat(64), mediaType: 'image/png' },
  },
  thanks: { badgeId: 'bdg_thanks', communityDid: COMMUNITY, kind: 'kudos', name: 'Thanks!' },
  organiser: { badgeId: 'bdg_organiser', communityDid: COMMUNITY, kind: 'community', name: 'Event organiser' },
}

/** One 1×1 transparent PNG, standing in for every picture. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export function createFakeBadgeService(
  overrides: { mine?: MyBadges | 'notServed'; wall?: WallBadge[] | 'notServed' | 'hidden' } = {}
): BadgeService & { accepted: string[]; declined: string[] } {
  const accepted: string[] = []
  const declined: string[] = []
  const mine: MyBadges = {
    held: [
      { ...FAKE_BADGES.helper, count: 1, since: '2026-11-10T12:00:00Z', pinned: true, hidden: false },
      {
        ...FAKE_BADGES.thanks,
        count: 3,
        since: '2026-11-11T09:00:00Z',
        latestAt: '2026-11-15T09:00:00Z',
        pinned: false,
        hidden: false,
      },
    ],
    offers: [
      {
        ...FAKE_BADGES.organiser,
        awardId: 'awd_2',
        offeredAt: '2026-11-16T09:00:00Z',
        note: 'For the meetup.',
        givenBy: 'Sam',
      },
    ],
    kudosTotal: 3,
    visibility: 'members',
  }
  return {
    accepted,
    declined,
    mine: async () => overrides.mine ?? mine,
    accept: async (_c, awardId) => {
      accepted.push(awardId)
    },
    decline: async (_c, awardId) => {
      declined.push(awardId)
    },
    wall: async () =>
      overrides.wall ?? [{ ...FAKE_BADGES.helper, count: 1, since: '2026-11-10T12:00:00Z', pinned: true }],
    show: async (_c, badgeId) => Object.values(FAKE_BADGES).find((b) => b.badgeId === badgeId) ?? 'notServed',
    image: async () => PIXEL,
  }
}
