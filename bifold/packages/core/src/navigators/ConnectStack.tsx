import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../contexts/theme'
import RenameWallet from '../screens/RenameWallet'
import PasteUrl from '../screens/PasteUrl'
import ScanHelp from '../screens/ScanHelp'
import { makeSharedConnectInviteScreen } from '../modules/trust-tasks/screens/SharedConnectInvite'
import { useSharedConnectInvite } from '../modules/trust-tasks/module/useSharedConnectInvite'
import { ConnectStackParams, Screens } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'

import { useDefaultStackOptions } from './defaultStackOptions'
import { TOKENS, useServices } from '../container-api'

// "Show a code" (shared-connect as the inviter, plan WP9): the screen runs the invite hook only while its switch is on.
const SharedConnectInvite = makeSharedConnectInviteScreen(useSharedConnectInvite)

const ConnectStack: React.FC = () => {
  const Stack = createStackNavigator<ConnectStackParams>()
  const theme = useTheme()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [scan, ScreenOptionsDictionary] = useServices([TOKENS.SCREEN_SCAN, TOKENS.OBJECT_SCREEN_CONFIG])
  const { t } = useTranslation()

  return (
    <Stack.Navigator
      screenOptions={{
        ...defaultStackOptions,
      }}
    >
      <Stack.Screen
        name={Screens.Scan}
        component={scan}
        options={{
          title: t('Screens.Scan'),
          headerBackTestID: testIdWithKey('Back'),
          ...ScreenOptionsDictionary[Screens.Scan],
        }}
      />
      <Stack.Screen
        name={Screens.PasteUrl}
        component={PasteUrl}
        options={() => ({
          title: t('PasteUrl.PasteUrl'),
          headerBackTestID: testIdWithKey('Back'),
          ...ScreenOptionsDictionary[Screens.PasteUrl],
        })}
      />
      <Stack.Screen
        name={Screens.ScanHelp}
        component={ScanHelp}
        options={{
          title: t('Screens.ScanHelp'),
          ...ScreenOptionsDictionary[Screens.ScanHelp],
        }}
      />

      <Stack.Screen
        name={Screens.SharedConnectInvite}
        component={SharedConnectInvite}
        options={{
          title: t('SharedConnectInvite.Title'),
          headerBackTestID: testIdWithKey('Back'),
          ...ScreenOptionsDictionary[Screens.SharedConnectInvite],
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
    </Stack.Navigator>
  )
}

export default ConnectStack
