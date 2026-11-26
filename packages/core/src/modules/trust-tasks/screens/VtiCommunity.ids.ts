/** The testIDs of the VtiCommunity screen: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const VtiCommunityIds = {
  scroll: 'CommunityScroll',
  /** The community's logo at the top of its screen, where it has one. */
  logo: 'CommunityLogo',
  /** The people icon there, where it has none. */
  markIcon: 'CommunityMarkIcon',
  name: 'CommunityName',
  nameClaimed: 'CommunityNameClaimed',
  detailsToggle: 'CommunityDetailsToggle',
  did: 'CommunityDid',
  member: 'CommunityMember',
  memberSince: 'CommunityMemberSince',
  openDesk: 'CommunityOpenDesk',
  vouchPrivately: 'CommunityVouchPrivately',
  criteria: 'CommunityCriteria',
  /** Whether this phone is a member is not known yet: nothing to apply with, only that it is being read. */
  reading: 'CommunityReading',
  /** It could not be read: said, with Check again. */
  readFailed: 'CommunityReadFailed',
  readAgain: 'CommunityReadAgain',
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
