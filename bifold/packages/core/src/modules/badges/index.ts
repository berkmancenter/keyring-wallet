/**
 * Member badges (docs/plans/member-badges-plan.md).
 *
 * @module badges
 */
export * from './types'
export { areBadgesInWallet, BADGES_IN_WALLET, isMemberBadgesOn, MEMBER_BADGES } from './badgesSwitch'
export {
  badgeServiceFor,
  resetBadgeService,
  setBadgeServiceForTests,
  useBadgeService,
  useMemberWall,
  useMyBadges,
} from './useBadges'
export { BadgeRefused, createBadgeService, type BadgesBackend } from './badgeService'
export { createFakeBadgeService, FAKE_BADGES } from './fakeBadgeService'
