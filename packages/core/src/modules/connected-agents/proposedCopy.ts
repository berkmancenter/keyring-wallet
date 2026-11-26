/**
 * The ConnectedAgents.* strings whose words the plan does not have yet (docs/plans/agent-connect-plan.md §6). Each
 * waits on the step 7.7 plan-line PR and is named there by the finding beside it; a screen that shows one says so in
 * a TODO naming the same finding. When the plan owner rules, the words change in the three locale files and the key
 * leaves this list; a key the plan drops is removed from the locale files too.
 *
 * A test holds this list to the locale files, so a proposal cannot ship without being listed here.
 *
 * @module connected-agents/proposedCopy
 */
export const PROPOSED_COPY: Readonly<Record<string, string>> = {
  Remove: 'C2 (the button follows from §3.10; "no confirmation" is P-b)',
  NotFinishedLine: 'P-b',
  ConnectAgain: 'P-d, revised after the lab measured the VTA sweeper',
  Connecting: 'seam gap: the awaitingEnrolment phase',
  SeeDetails: 'P-e',
  FailSpent: 'seam gap: a spent code',
  FailNotAPairingCode: 'seam gap: not a pairing code',
  FailGrantRefused: 'seam gap: the grant refused',
  FailRotationLostLimits: 'seam gap: the swapped key lost the approved limits',
  FailHandleCollision: 'seam gap: handle collision',
  FailGeneric: 'seam gap: invalid choice',
  VtaTooOld: 'seam gap: a VTA below 0.84.0 (§2.6)',
  ApproveRequester: 'seam gap: §3.2 step 5, the requester signal',
  ApproveSameNetwork: 'seam gap: §3.2 step 5, the same-network signal',
  ApproveOtherNetwork: 'seam gap: §3.2 step 5, the same-network signal',
  MemoryCount_one: 'P-c',
  MemoryCount_other: 'P-c',
  MemoryCountRose: 'P-c',
  MemoryCountWarning: 'P-c',
  MemoryCountFailed: 'P-c',
  PendingMemory: 'seam gap: finding 7 of #1048, a memory not reached yet',
  PurposePersonalisation: 'P-h, the spelling',
  NumberDigitEmpty: 'accessibility: §6 says each digit is announced, not in which words',
  NumberDigitFilled: 'accessibility: as above',
}
