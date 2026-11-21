/**
 * Whether the ballot lets the member go once their cast is stored (polls speed, 11-18, Alberto's "3 go").
 *
 * Off, the ballot holds the member through every step: the agent builds the cast, the pause before it is sent (random,
 * up to 20 s, mean 10 s), the send, and the receipt handed to the agent. On, the ballot goes back as soon as the cast
 * is stored on this phone, and the pause, the send and the receipt carry on behind it, the poll showing the vote on its
 * way. The pause is the same either way: only the member's wait changes.
 *
 * Going at that point is safe because a stored cast is sent whatever happens next: a kill, a background or no network
 * leaves it stored, and the next start sends the same bytes (`pollService.resumePending`). A failure after the member
 * has gone is kept on the poll's record and shown there: a send that did not get through on the vote on its way, a
 * cast the ballot box refused on the ticket.
 *
 * `on` is the release's choice; `remoteOff` is its kill: set it to `true` and the ballot holds the member again at the
 * next start, whatever `on` says. Nothing is saved on the phone and nothing a person does changes either value. Read
 * at each vote; it fails closed to holding: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST: branch from current main, set `POLLS_VOTE_BEHIND.remoteOff` to `true`
 * in this file (packages/core/src/modules/polls/pollsVoteBehindSwitch.ts) and change nothing else; merge, pin, cut, and
 * Alberto publishes. Its proof is the "off" rows in pollVoteBehind.test.tsx.
 *
 * Tests flip the entries and must put them back.
 *
 * @module polls/pollsVoteBehindSwitch
 */
export const POLLS_VOTE_BEHIND: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

export function isPollsVoteBehindOn(): boolean {
  return POLLS_VOTE_BEHIND.on === true && POLLS_VOTE_BEHIND.remoteOff === false
}
