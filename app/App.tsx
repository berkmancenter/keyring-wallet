import {
  animatedComponents,
  AnimatedComponentsProvider,
  APPROVALS_LINK,
  MESSAGES_LINK,
  AuthProvider,
  ContainerProvider,
  ErrorModal,
  initLanguages,
  initStoredLanguage,
  NavContainer,
  NetworkProvider,
  openAppLink,
  registerHiddenVettingModules,
  StoreProvider,
  Stacks,
  ThemeProvider,
  toastConfig,
  TourProvider,
  WitnessErrorDialogContainer,
} from '@bifold/core'
import messaging from '@react-native-firebase/messaging'
import { useNavigationContainerRef } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isTablet } from 'react-native-device-info'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import Orientation from 'react-native-orientation-locker'
import SplashScreen from 'react-native-splash-screen'
import Toast from 'react-native-toast-message'
import { Config } from 'react-native-config'

import Root from '@/Root'
import { KeyRingThemeNames, surveyMonkeyExitUrl, surveyMonkeyUrl } from '@/constants'
import { ErrorAlertProvider } from '@/contexts/ErrorAlertContext'
import { ErrorBoundaryWrapper } from '@/errors/components/ErrorBoundary'
import { localization } from '@/localization'
import { withOta } from '@/ota/withOta'
import { onPushWake, openApprovalsOnTap } from '@/push/pushHandlers'
import PushStartup from '@/push/PushStartup'
import { initialState, reducer } from '@/store'
import { themes } from '@/theme'
import BCLogger from '@/utils/logger'
import tours from '@keyring-theme/features/tours'
import WebDisplay from '@screens/WebDisplay'
import { composeAppContainer } from './container-compose'
import { registerDemoProfiles, selectDemoProfiles } from './src/demo-profiles'

initLanguages(localization)

// A push is a contentless wake-up (docs/plans/push-notifications-plan.md §2):
// log it, never open the agent from here. None arrive unless the build names a
// push gateway and the person turned notifications on. Registering these
// handlers contacts nobody: Firebase's automatic start is off (firebase.json),
// and the platform push service first hears of this install when the person
// turns notifications on (src/push/pushPlatform.ts).
messaging().setBackgroundMessageHandler(async (message) =>
  onPushWake('background', message, (m, d) => BCLogger.info(m, d))
)
messaging().onMessage(async (message) => onPushWake('foreground', message, (m, d) => BCLogger.info(m, d)))

// Before anything renders. The hidden-vetting modules register their seams on
// evaluation, and a bundler has no reason to evaluate a module whose exports
// nobody reads — Metro's inlineRequires left them bundled and never run, which
// is why private vetting was invisible on 254. A call at startup is the one
// form that does not depend on how the bundle is built; see
// bifold trust-tasks/hiddenVettingModules.
registerHiddenVettingModules()

const App = () => {
  const { t } = useTranslation()
  const navigationRef = useNavigationContainerRef()
  const [surveyVisible, setSurveyVisible] = useState(false)
  // Bifold's container with the app's as its child; the app resolves from the child (container-compose.ts).
  const bcwContainer = composeAppContainer(t, navigationRef.navigate, setSurveyVisible)
  // Demo profiles (demo-profiles/README.md) are opt-in per build: with
  // ACTIVE_DEMO_PROFILE unset this registers none, so a shipped build shows the
  // plain contact list and home header. A demo build sets a profile id, or
  // `all` — see demo-profiles/index.ts's selectDemoProfiles.
  registerDemoProfiles(bcwContainer, selectDemoProfiles(Config.ACTIVE_DEMO_PROFILE))

  if (!isTablet()) {
    Orientation.lockToPortrait()
  }

  useMemo(() => {
    initStoredLanguage().then()
  }, [])

  useEffect(() => {
    // Hide the native splash / loading screen so
    // that our RN version can be displayed.
    SplashScreen.hide()
  }, [])

  // Tapping the wake notification opens the waiting approvals, after unlocking.
  // Registered once the app has mounted, not at module load: on Android, Firebase
  // reads a tap that launched the app from the current activity's intent, and at
  // module load there is no activity yet, so that tap was dropped and a cold
  // start landed on My Agent instead of Requests (232, Android). iOS reports its
  // taps through the app delegate and is unaffected.
  useEffect(
    () =>
      openApprovalsOnTap(Config.PUSH_GATEWAY_URL, messaging(), (kind) =>
        openAppLink(kind === 'messages' ? MESSAGES_LINK : APPROVALS_LINK)
      ),
    []
  )

  /**
   * Leaving a screen that failed. The boundary calls this before it renders
   * the app again, so what comes back is not the thing that just threw — a
   * tester was otherwise caught between the error card and the app lock, with
   * force-quit the only way out (report #27).
   *
   * Resetting the root rather than going back: the route that failed may be
   * anywhere in the stack, and its params are usually what it failed on.
   */
  const leaveFailedScreen = useCallback(() => {
    if (!navigationRef.isReady()) return
    navigationRef.resetRoot({ index: 0, routes: [{ name: Stacks.TabStack }] })
  }, [navigationRef])

  return (
    <ErrorBoundaryWrapper logger={BCLogger} onEscape={leaveFailedScreen}>
      <ContainerProvider value={bcwContainer}>
        <StoreProvider initialState={initialState} reducer={reducer}>
          <PushStartup />
          <ThemeProvider themes={themes} defaultThemeName={KeyRingThemeNames.KeyRing}>
            <NavContainer navigationRef={navigationRef}>
              <AnimatedComponentsProvider value={animatedComponents}>
                <AuthProvider>
                  <NetworkProvider>
                    <ErrorModal enableReport />
                    <WitnessErrorDialogContainer />
                    <WebDisplay
                      destinationUrl={surveyMonkeyUrl}
                      exitUrl={surveyMonkeyExitUrl}
                      visible={surveyVisible}
                      onClose={() => setSurveyVisible(false)}
                    />
                    <TourProvider tours={tours} overlayColor={'black'} overlayOpacity={0.7}>
                      {/*
                       * KeyboardProvider is required by react-native-keyboard-controller,
                       * which ScreenWrapper's keyboardActive branch reaches through
                       * KeyboardView/KeyboardAwareScrollView. Keyring renders its own root
                       * instead of @bifold/core's App, so it must mount the provider itself —
                       * without it every keyboardActive screen (PINEnter, PINChange, ...) logged
                       * "Couldn't find real values for KeyboardContext" and ran with the
                       * library's degraded fallback (device logs 2026-08-26).
                       */}
                      <KeyboardProvider statusBarTranslucent={true} navigationBarTranslucent={true}>
                        <ErrorAlertProvider enableReport>
                          <Root />
                        </ErrorAlertProvider>
                      </KeyboardProvider>
                    </TourProvider>
                    <Toast topOffset={15} config={toastConfig} />
                  </NetworkProvider>
                </AuthProvider>
              </AnimatedComponentsProvider>
            </NavContainer>
          </ThemeProvider>
        </StoreProvider>
      </ContainerProvider>
    </ErrorBoundaryWrapper>
  )
}

// Over-the-air JS updates: a no-op unless the build names an update server
// (OTA_UPDATE_URL); see src/ota/withOta.tsx.
export default withOta(App)
