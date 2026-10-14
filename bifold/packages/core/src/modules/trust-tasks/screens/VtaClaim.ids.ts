/** The testIDs of the VtaClaim screen: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const VtaClaimIds = {
  screen: 'VtaClaim',
  // 1. Confirm, before anything is sent.
  confirm: 'VtaClaimConfirm',
  host: 'VtaClaimHost',
  hostDid: 'VtaClaimHostDid',
  unverified: 'VtaClaimUnverified',
  continue: 'VtaClaimContinue',
  cancel: 'VtaClaimCancel',
  confirmError: 'VtaClaimConfirmError',
  // 2. Claiming.
  claiming: 'VtaClaimClaiming',
  // 3. The check the person compares with the page.
  code: 'VtaClaimCode',
  codeValue: 'VtaClaimCodeValue',
  codeStatus: 'VtaClaimCodeStatus',
  codeCancel: 'VtaClaimCodeCancel',
  // 4. Linking to the agent handed over.
  connecting: 'VtaClaimConnecting',
  // 5. How it ended.
  ready: 'VtaClaimReady',
  failed: 'VtaClaimFailed',
  resultMessage: 'VtaClaimResultMessage',
  done: 'VtaClaimDone',
} as const
