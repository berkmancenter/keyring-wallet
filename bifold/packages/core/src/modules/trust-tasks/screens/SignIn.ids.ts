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
  // A sender that is neither, on a phone with an agent that kept no sign-in key for its host (IN-388).
  olderAgents: 'SignInOlderAgents',
  // A code from a community this phone has not joined: check it is one, and join (IN-406).
  checkAndJoin: 'SignInCheckAndJoin',
  notJoinable: 'SignInNotJoinable',
  joinUnchecked: 'SignInJoinUnchecked',
  // 1b. Several identities hold a membership (IN-296): which one signs in. An option is `SignInIdentity-<n>`, n from 0.
  choose: 'SignInChoose',
  identityOption: 'SignInIdentity',
  identityAgent: 'SignInIdentityAgent',
  approveLater: 'SignInApproveLater',
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
  // Who signs in, as the person chose: the same block as the choice, the DID behind its Details.
  signingAs: 'SignInSigningAs',
  identityDetails: 'SignInIdentityDetails',
  identityHeldBy: 'SignInIdentityHeldBy',
  identitySince: 'SignInIdentitySince',
  // Signing in to the service that hosts the person's agent (IN-388): the service, as it names itself, and the agent.
  service: 'SignInService',
  agent: 'SignInAgent',
  website: 'SignInWebsite',
  sessionOnly: 'SignInSessionOnly',
  // 0.2: what else the browser may sign as the person, for the session (auth/oob signingScope).
  signingScope: 'SignInSigningScope',
  scopeShort: 'SignInScopeShort',
  scopeDetails: 'SignInScopeDetails',
  approve: 'SignInApprove',
  decline: 'SignInDecline',
  busy: 'SignInBusy',
  // 6. How it ended.
  result: 'SignInResult',
  resultMessage: 'SignInResultMessage',
  done: 'SignInDone',
} as const
