/** The testIDs of the SignIn screen: the contract the e2e drivers and the tests hold against. Values never change meaning; add, never rename. */
export const SignInIds = {
  screen: 'SignIn',
  // 1. Confirm, before anything is sent.
  confirm: 'SignInConfirm',
  community: 'SignInCommunity',
  communityDid: 'SignInCommunityDid',
  host: 'SignInHost',
  unverified: 'SignInUnverified',
  continue: 'SignInContinue',
  cancel: 'SignInCancel',
  notMember: 'SignInNotMember',
  // 2 and 4. Waiting on the community.
  claiming: 'SignInClaiming',
  checking: 'SignInChecking',
  // 3. The number the website shows.
  number: 'SignInNumber',
  numberInput: 'SignInNumberInput',
  numberContinue: 'SignInNumberContinue',
  timeLeft: 'SignInTimeLeft',
  // 5. The request, as the community reports it.
  review: 'SignInReview',
  reportedBy: 'SignInReportedBy',
  browser: 'SignInBrowser',
  system: 'SignInSystem',
  location: 'SignInLocation',
  sameNetwork: 'SignInSameNetwork',
  identifiedAs: 'SignInIdentifiedAs',
  website: 'SignInWebsite',
  sessionOnly: 'SignInSessionOnly',
  approve: 'SignInApprove',
  decline: 'SignInDecline',
  busy: 'SignInBusy',
  // 6. How it ended.
  result: 'SignInResult',
  resultMessage: 'SignInResultMessage',
  done: 'SignInDone',
} as const
