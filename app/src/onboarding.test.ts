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

describe('generateOnboardingWorkflowSteps: the notifications task', () => {
  const pushTask = (pushConfig: unknown, didConsiderPushNotifications: boolean) => {
    const state = { ...initialState, onboarding: { ...initialState.onboarding, didConsiderPushNotifications } }
    const withPush = { enablePushNotifications: pushConfig } as Parameters<typeof generateOnboardingWorkflowSteps>[1]
    return generateOnboardingWorkflowSteps(state, withPush, 0, null).find((t) => t.name === Screens.PushNotifications)
  }
  const pushConfig = { status: jest.fn(), setup: jest.fn(), toggle: jest.fn() }

  test('is never shown by a build that names no push gateway', () => {
    expect(pushTask(undefined, false)?.completed).toBe(true)
  })

  test('is shown by a build that names a push gateway, until the person answers it', () => {
    expect(pushTask(pushConfig, false)?.completed).toBe(false)
  })

  test('is done once answered, whether the person allowed notifications or not', () => {
    expect(pushTask(pushConfig, true)?.completed).toBe(true)
  })
})
