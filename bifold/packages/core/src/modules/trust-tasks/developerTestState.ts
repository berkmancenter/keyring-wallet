/**
 * The Developer actions for a tester build ("Hold the test Guardian card (K0)", "I'm the test ward (K0)", and the
 * one-tap "Set up the SEDI demo" / "Turn off the SEDI demo"), as the package exports them. The card and the ward live
 * in guardianEvidence.ts; this reaches it lazily, so importing the package index does not load the Guardian verifier
 * into every suite and every start-up.
 *
 * @module trust-tasks/developerTestState
 */
import type { Agent } from '@credo-ts/core'

import { STATE_CARD_REMOTE_OFF, setStateCardEnabled } from '../sedi/holder/stateCardFlag'

import type { TestStateActionResult } from './guardianEvidence'
import { CONFIRM_ITS_YOU_REMOTE_OFF, setConfirmItsYouEnabled } from './module/confirmItsYouFlag'
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
 * - 'done': the five switches on, the K0 card held and the K0 ward set;
 * - 'remoteOff': a remote off or the SEDI/KERI umbrella is set (found before anything is touched, or landed while the
 *   card and ward were being set);
 * - 'cardNotHeld': the K0 card was not kept (over the size cap, or storage failed);
 * - 'wardNotSet': the card was kept, but the K0 ward was not set (storage failed);
 * - 'doneSomeHidden': set up as 'done', but the state card's or Confirm it's you's own remote off is set, so that
 *   feature will not show; {@link sediDemoHiddenByKill} names which.
 */
export type SediDemoSetupResult = 'done' | 'remoteOff' | 'cardNotHeld' | 'wardNotSet' | 'doneSomeHidden'

/** A feature the one-tap turned on but a release has turned off with its own remote off. */
export type SediDemoHiddenFeature = 'stateCard' | 'confirmItsYou'

/**
 * Which of the one-tap's features a release has turned off with its own remote off, read live at each call (never
 * remembered from a setup): the switch underneath is on, but the feature will not show while that kill is set.
 */
export function sediDemoHiddenByKill(): SediDemoHiddenFeature[] {
  const hidden: SediDemoHiddenFeature[] = []
  if (STATE_CARD_REMOTE_OFF.off) hidden.push('stateCard')
  if (CONFIRM_ITS_YOU_REMOTE_OFF.off) hidden.push('confirmItsYou')
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
 * "Trust the test state (K0)", "State card (demo)" and "Confirm it's you" on, the K0 Guardian card held (for the
 * approver's side) and the K0 ward set (for the person's side). The app keeps the five switches as saved settings
 * itself, as it does when they are turned on one by one.
 *
 * With a remote off or the umbrella set before it starts, it does nothing at all: no switch is turned on, nothing is
 * kept. Otherwise it turns the five switches on, then ATTEMPTS BOTH the card and the ward (one failing does not skip
 * the other) and reports the first that failed, the card first. A kill that lands while those run wins over either
 * step, since it is why they failed.
 *
 * The state card's and Confirm it's you's own remote offs (STATE_CARD_REMOTE_OFF, CONFIRM_ITS_YOU_REMOTE_OFF) do NOT
 * stop the setup: neither is needed by the approvers demo, so a release that turns one of them off still lets the demo
 * set up, and that feature stays hidden by its own kill (each is…Enabled is the switch AND not killed). The result is
 * then 'doneSomeHidden', not 'done', so the screen can say which feature will not show and why. The umbrella stops
 * everything, as above.
 *
 * Because the switch underneath IS turned on, clearing one of those two kills later (a later release) reveals the
 * feature on any phone that ran the setup while the kill was set. While the kill is set it still beats the saved "on".
 *
 * Any result other than 'done' after the start (a kill mid-setup, 'cardNotHeld', 'wardNotSet') means the five
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
  setConfirmItsYouEnabled(true)
  if (!isTrustTestStateEnabled()) return 'remoteOff'
  const card = await attempt(() => guardianEvidence().keepK0TestGuardianCard(agent))
  const ward = await attempt(() => becomeK0TestWard(agent))
  if (anyKill() || !isTrustTestStateEnabled()) return 'remoteOff'
  if (card !== 'done') return 'cardNotHeld'
  if (ward !== 'done') return 'wardNotSet'
  return sediDemoHiddenByKill().length > 0 ? 'doneSomeHidden' : 'done'
}

/**
 * Developer action "Turn off the SEDI demo": the five switches off. Deletes nothing: the card and the ward stay kept,
 * unused while the switches are off, so turning the demo on again needs no new card.
 */
export function turnOffSediDemo(): void {
  setConfirmItsYouEnabled(false)
  setStateCardEnabled(false)
  setTrustTestStateEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setTrustedApproversEnabled(false)
}
