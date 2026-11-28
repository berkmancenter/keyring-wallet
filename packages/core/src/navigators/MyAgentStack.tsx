import type { ParamListBase, RouteProp } from '@react-navigation/native'
import { createStackNavigator, type StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { TOKENS, useServices } from '../container-api'
import { isAgentConnectEnabled } from '../modules/connected-agents/agentConnectFlag'
import { ConnectedAgentsRoot } from '../modules/connected-agents/ConnectedAgentsRoot'
import AgentChatScreen from '../screens/agents/AgentChatScreen'
import AgentDetailsScreen from '../screens/agents/AgentDetailsScreen'
import AgentMemoriesScreen from '../screens/agents/AgentMemoriesScreen'
import AiAgentsScreen from '../screens/agents/AiAgentsScreen'
import ConnectAgentScreen from '../screens/agents/ConnectAgentScreen'
import { vtaAgent } from '../modules/trust-tasks/module/vtaAgent'
import { agentHomeScreen } from '../modules/trust-tasks/screens/agentHome'
import { useTheme } from '../contexts/theme'
import { MyAgentStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'
import { roomScreens, vtaScreens } from './VtaStack'

interface MyAgentStackProps {
  route?: RouteProp<ParamListBase>
  navigation?: StackNavigationProp<ParamListBase>
}

/**
 * An agent-connect screen inside `ConnectedAgentsRoot`, which builds the services its hooks read (and renders nothing
 * while no VTA is administered). A stack's children can only be screens, so each screen carries the root itself.
 */
function inConnectedAgentsRoot<P extends object>(Screen: React.ComponentType<P>): React.FC<P> {
  const Rooted: React.FC<P> = (props) => (
    <ConnectedAgentsRoot>
      <Screen {...props} />
    </ConnectedAgentsRoot>
  )
  Rooted.displayName = `InConnectedAgentsRoot(${Screen.displayName ?? Screen.name ?? 'Screen'})`
  return Rooted
}

const AiAgents = inConnectedAgentsRoot(AiAgentsScreen)
const AgentDetails = inConnectedAgentsRoot(AgentDetailsScreen)
const ConnectAgent = inConnectedAgentsRoot(ConnectAgentScreen)
const AgentMemories = inConnectedAgentsRoot(AgentMemoriesScreen)
const AgentChat = inConnectedAgentsRoot(AgentChatScreen)

/**
 * The My Agent tab. With agent connect's developer switch off, the VTA's screens (`VtaStack.tsx`'s lists), as always.
 * With it on (§7.8), the tab opens on the AI agents, with the rooms beside them, and the VTA's screens move under
 * Settings as "My VTA" (`VtaStack`).
 */
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
  const landsOn = agentHomeScreen(link)
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary, config] = useServices([TOKENS.OBJECT_SCREEN_CONFIG, TOKENS.CONFIG])
  // Agent connect's developer switch, read once when the stack mounts: a change applies on the next launch.
  const [agentConnect] = useState(isAgentConnectEnabled)

  if (!agentConnect)
    return (
      <Stack.Navigator initialRouteName={landsOn} screenOptions={{ ...defaultStackOptions }}>
        {vtaScreens(Stack, { title: t, options: ScreenOptionsDictionary, config })}
        {roomScreens(Stack, { t, options: ScreenOptionsDictionary })}
      </Stack.Navigator>
    )

  // Agent connect (docs/plans/agent-connect-plan.md §6, §7.8): the AI agents first, and the rooms registered here
  // too, so a room opened from this tab still shows here.
  return (
    <Stack.Navigator initialRouteName={Screens.AiAgents} screenOptions={{ ...defaultStackOptions }}>
      <Stack.Screen
        name={Screens.AiAgents}
        component={AiAgents}
        options={{ title: t('ConnectedAgents.AiAgents'), ...ScreenOptionsDictionary[Screens.AiAgents] }}
      />
      <Stack.Screen
        name={Screens.AgentDetails}
        component={AgentDetails}
        // The agent's own name (#1060 finding 9).
        options={({ route }) => ({ title: route.params.name, ...ScreenOptionsDictionary[Screens.AgentDetails] })}
      />
      <Stack.Screen
        name={Screens.ConnectAgent}
        component={ConnectAgent}
        options={{ title: t('ConnectedAgents.ConnectAnAgent'), ...ScreenOptionsDictionary[Screens.ConnectAgent] }}
      />
      <Stack.Screen
        name={Screens.AgentMemories}
        component={AgentMemories}
        options={{ title: t('ConnectedAgents.MemoriesTitle'), ...ScreenOptionsDictionary[Screens.AgentMemories] }}
      />
      {/* The chat draws its own header (the robot, the name, "AI agent"), with its own Back (§7.9, frame 27). */}
      <Stack.Screen
        name={Screens.AgentChat}
        component={AgentChat}
        options={{ headerShown: false, ...ScreenOptionsDictionary[Screens.AgentChat] }}
      />
      {roomScreens(Stack, { t, options: ScreenOptionsDictionary })}
    </Stack.Navigator>
  )
}

export default MyAgentStack
