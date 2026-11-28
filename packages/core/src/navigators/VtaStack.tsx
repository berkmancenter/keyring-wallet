/**
 * The VTA's own screens (agent-connect plan §6 "Where the screens sit", §7.8; D20, D26), as one list that two stacks
 * register:
 *
 * - `MyAgentStack`, with the agent-connect switch off: the My Agent tab exactly as it was.
 * - `VtaStack`, with it on: the same screens, moved under Settings as "My VTA" (`Screens.MyVta` in `SettingStack`),
 *   while the My Agent tab opens on the AI agents.
 *
 * The list is `vtaScreens` then `roomScreens`, in today's order. The rooms are registered in both stacks with the
 * switch on, so a room opened from the tab still shows there (§6).
 *
 * One difference in the moved stack, by §7.8 and D20: a screen whose title calls the VTA "your agent" (or "My Agent",
 * now the AI agents' tab) is titled "My VTA" there (`VTA_TITLE_KEYS`). Everything else is the same names, options and
 * order.
 */
import type { ParamListBase, RouteProp } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import React, { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { TOKENS, useServices, type TokenMapping } from '../container-api'
import { useTheme } from '../contexts/theme'
import BadgeDetail from '../modules/badges/screens/BadgeDetail'
import CommunityCard from '../modules/directory/screens/CommunityCard'
import CommunityMemberCard from '../modules/directory/screens/CommunityMemberCard'
import CommunityMembers from '../modules/directory/screens/CommunityMembers'
import Poll from '../modules/polls/screens/Poll'
import PollBallot from '../modules/polls/screens/PollBallot'
import Room from '../modules/rooms/screens/Room'
import RoomInfo from '../modules/rooms/screens/RoomInfo'
import RoomOffer from '../modules/rooms/screens/RoomOffer'
import RoomPart, { roomPartTitle } from '../modules/rooms/screens/RoomPart'
import RoomsHome from '../modules/rooms/screens/RoomsHome'
import GuardianCardReceive from '../modules/sedi/holder/GuardianCardReceive'
import StateOfficeCodes from '../modules/sedi/identity/StateOfficeCodes'
import { vtaAgent } from '../modules/trust-tasks/module/vtaAgent'
import { agentHomeScreen } from '../modules/trust-tasks/screens/agentHome'
import MyAgent from '../modules/trust-tasks/screens/MyAgent'
import SharedConnect from '../modules/trust-tasks/screens/SharedConnect'
import SignIn from '../modules/trust-tasks/screens/SignIn'
import VtaAgentHome from '../modules/trust-tasks/screens/VtaAgentHome'
import VtaAgentSettings from '../modules/trust-tasks/screens/VtaAgentSettings'
import VtaAskMe from '../modules/trust-tasks/screens/VtaAskMe'
import VtaClaim from '../modules/trust-tasks/screens/VtaClaim'
import VtaCreateAgent from '../modules/trust-tasks/screens/VtaCreateAgent'
import VtaDevices from '../modules/trust-tasks/screens/VtaDevices'
import VtaLink from '../modules/trust-tasks/screens/VtaLink'
import VtaNewPhoneOffer from '../modules/trust-tasks/screens/VtaNewPhoneOffer'
import VtaRequests from '../modules/trust-tasks/screens/VtaRequests'
import VtaTrustedApprovers from '../modules/trust-tasks/screens/VtaTrustedApprovers'
import VtiCommunity from '../modules/trust-tasks/screens/VtiCommunity'
import VtiHiddenVetter from '../modules/trust-tasks/screens/VtiHiddenVetter'
import VtiHiddenVetting from '../modules/trust-tasks/screens/VtiHiddenVetting'
import VtiInvited from '../modules/trust-tasks/screens/VtiInvited'
import VtiJoin from '../modules/trust-tasks/screens/VtiJoin'
import VtiVetting from '../modules/trust-tasks/screens/VtiVetting'
import EditRCard from '../modules/vrc/screens/EditRCard'
import { MyAgentStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'

type Stack = ReturnType<typeof createStackNavigator<MyAgentStackParams>>
type Config = TokenMapping[typeof TOKENS.CONFIG]
type ScreenOptions = TokenMapping[typeof TOKENS.OBJECT_SCREEN_CONFIG]

/** What both lists read: the screen titles (`title(key)`), the app's per-screen options, and its config. */
export type VtaScreensDeps = {
  title: (key: string) => string
  options: ScreenOptions
  config: Config
}

/** The title keys that call the VTA "your agent" or "My Agent": "My VTA" in the moved stack (§7.8, D20). */
export const VTA_TITLE_KEYS: readonly string[] = [
  'Screens.MyAgent',
  'Screens.VtaLink',
  'Screens.VtaAgent',
  'Screens.VtaClaim',
]

/** A title for the moved stack: "My VTA" in place of one that calls the VTA "your agent". */
export const movedTitle =
  (t: (key: string) => string) =>
  (key: string): string =>
    VTA_TITLE_KEYS.includes(key) ? t('ConnectedAgents.MyVta') : t(key)

/** The VTA's screens, as the My Agent tab registered them before agent connect (all but the rooms). */
export function vtaScreens(Stack: Stack, { title, options, config }: VtaScreensDeps): React.ReactElement {
  return (
    <>
      <Stack.Screen name={Screens.MyAgent} options={{ title: title('Screens.MyAgent'), ...options[Screens.MyAgent] }}>
        {() => <MyAgent config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtiCommunity}
        component={VtiCommunity}
        options={{ title: title('Screens.Community'), ...options[Screens.VtiCommunity] }}
      />
      <Stack.Screen
        name={Screens.Poll}
        component={Poll}
        options={{ title: title('Polls.Poll'), ...options[Screens.Poll] }}
      />
      <Stack.Screen
        name={Screens.PollBallot}
        component={PollBallot}
        options={{ title: title('Polls.Ballot'), ...options[Screens.PollBallot] }}
      />
      <Stack.Screen
        name={Screens.BadgeDetail}
        component={BadgeDetail}
        options={{ title: title('Badges.Badge'), ...options[Screens.BadgeDetail] }}
      />
      <Stack.Screen
        name={Screens.CommunityMembers}
        component={CommunityMembers}
        options={{ title: title('Screens.CommunityMembers'), ...options[Screens.CommunityMembers] }}
      />
      <Stack.Screen
        name={Screens.CommunityMemberCard}
        component={CommunityMemberCard}
        options={{ title: title('Screens.CommunityMemberCard'), ...options[Screens.CommunityMemberCard] }}
      />
      <Stack.Screen
        name={Screens.CommunityCard}
        component={CommunityCard}
        options={{ title: title('Screens.CommunityCard'), ...options[Screens.CommunityCard] }}
      />
      <Stack.Screen
        name={Screens.VtiVetting}
        options={{ title: title('Screens.Vetting'), ...options[Screens.VtiVetting] }}
      >
        {() => <VtiVetting config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtiHiddenVetting}
        component={VtiHiddenVetting}
        options={{ title: title('Screens.HiddenVetting'), ...options[Screens.VtiHiddenVetting] }}
      />
      <Stack.Screen
        name={Screens.VtiHiddenVetter}
        component={VtiHiddenVetter}
        options={{ title: title('Screens.HiddenVetter'), ...options[Screens.VtiHiddenVetter] }}
      />
      <Stack.Screen
        name={Screens.VtaLink}
        component={VtaLink}
        options={{ title: title('Screens.VtaLink'), ...options[Screens.VtaLink] }}
      />
      <Stack.Screen
        name={Screens.VtaCreateAgent}
        component={VtaCreateAgent}
        options={{ title: title('Screens.VtaCreateAgent'), ...options[Screens.VtaCreateAgent] }}
      />
      <Stack.Screen
        name={Screens.VtaDevices}
        component={VtaDevices}
        options={{ title: title('Screens.VtaDevices'), ...options[Screens.VtaDevices] }}
      />
      <Stack.Screen
        name={Screens.VtaNewPhoneOffer}
        component={VtaNewPhoneOffer}
        options={{ title: title('Screens.VtaNewPhoneOffer'), ...options[Screens.VtaNewPhoneOffer] }}
      />
      {/* The real profile editor, so Join as can create a profile and come back to it. */}
      <Stack.Screen
        name={Screens.EditRCard}
        component={EditRCard as unknown as React.FC}
        options={{ title: title('EditRCard.CreateTitle'), ...options[Screens.EditRCard] }}
      />
      <Stack.Screen name={Screens.VtiJoin} options={{ title: title('Screens.Join'), ...options[Screens.VtiJoin] }}>
        {() => <VtiJoin config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtiInvited}
        options={{ title: title('Screens.Invited'), ...options[Screens.VtiInvited] }}
      >
        {() => <VtiInvited config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtaAgent}
        component={VtaAgentHome}
        options={{ title: title('Screens.VtaAgent'), ...options[Screens.VtaAgent] }}
      />
      {/* What waits for the person's decision: opened by a notification, the banner and Manage. */}
      <Stack.Screen
        name={Screens.VtaRequests}
        component={VtaRequests}
        options={{ title: title('Screens.VtaRequests'), ...options[Screens.VtaRequests] }}
      />
      <Stack.Screen
        name={Screens.VtaAskMe}
        component={VtaAskMe}
        options={{ title: title('Screens.VtaAskMe'), ...options[Screens.VtaAskMe] }}
      />
      <Stack.Screen
        name={Screens.VtaTrustedApprovers}
        component={VtaTrustedApprovers}
        options={{
          title: title('Screens.VtaTrustedApprovers'),
          ...options[Screens.VtaTrustedApprovers],
        }}
      />
      {/* One person from Who approves (design B): the same screen, opened on them. */}
      <Stack.Screen
        name={Screens.VtaApproverPerson}
        component={VtaTrustedApprovers}
        options={{
          title: title('Screens.VtaApproverPerson'),
          ...options[Screens.VtaApproverPerson],
        }}
      />
      {/* Opened from the gear in "Your agent"'s header. */}
      <Stack.Screen
        name={Screens.VtaAgentSettings}
        component={VtaAgentSettings}
        options={{ title: title('Screens.VtaAgentSettings'), ...options[Screens.VtaAgentSettings] }}
      />
      {/* A community sign-in code, scanned or pasted (trigger-link sign-in, off by default). */}
      <Stack.Screen
        name={Screens.SignIn}
        component={SignIn as React.FC}
        // Each scan is its own screen: a second code never lands on the first one's.
        getId={({ params }) => params?.scanId}
        options={{ title: title('Screens.SignIn'), ...options[Screens.SignIn] }}
      />
      <Stack.Screen
        name={Screens.VtaClaim}
        component={VtaClaim as React.FC}
        // Each scan is its own screen, as for sign-in.
        getId={({ params }) => params?.scanId}
        options={{ title: title('Screens.VtaClaim'), ...options[Screens.VtaClaim] }}
      />
      {/* A shared-connect link (relationship over TSP), scanned or pasted; reached only with its developer flag on. */}
      <Stack.Screen
        name={Screens.SharedConnect}
        component={SharedConnect as React.FC}
        getId={({ params }) => params?.scanId}
        options={{ title: title('Screens.SharedConnect'), ...options[Screens.SharedConnect] }}
      />
      {/* A state office's Guardian card link, and this phone's codes for one: reached only with the SEDI switches on, and
          each screen checks them again itself. */}
      <Stack.Screen
        name={Screens.GuardianCardReceive}
        component={GuardianCardReceive as React.FC}
        getId={({ params }) => params?.scanId}
        options={{ title: title('Screens.GuardianCardReceive'), ...options[Screens.GuardianCardReceive] }}
      />
      <Stack.Screen
        name={Screens.StateOfficeCodes}
        component={StateOfficeCodes}
        options={{ title: title('Screens.StateOfficeCodes'), ...options[Screens.StateOfficeCodes] }}
      />
    </>
  )
}

/** The rooms' screens: reached only from the entry points the rooms flag shows. */
export function roomScreens(
  Stack: Stack,
  { t, options }: { t: (key: string) => string; options: ScreenOptions }
): React.ReactElement {
  return (
    <>
      <Stack.Screen
        name={Screens.RoomsHome}
        component={RoomsHome}
        options={{ title: t('Rooms.Rooms'), ...options[Screens.RoomsHome] }}
      />
      <Stack.Screen
        name={Screens.Room}
        component={Room}
        options={{ title: t('Rooms.Room'), ...options[Screens.Room] }}
      />
      <Stack.Screen
        name={Screens.RoomInfo}
        component={RoomInfo}
        options={{ title: t('Rooms.Details'), ...options[Screens.RoomInfo] }}
      />
      <Stack.Screen
        name={Screens.RoomPart}
        component={RoomPart}
        options={({ route }) => ({
          title: roomPartTitle(t as Parameters<typeof roomPartTitle>[0], route.params?.part),
          ...options[Screens.RoomPart],
        })}
      />
      <Stack.Screen
        name={Screens.RoomOffer}
        component={RoomOffer}
        options={{ title: t('Rooms.Offer'), ...options[Screens.RoomOffer] }}
      />
    </>
  )
}

interface VtaStackProps {
  route?: RouteProp<ParamListBase>
}

/**
 * "My VTA" (§7.8, frame 20): today's VTA screens under Settings, registered with the agent-connect switch on. It lands
 * where the My Agent tab landed before (`agentHomeScreen`): a linked phone on the agent home.
 */
const VtaStack: React.FC<VtaStackProps> = () => {
  const Stack = createStackNavigator<MyAgentStackParams>()
  const { link } = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary, config] = useServices([TOKENS.OBJECT_SCREEN_CONFIG, TOKENS.CONFIG])
  const deps = { title: movedTitle(t), options: ScreenOptionsDictionary, config }
  return (
    <Stack.Navigator initialRouteName={agentHomeScreen(link)} screenOptions={{ ...defaultStackOptions }}>
      {vtaScreens(Stack, deps)}
      {roomScreens(Stack, { t, options: ScreenOptionsDictionary })}
    </Stack.Navigator>
  )
}

export default VtaStack
