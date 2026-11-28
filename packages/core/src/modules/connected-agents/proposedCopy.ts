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
  MemoryChangeFailed: 'seam gap: a widen or narrow the VTA did not make',
  MemoriesTitle: 'backlog (memories list heading, step 7.16): no words in the plan',
  DeleteMemoryBodyNoAgents_one: 'backlog (step 7.16): the delete body when no agent is bound',
  DeleteMemoryBodyNoAgents_other: 'backlog (step 7.16): as above',
  DeleteMemoryHeld: 'backlog (step 7.16): a delete held by an approval rule, never "Try again"',
  DeleteMemoryRecordsLeft_one: 'backlog (step 7.16): records not updated after a delete',
  DeleteMemoryRecordsLeft_other: 'backlog (step 7.16): as above',
  UnnamedAgent: 'backlog (step 7.16): an agent with no name in the delete body',
  NumberDigitFilled: 'accessibility: §6 says each digit is announced as it is typed, not in which words',
  AddRoomRefused: 'backlog 3 ruling 2 (step 7.13): the VTA refused the room add; §6 and §3.10 give no words',
  AddRoomUnreachable: 'backlog 3 ruling 2 (step 7.13): the VTA was unreachable at the room add; §3.10 gives no words',
  AddRoomNotAddable: 'backlog 3 ruling 2 (step 7.13): the agent left the addable list between the list and the press',
  AnswersOthersNotSaved: 'backlog 3 ruling 2 (step 7.14): Keyring could not store an "Answers other people" change',
  AddToRoomBodyAllRooms:
    'backlog 3 (step 7.13, decided 11-28): the add sheet says the agent can use every room of the persona',
  AddToRoomBodyAlready:
    'backlog 3 (step 7.13, decided 11-28): the add sheet for an agent that can already use the persona rooms',
  AgentsUseEveryRoom: 'backlog 3 (step 7.13, decided 11-28): room info says the same, in place of the one-room note',
  CanUseEveryRoomAs: 'backlog 3 (steps 7.13 and 7.14, decided 11-28): the same, in What it remembers and the details',
  AnswersOthersPending:
    'backlog 3 ruling 3 (step 7.14): the change is stored, not yet sent; `settings` has no acknowledgement',
}

/**
 * Strings that are a §6 string with its room sentence left out, by the plan's own rule for P0 ("The no-room form":
 * "20 omits "This also applies in <rooms>.""). Settled, but not quoted on their own. Each must be part of a §6 string.
 *
 * What qualifies: a cut, by that rule, of a string §6 quotes, and nothing else. A string that is merely close to §6
 * words is a proposal (PROPOSED_COPY), not a no-room form.
 */
export const NO_ROOM_FORMS: Readonly<Record<string, string>> = {
  WidenBody: 'change memories, widening: §6 body without "This also applies in <rooms>."',
}

/**
 * Strings the plan settles outside §6, the section the copy is otherwise kept in: quoted verbatim in the section named
 * (a test checks it there). Settled, so not waiting on a ruling; listed so §6 stays the strict rule and each exception
 * is a decision someone made, with its source beside it.
 */
export const SETTLED_ELSEWHERE: Readonly<Record<string, string>> = {
  ActingAs: '§7.7',
  OthersReply: '§3.13',
}
