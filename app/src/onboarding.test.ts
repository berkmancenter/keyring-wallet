import { generateOnboardingWorkflowSteps } from './onboarding'
import { initialState } from './store'
import { Screens } from '@bifold/core'

const config = {} as Parameters<typeof generateOnboardingWorkflowSteps>[1]

// A minimal stand-in shaped like RCardTemplate — buildRCardTemplate isn't part
// of @bifold/core's public exports, and this test only needs an id.
const fakeProfile = { id: 'urn:uuid:fake', templateId: 'urn:uuid:fake' } as any

describe('generateOnboardingWorkflowSteps: the R-Card task', () => {
  test('is incomplete when didSetupRCard is false and there are no profiles yet', () => {
    const state = {
      ...initialState,
      onboarding: { ...initialState.onboarding, didSetupRCard: false },
      rCard: { profiles: [], activeProfileId: undefined },
    }

    const tasks = generateOnboardingWorkflowSteps(state, config, 0, null)

    expect(tasks.find((t) => t.name === Screens.RCardOnboarding)?.completed).toBe(false)
  })

  test('is complete once at least one profile exists in state.rCard.profiles, even if didSetupRCard is false', () => {
    // This is the exact scenario Phase 2's data model shift could regress:
    // a profile synced in from Credo (or staged pre-agent) before the
    // onboarding flag itself gets set should still count as "done".
    const state = {
      ...initialState,
      onboarding: { ...initialState.onboarding, didSetupRCard: false },
      rCard: { profiles: [fakeProfile], activeProfileId: fakeProfile.id },
    }

    const tasks = generateOnboardingWorkflowSteps(state, config, 0, null)

    expect(tasks.find((t) => t.name === Screens.RCardOnboarding)?.completed).toBe(true)
  })

  test('is complete when didSetupRCard is true, even with an empty profiles list', () => {
    const state = {
      ...initialState,
      onboarding: { ...initialState.onboarding, didSetupRCard: true },
      rCard: { profiles: [], activeProfileId: undefined },
    }

    const tasks = generateOnboardingWorkflowSteps(state, config, 0, null)

    expect(tasks.find((t) => t.name === Screens.RCardOnboarding)?.completed).toBe(true)
  })
})
