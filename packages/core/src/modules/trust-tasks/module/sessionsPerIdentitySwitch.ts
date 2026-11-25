/**
 * Whether a rooms ask for a community goes out on that community's identity's own session (sessions phase B,
 * rooms-slow §8b, `vtiAgent.askAs`) instead of switching the shared session to it. Two values a release (an OTA
 * included) sets, and nothing else:
 *
 * - `on`: the release's choice. On from 278.25, on Alberto's word ("turn it on now", 11-17), ahead of the mini A/B
 *   (rooms-slow §8e), which still runs and is recorded on the pull request.
 * - `remoteOff`: the release's kill. Set it to `true` and every ask goes the shared way at the next start, whatever
 *   `on` says, until a release sets it back.
 *
 * Nothing is saved on the phone and nothing a person does changes either value, so a later release can always take it
 * back (`loadSwitch`'s one-way trap, 11-07). It is read on every ask.
 *
 * It fails closed to today's path: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST (bifold #1093, closed 11-17): a kept kill PR needs its conflict
 * resolved whenever main changes this file, and its CI green expires whenever main moves. Branch from current main, set `SESSIONS_PER_IDENTITY.remoteOff` to `true` in this file
 * (packages/core/src/modules/trust-tasks/module/sessionsPerIdentitySwitch.ts) and change nothing else; merge, pin, cut,
 * and Alberto publishes. Tier ota-strict (this file sits on the VTI protocol line). It acts at each phone's next start.
 * Its proof is #1022's remoteOff rows (agentRoomsBackendOwnSession) and #1093's green on the flipped line.
 *
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/sessionsPerIdentitySwitch
 */
export const SESSIONS_PER_IDENTITY: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether an ask may go out on its identity's own session now. */
export function isSessionsPerIdentityOn(): boolean {
  return SESSIONS_PER_IDENTITY.on === true && SESSIONS_PER_IDENTITY.remoteOff === false
}
