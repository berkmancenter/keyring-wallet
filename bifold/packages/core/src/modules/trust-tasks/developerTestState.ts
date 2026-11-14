/**
 * The Developer actions for a tester build ("Hold the test Guardian card (K0)", "I'm the test ward (K0)", the one-tap
 * "Set up the SEDI demo", "Set up as the guardian" / "Set up as the ward", and "Turn off the SEDI demo"), as the
 * package exports them. None of them touches "Confirm it's you": it is its own switch (Alberto, 11-14). The card and the ward live
 * in guardianEvidence.ts; this reaches it lazily, so importing the package index does not load the Guardian verifier
 * into every suite and every start-up.
 *
 * @module trust-tasks/developerTestState
 */
import type { Agent } from '@credo-ts/core'

import { STATE_CARD_REMOTE_OFF, setStateCardEnabled } from '../sedi/holder/stateCardFlag'

import type { TestStateActionResult } from './guardianEvidence'
import { setSediDemoSide } from './module/sediDemoSide'
import { SEDI_KERI_REMOTE_OFF } from './module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from './module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from './module/trustedApproversFlag'
import { isTrustTestStateEnabled, setTrustTestStateEnabled } from './module/trustTestStateFlag'

export type { TestStateActionResult }

function guardianEvidence(): typeof import('./guardianEvidence') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./guardianEvidence')
}

/** See guardianEvidence's holdK0TestGuardianCard: nothing unless "Trust the test state (K0)" holds. */
export function holdK0TestGuardianCard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return guardianEvidence().holdK0TestGuardianCard(agent)
}

/** See guardianEvidence's holdK0RevokedOmittedCard: nothing unless "Trust the test state (K0)" holds. */
export function holdK0RevokedOmittedCard(agent: Pick<Agent, 'genericRecords'>): Promise<'done' | 'off' | 'tooLarge'> {
  return guardianEvidence().holdK0RevokedOmittedCard(agent)
}

/** See guardianEvidence's holdK0RevokedTestCard: nothing unless "Trust the test state (K0)" holds. */
export function holdK0RevokedTestCard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return guardianEvidence().holdK0RevokedTestCard(agent)
}

/** See guardianEvidence's becomeK0TestWard: nothing unless "Trust the test state (K0)" holds. */
export function becomeK0TestWard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return guardianEvidence().becomeK0TestWard(agent)
}

/**
 * What "Set up the SEDI demo" did. Each is a different fact, so a demo that did not set up says which step stopped:
 * - 'done': the four switches on, the K0 card held and the K0 ward set;
 * - 'remoteOff': a remote off or the SEDI/KERI umbrella is set (found before anything is touched, or landed while the
 *   card and ward were being set);
 * - 'cardNotHeld': the K0 card was not kept (over the size cap, or storage failed);
 * - 'wardNotSet': the card was kept, but the K0 ward was not set (storage failed);
 * - 'doneSomeHidden': set up as 'done', but the state card's own remote off is set, so the state card will not
 *   show; {@link sediDemoHiddenByKill} names it.
 */
export type SediDemoSetupResult = 'done' | 'remoteOff' | 'cardNotHeld' | 'wardNotSet' | 'doneSomeHidden'

/** A feature the one-tap turned on but a release has turned off with its own remote off. */
export type SediDemoHiddenFeature = 'stateCard'

/**
 * Which of the one-tap's features a release has turned off with its own remote off, read live at each call (never
 * remembered from a setup): the switch underneath is on, but the feature will not show while that kill is set.
 */
export function sediDemoHiddenByKill(side?: 'guardian' | 'ward' | 'person'): SediDemoHiddenFeature[] {
  const hidden: SediDemoHiddenFeature[] = []
  // The ward's side ('person' is its older name) turns the state card off itself, so its kill hides nothing there.
  if (STATE_CARD_REMOTE_OFF.off && side !== 'ward' && side !== 'person') hidden.push('stateCard')
  return hidden
}

const anyKill = () =>
  SEDI_KERI_REMOTE_OFF.off || TRUSTED_APPROVERS_REMOTE_OFF.off || STATE_VERIFIED_APPROVERS_REMOTE_OFF.off

/** A step's own result, or 'failed' when it throws: one step failing must not hide the next one's result. */
async function attempt<T>(step: () => Promise<T>): Promise<T | 'failed'> {
  try {
    return await step()
  } catch {
    return 'failed'
  }
}

/**
 * Developer action "Set up the SEDI demo", in one tap on either phone: trusted approvers, state-verified approvers,
 * "Trust the test state (K0)" and "State card (demo)" on, the K0 Guardian card held (for the approver's side) and the
 * K0 ward set (for the ward's side). "Confirm it's you" is left as it is. The app keeps the four switches as saved
 * settings itself, as it does when they are turned on one by one.
 *
 * With a remote off or the umbrella set before it starts, it does nothing at all: no switch is turned on, nothing is
 * kept. Otherwise it turns the four switches on, then ATTEMPTS BOTH the card and the ward (one failing does not skip
 * the other) and reports the first that failed, the card first. A kill that lands while those run wins over either
 * step, since it is why they failed.
 *
 * The state card's own remote off (STATE_CARD_REMOTE_OFF) does NOT stop the setup: the approvers demo doesn't need
 * it, so a release that turns it off still lets the demo set up, and the card stays hidden by its own kill
 * (isStateCardEnabled is the switch AND not killed). The result is then 'doneSomeHidden', not 'done', so the screen
 * can say which feature will not show and why. The umbrella stops everything, as above.
 *
 * Because the switch underneath IS turned on, clearing that kill later (a later release) reveals the state card on any
 * phone that ran the setup while the kill was set. While the kill is set it still beats the saved "on".
 *
 * Any result other than 'done' after the start (a kill mid-setup, 'cardNotHeld', 'wardNotSet') means the four
 * switches HAVE ALREADY BEEN TURNED ON and stay on: a non-'done' result never means nothing changed. Under a kill the
 * features stay off anyway, because every is…Enabled is the switch AND not killed; after a step failure they are on,
 * and the step can be tried again or the demo turned off.
 */
export async function setUpSediDemo(agent: Pick<Agent, 'genericRecords'>): Promise<SediDemoSetupResult> {
  if (anyKill()) return 'remoteOff'
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setTrustTestStateEnabled(true)
  setStateCardEnabled(true)
  if (!isTrustTestStateEnabled()) return 'remoteOff'
  const card = await attempt(() => guardianEvidence().keepK0TestGuardianCard(agent))
  const ward = await attempt(() => becomeK0TestWard(agent))
  if (anyKill() || !isTrustTestStateEnabled()) return 'remoteOff'
  if (card !== 'done') return 'cardNotHeld'
  if (ward !== 'done') return 'wardNotSet'
  return sediDemoHiddenByKill().length > 0 ? 'doneSomeHidden' : 'done'
}

/**
 * What "Set up as the guardian" or "Set up as the ward" did. The same facts as {@link SediDemoSetupResult}, plus the
 * clean-up each side does of the other side's state:
 * - 'done': this side's switches set, its K0 step done, and the other side's left-over (a ward, or a held card) unset;
 * - 'doneSomeHidden': 'done', but a feature this side uses is off by its own remote off; sediDemoHiddenByKill(side)
 *   names which;
 * - 'remoteOff': a remote off or the SEDI/KERI umbrella is set (found before anything is touched, or landed during
 *   the steps);
 * - 'cardNotHeld' (guardian): the K0 card was not kept (over the size cap, or storage failed);
 * - 'wardNotCleared' (guardian): the card was kept, but a ward left on this phone could not be unset;
 * - 'wardNotSet' (ward): the K0 ward was not set (storage failed);
 * - 'cardNotRemoved' (ward): the ward was set, but a card held on this phone could not be put away.
 */
export type SediDemoSideResult = SediDemoSetupResult | 'cardNotRemoved' | 'wardNotCleared'

/** The switches both sides set: three on, and the state card on only for the guardian. Never Confirm it's you. */
function switchesOn(stateCard: boolean): void {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setTrustTestStateEnabled(true)
  setStateCardEnabled(stateCard)
}

/** The side's two steps, both attempted, with the first failure named (a kill landing meanwhile wins over either). */
async function runSide(
  side: 'guardian' | 'ward',
  first: () => Promise<unknown>,
  firstFailed: SediDemoSideResult,
  second: () => Promise<unknown>,
  secondFailed: SediDemoSideResult
): Promise<SediDemoSideResult> {
  const a = await attempt(first)
  const b = await attempt(second)
  if (anyKill() || !isTrustTestStateEnabled()) return 'remoteOff'
  if (a !== 'done') return firstFailed
  if (b !== 'done') return secondFailed
  return sediDemoHiddenByKill(side).length > 0 ? 'doneSomeHidden' : 'done'
}

/**
 * Developer action "Set up as the guardian" (Jordan's phone): four switches on (trusted approvers, state-verified
 * approvers, "Trust the test state (K0)" and "State card (demo)"), this phone's demo side set to 'guardian' (its codes
 * screen then shows only the guardian code), the K0 Guardian card kept as the card this phone sends after a yes, and
 * any ward on this phone unset (this phone is not the ward the card names). Both steps are attempted; the card is
 * reported first. "Confirm it's you" is left as it is.
 *
 * The same kill rules as {@link setUpSediDemo}: with a remote off or the umbrella set before it starts it does nothing
 * at all; a kill landing during the steps wins. The state card's own remote off does not stop it: the result is then
 * 'doneSomeHidden'. Any result other than 'done' after the start means the four switches HAVE ALREADY BEEN TURNED ON
 * and stay on, and the side is set.
 */
export async function setUpSediDemoAsGuardian(agent: Pick<Agent, 'genericRecords'>): Promise<SediDemoSideResult> {
  if (anyKill()) return 'remoteOff'
  switchesOn(true)
  setSediDemoSide('guardian')
  if (!isTrustTestStateEnabled()) return 'remoteOff'
  return runSide(
    'guardian',
    () => guardianEvidence().keepK0TestGuardianCard(agent),
    'cardNotHeld',
    async () => {
      await guardianEvidence().unsetStateWard(agent)
      return 'done'
    },
    'wardNotCleared'
  )
}

/**
 * Developer action "Set up as the ward" (Sam's phone): three switches on (trusted approvers, state-verified approvers
 * and "Trust the test state (K0)") with "State card (demo)" turned OFF, this phone's demo side set to 'ward' (its
 * codes screen then shows only the ward code), the K0 ward set (Sam), and any Guardian card held on this phone put
 * away (overwritten, not deleted), so no state card shows here. Both steps are attempted; the ward is reported first.
 * "Confirm it's you" is left as it is.
 *
 * The same kill rules as {@link setUpSediDemoAsGuardian}. The state card's own remote off hides nothing here (the card
 * is off on this side), so this side never answers 'doneSomeHidden'. Any result other than 'done' after the start
 * means the switches HAVE ALREADY BEEN SET (three on, the state card off) and stay so, and the side is set.
 */
export async function setUpSediDemoAsWard(agent: Pick<Agent, 'genericRecords'>): Promise<SediDemoSideResult> {
  if (anyKill()) return 'remoteOff'
  switchesOn(false)
  setSediDemoSide('ward')
  if (!isTrustTestStateEnabled()) return 'remoteOff'
  return runSide(
    'ward',
    () => becomeK0TestWard(agent),
    'wardNotSet',
    async () => {
      await guardianEvidence().holdNoGuardianEvidence(agent)
      return 'done'
    },
    'cardNotRemoved'
  )
}

/** @deprecated The ward's side's older name: {@link setUpSediDemoAsWard}. */
export const setUpSediDemoAsPerson = setUpSediDemoAsWard

/**
 * Developer action "Turn off the SEDI demo": the four switches off and no demo side. Deletes nothing: the card and the
 * ward stay kept, unused while the switches are off, so turning the demo on again needs no new card. "Confirm it's
 * you" is left as it is.
 */
export function turnOffSediDemo(): void {
  setSediDemoSide(null)
  setStateCardEnabled(false)
  setTrustTestStateEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setTrustedApproversEnabled(false)
}
