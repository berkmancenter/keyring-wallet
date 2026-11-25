/**
 * How the phone reads communities' polls (polls speed, 11-18). Two switches, each two values a release (an OTA
 * included) sets, and nothing else:
 *
 * - `POLLS_CHECK_PARALLEL`: the Waiting for you check asks every community at once, and shows each one's polls as it
 *   answers. Off: one community after another, and nothing shown until the last has answered (1.2-1.5 s more at
 *   launch in 279.x reports, and one slow community held back every other's cards).
 * - `POLLS_SHARED_READ`: one read of a community's polls serves every screen that asks within `SHARED_READ_MS`, and a
 *   second ask while one is on its way waits for it. The check reads the whole list so the community's page can use
 *   it. Off: each asks on its own (a community was read twice a second apart at launch, BC46-XSQD, 279.4).
 *
 * `on` is the release's choice; `remoteOff` is its kill: set it to `true` and the phone reads as before at the next
 * start, whatever `on` says. Nothing is saved on the phone and nothing a person does changes either value. Each is
 * read on every check and every read, and fails closed to the old way: anything but `on` true and `remoteOff` false
 * reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST: branch from current main, set the entry's `remoteOff` to `true` in
 * this file (packages/core/src/modules/polls/pollsReadSwitch.ts) and change nothing else; merge, pin, cut, and Alberto
 * publishes. Its proof is the "off" rows in pollsWaiting.test.ts and CommunityPollsSection.test.tsx.
 *
 * Tests flip the entries and must put them back.
 *
 * @module polls/pollsReadSwitch
 */
export const POLLS_CHECK_PARALLEL: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

export const POLLS_SHARED_READ: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** How long one read of a community's polls serves other screens. A ticket or a vote there ends it at once. */
export const SHARED_READ_MS = 30_000

export function isPollsCheckParallelOn(): boolean {
  return POLLS_CHECK_PARALLEL.on === true && POLLS_CHECK_PARALLEL.remoteOff === false
}

export function isPollsSharedReadOn(): boolean {
  return POLLS_SHARED_READ.on === true && POLLS_SHARED_READ.remoteOff === false
}
