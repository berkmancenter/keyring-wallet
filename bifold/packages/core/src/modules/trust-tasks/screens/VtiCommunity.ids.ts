/** The testIDs of the VtiCommunity screen: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const VtiCommunityIds = {
  scroll: 'CommunityScroll',
  name: 'CommunityName',
  nameClaimed: 'CommunityNameClaimed',
  detailsToggle: 'CommunityDetailsToggle',
  did: 'CommunityDid',
  member: 'CommunityMember',
  memberSince: 'CommunityMemberSince',
  openDesk: 'CommunityOpenDesk',
  criteria: 'CommunityCriteria',
  error: 'CommunityError',
  refusalDetails: 'CommunityRefusalDetails',
  refusalCode: 'CommunityRefusalCode',
  applyToCommunityButton: 'ApplyToCommunityButton',
  leaveCommunityConfirmCard: 'LeaveCommunityConfirmCard',
  leaveCommunityPurge: 'LeaveCommunityPurge',
  leaveCommunityTombstone: 'LeaveCommunityTombstone',
  leaveCommunityConfirm: 'LeaveCommunityConfirm',
  leaveCommunityStay: 'LeaveCommunityStay',
  leaveCommunityRetry: 'LeaveCommunityRetry',
  leaveCommunityButton: 'LeaveCommunityButton',
} as const
export type VtiCommunityId = (typeof VtiCommunityIds)[keyof typeof VtiCommunityIds]
