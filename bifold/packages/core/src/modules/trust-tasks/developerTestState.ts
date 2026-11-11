/**
 * The two Developer actions for a tester build ("Hold the test Guardian card (K0)", "I'm the test ward (K0)"), as the
 * package exports them. They live in guardianEvidence.ts; this reaches it lazily, so importing the package index does
 * not load the Guardian verifier into every suite and every start-up.
 *
 * @module trust-tasks/developerTestState
 */
import type { Agent } from '@credo-ts/core'

import type { TestStateActionResult } from './guardianEvidence'

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
