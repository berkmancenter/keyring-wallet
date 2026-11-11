/**
 * The Developer actions for a tester build ("Hold the test Guardian card (K0)", "I'm the test ward (K0)", and the
 * one-tap "Set up the SEDI demo" / "Turn off the SEDI demo"), as the package exports them. The card and the ward live
 * in guardianEvidence.ts; this reaches it lazily, so importing the package index does not load the Guardian verifier
 * into every suite and every start-up.
 *
 * @module trust-tasks/developerTestState
 */
import type { Agent } from '@credo-ts/core'

import type { TestStateActionResult } from './guardianEvidence'
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

/** See guardianEvidence's becomeK0TestWard: nothing unless "Trust the test state (K0)" holds. */
export function becomeK0TestWard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return guardianEvidence().becomeK0TestWard(agent)
}

/**
 * What "Set up the SEDI demo" did. Each is a different fact, so a demo that did not set up says which step stopped:
 * - 'done': the three switches on, the K0 card held and the K0 ward set;
 * - 'remoteOff': a remote off or the SEDI/KERI umbrella is set (found before anything is touched, or landed while the
 *   card and ward were being set);
 * - 'cardNotHeld': the K0 card was not kept (over the size cap, or storage failed);
 * - 'wardNotSet': the card was kept, but the K0 ward was not set (storage failed).
 */
export type SediDemoSetupResult = 'done' | 'remoteOff' | 'cardNotHeld' | 'wardNotSet'

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
 * Developer action "Set up the SEDI demo", in one tap on either phone: trusted approvers, state-verified approvers and
 * "Trust the test state (K0)" on, the K0 Guardian card held (for the approver's side) and the K0 ward set (for the
 * person's side). The app keeps the three switches as saved settings itself, as it does when they are turned on one by
 * one.
 *
 * With a remote off or the umbrella set before it starts, it does nothing at all: no switch is turned on, nothing is
 * kept. Otherwise it turns the three switches on, then ATTEMPTS BOTH the card and the ward (one failing does not skip
 * the other) and reports the first that failed, the card first. A kill that lands while those run wins over either
 * step, since it is why they failed.
 *
 * Any result other than 'done' after the start (a kill mid-setup, 'cardNotHeld', 'wardNotSet') means the three
 * switches HAVE ALREADY BEEN TURNED ON and stay on: a non-'done' result never means nothing changed. Under a kill the
 * features stay off anyway, because every is…Enabled is the switch AND not killed; after a step failure they are on,
 * and the step can be tried again or the demo turned off.
 */
export async function setUpSediDemo(agent: Pick<Agent, 'genericRecords'>): Promise<SediDemoSetupResult> {
  if (anyKill()) return 'remoteOff'
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  setTrustTestStateEnabled(true)
  // TODO(state card): also turn on the holder's state-card switch (setStateCardEnabled, sedi/holder/stateCardFlag.ts,
  // bifold feat/sedi-holder-card) once it is on this branch; its row in developerTestState.test.ts is a test.todo.
  if (!isTrustTestStateEnabled()) return 'remoteOff'
  const card = await attempt(() => guardianEvidence().keepK0TestGuardianCard(agent))
  const ward = await attempt(() => becomeK0TestWard(agent))
  if (anyKill() || !isTrustTestStateEnabled()) return 'remoteOff'
  if (card !== 'done') return 'cardNotHeld'
  if (ward !== 'done') return 'wardNotSet'
  return 'done'
}

/**
 * Developer action "Turn off the SEDI demo": the three switches off. Deletes nothing: the card and the ward stay kept,
 * unused while the switches are off, so turning the demo on again needs no new card.
 */
export function turnOffSediDemo(): void {
  // TODO(state card): also turn off setStateCardEnabled once sedi/holder/stateCardFlag.ts is on this branch.
  setTrustTestStateEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setTrustedApproversEnabled(false)
}
