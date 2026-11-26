/**
 * The ConnectedAgents.* strings whose words the plan does not have yet (docs/plans/agent-connect-plan.md §6). Each
 * waits on the step 7.7 plan-line PR and is named there by the finding beside it; a screen that shows one says so in
 * a TODO naming the same finding. When the plan owner rules, the words change in the three locale files and the key
 * leaves this list; a key the plan drops is removed from the locale files too.
 *
 * A test derives the rule from the plan itself: every ConnectedAgents.* string is either quoted in §6 (settled), cut
 * from a §6 string by the plan's own no-room rule ({@link NO_ROOM_FORMS}), or listed here; and a string listed here
 * that §6 now quotes fails until it leaves the list. A change to settled words (P-h, "Personalise") is not listed:
 * the shipped words are the plan's until the ruling changes §6.
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
  MemoryCreateFailed: "C4: the words are §3.15's; §6 gains them",
  NumberDigitEmpty: 'accessibility: §6 says each digit is announced, not in which words',
  NumberDigitFilled: 'accessibility: as above',
}

/**
 * Strings that are a §6 string with its room sentence left out, by the plan's own rule for P0 ("The no-room form":
 * "20 omits "This also applies in <rooms>.""). Settled, but not quoted on their own. Each must be part of a §6 string.
 */
export const NO_ROOM_FORMS: Readonly<Record<string, string>> = {
  WidenBody: 'change memories, widening: §6 body without "This also applies in <rooms>."',
}
