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
  NumberDigitFilled: 'accessibility: §6 says each digit is announced as it is typed, not in which words',
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
export const SETTLED_ELSEWHERE: Readonly<Record<string, string>> = {}
