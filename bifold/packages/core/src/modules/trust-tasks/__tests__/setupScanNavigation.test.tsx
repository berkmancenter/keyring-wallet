/**
 * "Set up a new agent" → Scan → an agent host's automatic-connection QR, with
 * REAL navigators: the tabs (Contacts first, My Agent), My Agent's own stack,
 * and the scanner as a separate stack on top — the app's shape (MainStack.tsx,
 * TabStack.tsx).
 *
 * On 229 this landed on Contacts with no message (a hosted service's operator,
 * 2026-10-02): the setup screen navigated to the confirm screen from the
 * scanner's hand-back, which already removed the scanner (focusing an unfocused
 * navigator pops what is above it), and the scanner's own goBack then went to
 * the tab navigator, whose "back" is its first tab. A mocked navigation cannot
 * see that, which is how it shipped.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, useNavigation } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Pressable, Text } from 'react-native'

import { agentAddressScan } from '../module/agentAddressScan'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')

const VTA = 'did:webvh:QmAgent:dids.ic3.dev:alice-vta'
const hostQr = JSON.stringify({
  vta_did: VTA,
  callback_url: 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/r.S',
})

type Nav = { navigate: (name: string, params?: object) => void; goBack: () => void }
const Label: React.FC<{ id: string }> = ({ id }) => <Text testID={id}>{id}</Text>

const Contacts = () => <Label id="ContactsScreen" />
const AgentHome = () => {
  const navigation = useNavigation() as unknown as Nav
  return (
    <Pressable testID="ToSetup" onPress={() => navigation.navigate('Setup')}>
      <Text>agent home</Text>
    </Pressable>
  )
}
/** The setup screen's address step, as VtaCreateAgent does it. */
const Setup = () => {
  const navigation = useNavigation() as unknown as Nav
  return (
    <Pressable
      testID="SetupScan"
      onPress={() => {
        agentAddressScan.request((scanned) => {
          if (scanned.kind === 'host') navigation.navigate('Link')
        })
        navigation.navigate('ConnectStack', { screen: 'Scan' })
      }}
    >
      <Text>setup</Text>
    </Pressable>
  )
}
const Link = () => <Label id="LinkConfirmScreen" />
/** The scanner, as Scan.tsx hands a read code back. */
const Scan = () => {
  const navigation = useNavigation() as unknown as Nav
  return (
    <Pressable testID="ScanReads" onPress={() => agentAddressScan.claim(hostQr, () => navigation.goBack())}>
      <Text>scanner</Text>
    </Pressable>
  )
}

const Tabs = createBottomTabNavigator()
const AgentStack = createStackNavigator()
const Root = createStackNavigator()
const ScanStack = createStackNavigator()
const MyAgent = () => (
  <AgentStack.Navigator>
    <AgentStack.Screen name="AgentHome" component={AgentHome} />
    <AgentStack.Screen name="Setup" component={Setup} />
    <AgentStack.Screen name="Link" component={Link} />
  </AgentStack.Navigator>
)
const TabStack = () => (
  <Tabs.Navigator initialRouteName="Contacts">
    <Tabs.Screen name="Contacts" component={Contacts} />
    <Tabs.Screen name="MyAgent" component={MyAgent} />
  </Tabs.Navigator>
)
const ConnectStack = () => (
  <ScanStack.Navigator>
    <ScanStack.Screen name="Scan" component={Scan} />
  </ScanStack.Navigator>
)
const App = ({ navRef }: { navRef: React.RefObject<any> }) => (
  <NavigationContainer ref={navRef}>
    <Root.Navigator>
      <Root.Screen name="TabStack" component={TabStack} />
      <Root.Screen name="ConnectStack" component={ConnectStack} />
    </Root.Navigator>
  </NavigationContainer>
)

/** The focused route's name, all the way down. */
const focused = (state: any): string => {
  const route = state.routes[state.index ?? 0]
  return route.state ? focused(route.state) : route.name
}

afterEach(() => agentAddressScan.cancel())

test('scanning a host QR from the setup step ends on the confirm screen in My Agent, not on Contacts', async () => {
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await act(async () => {
    navRef.current.navigate('TabStack', { screen: 'MyAgent' })
  })
  await act(async () => fireEvent.press(tree.getByTestId('ToSetup')))
  await act(async () => fireEvent.press(tree.getByTestId('SetupScan')))
  expect(focused(navRef.current.getRootState())).toBe('Scan')

  await act(async () => fireEvent.press(tree.getByTestId('ScanReads')))

  const root = navRef.current.getRootState()
  expect(focused(root)).toBe('Link')
  // The scanner is closed, and the tabs are on My Agent.
  expect(root.routes.map((r: any) => r.name)).toEqual(['TabStack'])
  const tabs = root.routes[0].state
  expect(tabs.routes[tabs.index].name).toBe('MyAgent')
})
