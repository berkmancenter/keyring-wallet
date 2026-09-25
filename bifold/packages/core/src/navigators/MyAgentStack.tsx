import type { ParamListBase, RouteProp } from '@react-navigation/native'
import { createStackNavigator, type StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { TOKENS, useServices } from '../container-api'
import { vtaAgent } from '../modules/trust-tasks/module/vtaAgent'
import { useTheme } from '../contexts/theme'
import MyAgent from '../modules/trust-tasks/screens/MyAgent'
import VtiCommunity from '../modules/trust-tasks/screens/VtiCommunity'
import VtiInvited from '../modules/trust-tasks/screens/VtiInvited'
import VtiJoin from '../modules/trust-tasks/screens/VtiJoin'
import EditRCard from '../modules/vrc/screens/EditRCard'
import VtaAgentHome from '../modules/trust-tasks/screens/VtaAgentHome'
import VtaCreateAgent from '../modules/trust-tasks/screens/VtaCreateAgent'
import VtaDevices from '../modules/trust-tasks/screens/VtaDevices'
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
  /**
   * Where the tab lands. Every tab unmounts when it loses focus
   * (`TabStack.tsx`, `unmountOnBlur: true`), so coming back rebuilds this
   * stack at its initial route — and a phone that had just linked was left on
   * the agent home, while the same phone returning through the tab arrived at
   * the operator panel. Two screens for one state, depending only on how you
   * got there, which is what a tester reported (#11).
   *
   * A linked phone therefore starts at the agent home, always. The panel is
   * still reachable from it; making the panel's content part of that screen is
   * the redesign, and is deliberately not this.
   */
  const { link } = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const landsOn = link.kind === 'linked' ? Screens.VtaAgent : Screens.MyAgent
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary, config] = useServices([TOKENS.OBJECT_SCREEN_CONFIG, TOKENS.CONFIG])

  return (
    <Stack.Navigator initialRouteName={landsOn} screenOptions={{ ...defaultStackOptions }}>
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
      <Stack.Screen
        name={Screens.VtiVetting}
        options={{ title: t('Screens.Vetting'), ...ScreenOptionsDictionary[Screens.VtiVetting] }}
      >
        {() => <VtiVetting config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtaLink}
        component={VtaLink}
        options={{ title: t('Screens.VtaLink'), ...ScreenOptionsDictionary[Screens.VtaLink] }}
      />
      <Stack.Screen
        name={Screens.VtaCreateAgent}
        component={VtaCreateAgent}
        options={{ title: t('Screens.VtaCreateAgent'), ...ScreenOptionsDictionary[Screens.VtaCreateAgent] }}
      />
      <Stack.Screen
        name={Screens.VtaDevices}
        component={VtaDevices}
        options={{ title: t('Screens.VtaDevices'), ...ScreenOptionsDictionary[Screens.VtaDevices] }}
      />
      {/* The real profile editor, so Join as can create a profile and come back to it. */}
      <Stack.Screen
        name={Screens.EditRCard}
        component={EditRCard as unknown as React.FC}
        options={{ title: t('EditRCard.CreateTitle'), ...ScreenOptionsDictionary[Screens.EditRCard] }}
      />
      <Stack.Screen
        name={Screens.VtiJoin}
        options={{ title: t('Screens.Join'), ...ScreenOptionsDictionary[Screens.VtiJoin] }}
      >
        {() => <VtiJoin config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtiInvited}
        options={{ title: t('Screens.Invited'), ...ScreenOptionsDictionary[Screens.VtiInvited] }}
      >
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
