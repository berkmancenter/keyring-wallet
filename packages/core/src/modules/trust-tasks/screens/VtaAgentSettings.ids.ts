/** The testIDs of the VtaAgentSettings screen: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const VtaAgentSettingsIds = {
  screen: 'AgentSettingsScreen',
  nameCard: 'AgentNameCard',
  nameInput: 'AgentNameInput',
  nameSave: 'AgentNameSave',
  nameReset: 'AgentNameReset',
  others: 'AgentOthers',
  unlinkOtherCard: 'AgentUnlinkOtherCard',
  unlinkOtherConfirm: 'AgentUnlinkOtherConfirm',
  unlinkOtherCancel: 'AgentUnlinkOtherCancel',
  awaitingConsent: 'AgentAwaitingConsent',
  activity: 'AgentActivity',
  detailsToggle: 'AgentDetailsToggle',
  details: 'AgentDetails',
  unlink: 'AgentUnlink',
  unlinkCard: 'AgentUnlinkCard',
  unlinkTitle: 'AgentUnlinkTitle',
  unlinkBody: 'AgentUnlinkBody',
  unlinkNext: 'AgentUnlinkNext',
  unlinkConfirm: 'AgentUnlinkConfirm',
  unlinkCancel: 'AgentUnlinkCancel',
} as const
export type VtaAgentSettingsId = (typeof VtaAgentSettingsIds)[keyof typeof VtaAgentSettingsIds]
