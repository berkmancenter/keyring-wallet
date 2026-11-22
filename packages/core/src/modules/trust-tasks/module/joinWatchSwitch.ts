/**
 * Whether an open join request at a `did:webs` community is asked about on a timer, and its card asked for once
 * (`vtiJoinWatch`). Two values a release (an OTA included) sets, and nothing else:
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and the watch asks nothing from the next start, whatever `on`
 *   says, until a release sets it back.
 *
 * Nothing is saved on the phone and nothing a person does changes either value, so a later release can always take it
 * back. It is read at every look. It fails closed to no watch: anything but `on` true and `remoteOff` false reads as
 * off, and a join request is then read exactly as before the watch (a screen coming into view, Check again).
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST (as sessionsPerIdentitySwitch): branch from current main, set
 * `JOIN_WATCH.remoteOff` to `true` in this file (packages/core/src/modules/trust-tasks/module/joinWatchSwitch.ts) and
 * change nothing else; merge, pin, cut, and Alberto publishes. It acts at each phone's next start. Its proof is
 * vtiJoinWatch.test.ts's remoteOff row.
 *
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/joinWatchSwitch
 */
export const JOIN_WATCH: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether the join watch may ask anything now. */
export function isJoinWatchOn(): boolean {
  return JOIN_WATCH.on === true && JOIN_WATCH.remoteOff === false
}
