import { createStackNavigator } from '@react-navigation/stack'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Animated, Easing } from 'react-native'

import { useTheme } from '../contexts/theme'
import HistorySettings from '../modules/history/ui/HistorySettings'
import DataRetention from '../screens/DataRetention'
import Language from '../screens/Language'
import RenameWallet from '../screens/RenameWallet'
import Onboarding from '../screens/Onboarding'
import { createCarouselStyle } from '../screens/OnboardingPages'
import PINChange from '../screens/PINChange'
import ToggleHardwareAttestation from '../screens/ToggleHardwareAttestation'
import ToggleWitnessReporting from '../screens/ToggleWitnessReporting'
import ExportWallet from '../screens/ExportWallet'
import ImportWallet from '../screens/ImportWallet'
// DISABLED: Witnessing toggle is now inline in Settings
// import ToggleWitnessing from '../screens/ToggleWitnessing'
// DISABLED: Push notifications disabled — no server backend yet
// import TogglePushNotifications from '../screens/TogglePushNotifications'
import Settings from '../screens/Settings'
import Tours from '../screens/Tours'
import { Screens, SettingStackParams } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'

import { useDefaultStackOptions } from './defaultStackOptions'
import { TOKENS, useServices } from '../container-api'
import About from '../screens/About'
import AutoLock from '../screens/AutoLock'
import ConfigureMediator from '../screens/ConfigureMediator'

const SettingStack: React.FC = () => {
  const Stack = createStackNavigator<SettingStackParams>()
  const theme = useTheme()
  const { t } = useTranslation()
  const fadeAnim = useRef(new Animated.Value(0)).current
  const [pages, { screen: terms }, ToggleBiometry, developer, ScreenOptionsDictionary] = useServices([
    TOKENS.SCREEN_ONBOARDING_PAGES,
    TOKENS.SCREEN_TERMS,
    TOKENS.SCREEN_TOGGLE_BIOMETRY,
    TOKENS.SCREEN_DEVELOPER,
    TOKENS.OBJECT_SCREEN_CONFIG,
  ])
  const defaultStackOptions = useDefaultStackOptions(theme)
  const OnboardingTheme = theme.OnboardingTheme
  const carousel = createCarouselStyle(OnboardingTheme)

  // Fade animation on mount (matching hamburger menu behavior)
  // This provides smooth fade-in when used as a tab, and works with MainStack fade when navigated via hamburger menu
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start()

    return () => {
      fadeAnim.setValue(0)
    }
  }, [fadeAnim])

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <Stack.Navigator initialRouteName={Screens.Settings} screenOptions={{ ...defaultStackOptions }}>
        <Stack.Screen
          name={Screens.Settings}
          component={Settings}
          options={{
            title: t('Screens.Settings'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.Settings],
          }}
        />
        <Stack.Screen
          name={Screens.RenameWallet}
          component={RenameWallet}
          options={{
            title: t('Screens.NameWallet'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.RenameWallet],
          }}
        />
        <Stack.Screen
          name={Screens.Language}
          component={Language}
          options={{
            title: t('Screens.Language'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.Language],
          }}
        />
        <Stack.Screen
          name={Screens.ConfigureMediator}
          component={ConfigureMediator}
          options={{
            title: 'Configure Mediator',
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ConfigureMediator],
          }}
        />
        <Stack.Screen
          name={Screens.AutoLock}
          component={AutoLock}
          options={{
            title: 'Auto lock Options',
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.AutoLock],
          }}
        />
        <Stack.Screen
          name={Screens.DataRetention}
          component={DataRetention}
          options={{
            title: t('Screens.DataRetention'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.DataRetention],
          }}
        />
        <Stack.Screen
          name={Screens.Tours}
          component={Tours}
          options={{
            title: t('Screens.Tours'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.Tours],
          }}
        />
        <Stack.Screen
          name={Screens.ToggleBiometry}
          component={ToggleBiometry}
          options={{
            title: t('Screens.Biometry'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ToggleBiometry],
          }}
        />
        <Stack.Screen
          name={Screens.ToggleHardwareAttestation}
          component={ToggleHardwareAttestation}
          options={{
            title: t('Settings.HardwareAttestation'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ToggleHardwareAttestation],
          }}
        />
        <Stack.Screen
          name={Screens.ToggleWitnessReporting}
          component={ToggleWitnessReporting}
          options={{
            title: t('Settings.WitnessReporting'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ToggleWitnessReporting],
          }}
        />
        {/* DISABLED: Witnessing toggle is now inline in Settings
        <Stack.Screen
          name={Screens.ToggleWitnessing}
          component={ToggleWitnessing}
          options={{
            title: t('Settings.Witnessing'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ToggleWitnessing],
          }}
        /> */}
        <Stack.Screen
          name={Screens.ChangePIN}
          component={PINChange}
          options={{
            title: t('Screens.ChangePIN'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ChangePIN],
          }}
        ></Stack.Screen>
        {/* DISABLED: Push notifications disabled — no server backend yet */}
        {/* <Stack.Screen
          name={Screens.TogglePushNotifications}
          component={TogglePushNotifications}
          options={{
            title: t('Screens.PushNotifications'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.TogglePushNotifications],
          }}
        /> */}
        <Stack.Screen
          name={Screens.Terms}
          component={terms}
          options={{
            title: t('Screens.Terms'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.Terms],
          }}
        />
        <Stack.Screen
          name={Screens.Developer}
          component={developer}
          options={{
            title: t('Screens.Developer'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.Developer],
          }}
        />
        <Stack.Screen
          name={Screens.About}
          component={About}
          options={{
            title: t('Settings.AboutThisApp'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.About],
          }}
        />
        <Stack.Screen name={Screens.Onboarding} options={{ title: t('Screens.Onboarding') }}>
          {(props) => (
            <Onboarding
              {...props}
              nextButtonText={t('Global.Next')}
              previousButtonText={t('Global.Back')}
              pages={pages(() => null, OnboardingTheme)}
              style={carousel}
              disableSkip={true}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name={Screens.HistorySettings}
          component={HistorySettings}
          options={{
            title: t('Screens.HistorySettings'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.HistorySettings],
          }}
        />
        <Stack.Screen
          name={Screens.ExportWallet}
          component={ExportWallet}
          options={{
            title: t('Settings.ExportWallet'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ExportWallet],
          }}
        />
        <Stack.Screen
          name={Screens.ImportWallet}
          component={ImportWallet}
          options={{
            title: t('Settings.ImportWallet'),
            headerBackTestID: testIdWithKey('Back'),
            ...ScreenOptionsDictionary[Screens.ImportWallet],
          }}
        />
      </Stack.Navigator>
    </Animated.View>
  )
}

export default SettingStack
