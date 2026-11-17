/**
 * Whether member badges show and are asked for (docs/plans/member-badges-plan.md, The kill). Two values a release (an
 * OTA included) sets, and nothing else:
 *
 * - `on`: the release's choice. On from the first release that carries badges, on Alberto's word (11-17).
 * - `remoteOff`: the release's kill. Set it to `true` and every badge surface is hidden and no badge task is sent at the
 *   next start, whatever `on` says, until a release sets it back. A badge credential already kept stays in the Wallet as
 *   an ordinary credential.
 *
 * Nothing is saved on the phone and nothing a person does changes either value, so a later release can always take it
 * back. It is read at every use, and fails closed: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST (11-17): a kept kill PR needs its conflict resolved whenever main
 * changes this file, and its CI green expires whenever main moves. Branch from
 * current main, set `MEMBER_BADGES.remoteOff` to `true` in this file
 * (packages/core/src/modules/badges/badgesSwitch.ts), nothing else; merge, pin, cut, and Alberto publishes. Tier as this
 * file reads (ota).
 *
 * Tests flip the entries and must put back what the release ships.
 *
 * @module badges/badgesSwitch
 */
export const MEMBER_BADGES: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether badges show and are asked for now. */
export function isMemberBadgesOn(): boolean {
  return MEMBER_BADGES.on === true && MEMBER_BADGES.remoteOff === false
}
