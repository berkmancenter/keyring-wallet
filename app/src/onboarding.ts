import { Agent } from '@credo-ts/core'
import { Config, OnboardingTask, Screens } from '@bifold/core'

import { BCState } from './store'

export const isPrefaceComplete = (didSeePreface: boolean, showPreface: boolean): OnboardingTask => {
  return { name: Screens.Preface, completed: (didSeePreface && showPreface) || !showPreface }
}

export const isOnboardingTutorialComplete = (didCompleteTutorial: boolean): OnboardingTask => {
  return { name: Screens.Onboarding, completed: didCompleteTutorial }
}

export const isUpdateCheckComplete = (needsUpdate: boolean, dismissed: boolean): OnboardingTask => {
  return { name: Screens.UpdateAvailable, completed: dismissed || (!dismissed && !needsUpdate) }
}

export const isTermsComplete = (): OnboardingTask => {
  // TODO: Re-enable terms screen later once we agree what terms we want to place on the wallet
  return { name: Screens.Terms, completed: true }
}

export const isPINCreationComplete = (didCreatePIN: boolean): OnboardingTask => {
  return { name: Screens.CreatePIN, completed: didCreatePIN }
}

export const isBiometryComplete = (didConsiderBiometry: boolean): OnboardingTask => {
  return { name: Screens.Biometry, completed: didConsiderBiometry }
}

/**
 * The notifications step: shown only by a build that names a push gateway
 * (`enablePushNotifications` is undefined otherwise), and once the person has
 * answered it, whatever they answered.
 */
export const isPushNotificationComplete = (
  didConsiderPushNotifications: boolean,
  enablePushNotifications: Config['enablePushNotifications']
): OnboardingTask => {
  return { name: Screens.PushNotifications, completed: !enablePushNotifications || didConsiderPushNotifications }
}

export const isRCardSetupComplete = (didSetupRCard: boolean, hasCredential: boolean): OnboardingTask => {
  return { name: Screens.RCardOnboarding, completed: didSetupRCard || hasCredential }
}

export const isNameWalletComplete = (didNameWallet: boolean, enableWalletNaming: boolean): OnboardingTask => {
  return { name: Screens.NameWallet, completed: !enableWalletNaming || didNameWallet }
}

export const isAttemptLockoutComplete = (servedPenalty: boolean | undefined): OnboardingTask => {
  return { name: Screens.AttemptLockout, completed: servedPenalty !== false }
}

export const isAuthenticationComplete = (didCreatePIN: boolean, didAuthenticate: boolean): OnboardingTask => {
  return { name: Screens.EnterPIN, completed: didAuthenticate || !didCreatePIN }
}

export const isAgentInitializationComplete = (agent: Agent | null): OnboardingTask => {
  return { name: Screens.Splash, completed: !!agent }
}

export const generateOnboardingWorkflowSteps = (
  state: BCState,
  config: Config,
  termsVersion: number,
  agent: Agent | null
): Array<OnboardingTask> => {
  const {
    didSeePreface,
    didCompleteTutorial,
    didCreatePIN,
    didConsiderBiometry,
    didConsiderPushNotifications,
    didNameWallet,
    didSetupRCard,
  } = state.onboarding
  const { didAuthenticate } = state.authentication
  const { servedPenalty } = state.loginAttempt
  const { enableWalletNaming } = state.preferences
  const { showPreface, enablePushNotifications } = config
  const { needsUpdate, dismissed = false } = state.versionInfo
  const hasRCardCredential = Boolean(state.rCard?.profiles?.length)

  return [
    isPrefaceComplete(didSeePreface, showPreface ?? false),
    isUpdateCheckComplete(needsUpdate, dismissed),
    isOnboardingTutorialComplete(didCompleteTutorial),
    isTermsComplete(),
    isPINCreationComplete(didCreatePIN),
    isBiometryComplete(didConsiderBiometry),
    isPushNotificationComplete(didConsiderPushNotifications, enablePushNotifications),
    isNameWalletComplete(didNameWallet, enableWalletNaming),
    isRCardSetupComplete(didSetupRCard, hasRCardCredential),
    isAttemptLockoutComplete(servedPenalty),
    isAuthenticationComplete(didCreatePIN, didAuthenticate),
    isAgentInitializationComplete(agent),
  ]
}
