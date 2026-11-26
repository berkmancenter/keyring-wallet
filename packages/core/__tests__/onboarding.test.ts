import { generateOnboardingWorkflowSteps } from '../src/onboarding'
import { defaultState } from '../src/contexts/store'
import { Screens } from '../src/types/navigators'
import { buildRCardTemplate } from '../src/modules/vrc/types/rcard'
import { Config } from '../src/types/config'

const config = {} as Config

describe('generateOnboardingWorkflowSteps: the R-Card task', () => {
  test('is incomplete when didSetupRCard is false and there are no profiles yet', () => {
    const state = {
      ...defaultState,
      onboarding: { ...defaultState.onboarding, didSetupRCard: false },
      rCard: { profiles: [], activeProfileId: undefined },
    }

    const tasks = generateOnboardingWorkflowSteps(state, config, 0, null)

    expect(tasks.find((t) => t.name === Screens.RCardOnboarding)?.completed).toBe(false)
  })

  test('is complete once at least one profile exists in state.rCard.profiles, even if didSetupRCard is false', () => {
    // This is the exact scenario Phase 2's data model shift could regress:
    // a profile synced in from Credo (or staged pre-agent) before the
    // onboarding flag itself gets set should still count as "done".
    const template = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    const state = {
      ...defaultState,
      onboarding: { ...defaultState.onboarding, didSetupRCard: false },
      rCard: { profiles: [template], activeProfileId: template.id },
    }

    const tasks = generateOnboardingWorkflowSteps(state, config, 0, null)

    expect(tasks.find((t) => t.name === Screens.RCardOnboarding)?.completed).toBe(true)
  })

  test('is complete when didSetupRCard is true, even with an empty profiles list', () => {
    const state = {
      ...defaultState,
      onboarding: { ...defaultState.onboarding, didSetupRCard: true },
      rCard: { profiles: [], activeProfileId: undefined },
    }

    const tasks = generateOnboardingWorkflowSteps(state, config, 0, null)

    expect(tasks.find((t) => t.name === Screens.RCardOnboarding)?.completed).toBe(true)
  })
})
