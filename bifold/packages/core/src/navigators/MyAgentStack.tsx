import type { ParamListBase, RouteProp } from '@react-navigation/native'
import { createStackNavigator, type StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { TOKENS, useServices } from '../container-api'
import { useTheme } from '../contexts/theme'
import MyAgent from '../modules/trust-tasks/screens/MyAgent'
import VtiCommunity from '../modules/trust-tasks/screens/VtiCommunity'
import VtiInvited from '../modules/trust-tasks/screens/VtiInvited'
import VtiJoin from '../modules/trust-tasks/screens/VtiJoin'
import EditRCard from '../modules/vrc/screens/EditRCard'
import VtaAgentHome from '../modules/trust-tasks/screens/VtaAgentHome'
import VtaLink from '../modules/trust-tasks/screens/VtaLink'
import VtiVetting from '../modules/trust-tasks/screens/VtiVetting'
import { MyAgentStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'

interface MyAgentStackProps {
  route?: RouteProp<ParamListBase>
  navigation?: StackNavigationProp<ParamListBase>
}

const MyAgentStack: React.FC<MyAgentStackProps> = ({ route, navigation }) => {
  const Stack = createStackNavigator<MyAgentStackParams>()
  // A link reaches this stack as the tab route's `{ screen: … }`. React
  // Navigation keeps that param on the tab, and a later tab press (which
  // navigates with merge) hands it to this stack again, so "Linked ✓", a
  // ticket or an invitation reopened on every return to the tab. The stack
  // has acted on it by the time this effect runs, so it is dropped here.
  const routedScreen = (route?.params as { screen?: string } | undefined)?.screen
  useEffect(() => {
    if (routedScreen) navigation?.setParams({ screen: undefined, params: undefined })
  }, [routedScreen, navigation])
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary, config] = useServices([TOKENS.OBJECT_SCREEN_CONFIG, TOKENS.CONFIG])

  return (
    <Stack.Navigator screenOptions={{ ...defaultStackOptions }}>
      <Stack.Screen
        name={Screens.MyAgent}
        options={{ title: t('Screens.MyAgent'), ...ScreenOptionsDictionary[Screens.MyAgent] }}
      >
        {() => <MyAgent config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtiCommunity}
        component={VtiCommunity}
        options={{ title: t('Screens.Community'), ...ScreenOptionsDictionary[Screens.VtiCommunity] }}
      />
      <Stack.Screen name={Screens.VtiVetting} options={{ title: t('Screens.Vetting'), ...ScreenOptionsDictionary[Screens.VtiVetting] }}>
        {() => <VtiVetting config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtaLink}
        component={VtaLink}
        options={{ title: t('Screens.VtaLink'), ...ScreenOptionsDictionary[Screens.VtaLink] }}
      />
      {/* The real profile editor, so Join as can create a profile and come back to it. */}
      <Stack.Screen
        name={Screens.EditRCard}
        component={EditRCard as unknown as React.FC}
        options={{ title: t('EditRCard.CreateTitle'), ...ScreenOptionsDictionary[Screens.EditRCard] }}
      />
      <Stack.Screen name={Screens.VtiJoin} options={{ title: t('Screens.Join'), ...ScreenOptionsDictionary[Screens.VtiJoin] }}>
        {() => <VtiJoin config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen name={Screens.VtiInvited} options={{ title: t('Screens.Invited'), ...ScreenOptionsDictionary[Screens.VtiInvited] }}>
        {() => <VtiInvited config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtaAgent}
        component={VtaAgentHome}
        options={{ title: t('Screens.VtaAgent'), ...ScreenOptionsDictionary[Screens.VtaAgent] }}
      />
    </Stack.Navigator>
  )
}

export default MyAgentStack
