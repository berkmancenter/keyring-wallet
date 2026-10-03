/**
 * The three ways into the Requests screen, with REAL navigators in the app's
 * shape: the tabs (Contacts first, every tab unmounted when it loses focus),
 * My Agent's own stack, and the root above them (TabStack.tsx, MyAgentStack.tsx).
 *
 * A notification's link opens Requests with nothing under it in the stack, so
 * the way back must be supplied — and must lead to "Your agent", never to the
 * tabs' own "back", which is Contacts (the setup-scan defect in 229 was that
 * shape, and a mocked navigation could not see it).
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, useNavigation } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Pressable, Text } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { APPROVALS_LINK, myAgentLinkParams, routeKeyringAgentLink, type MyAgentDestination } from '../module/vtiLinks'
import { QUIET_MS } from '../screens/requestsView'
import VtaRequests from '../screens/VtaRequests'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
const id = (key: string) => testIdWithKey(key)
type Nav = { navigate: (name: string, params?: object) => void }

const Contacts = () => <Text testID="ContactsScreen">contacts</Text>
/** "Your agent", as far as the ways into Requests go: the banner and the row in Manage. */
const AgentHome = () => {
  const navigation = useNavigation() as unknown as Nav
  return (
    <>
      <Pressable testID="Banner" onPress={() => navigation.navigate(Screens.VtaRequests)}>
        <Text>something waits</Text>
      </Pressable>
      <Pressable testID="ManageRow" onPress={() => navigation.navigate(Screens.VtaRequests)}>
        <Text>requests</Text>
      </Pressable>
    </>
  )
}

/** Join, as far as the way back goes: a screen with no back of its own. */
const Join = () => <Text testID="JoinScreen">join</Text>

const Tabs = createBottomTabNavigator()
const AgentStack = createStackNavigator()
const Root = createStackNavigator()
const MyAgent = () => (
  <AgentStack.Navigator initialRouteName={Screens.VtaAgent}>
    <AgentStack.Screen name={Screens.VtaAgent} component={AgentHome} />
    <AgentStack.Screen name={Screens.VtaRequests} component={VtaRequests} />
    <AgentStack.Screen name={Screens.VtiJoin} component={Join} />
  </AgentStack.Navigator>
)
const TabStack = () => (
  <Tabs.Navigator initialRouteName="Contacts" screenOptions={{ unmountOnBlur: true }}>
    <Tabs.Screen name="Contacts" component={Contacts} />
    <Tabs.Screen name="MyAgent" component={MyAgent} />
  </Tabs.Navigator>
)
const App = ({ navRef }: { navRef: React.RefObject<any> }) => (
  <BasicAppContext>
    <NavigationContainer ref={navRef}>
      <Root.Navigator>
        <Root.Screen name="TabStack" component={TabStack} />
      </Root.Navigator>
    </NavigationContainer>
  </BasicAppContext>
)

/** The focused route's name, all the way down. */
const focused = (state: any): string => {
  const route = state.routes[state.index ?? 0]
  return route.state ? focused(route.state) : route.name
}
const tabOf = (root: any): string => {
  const tabs = root.routes[0].state
  return tabs.routes[tabs.index].name
}
/** A link's navigation, as TabStack.tsx does it. */
const openLink = (navRef: React.RefObject<any>) =>
  routeKeyringAgentLink(APPROVALS_LINK, {} as never, (destination: MyAgentDestination) =>
    navRef.current.navigate('TabStack', { screen: 'MyAgent', params: myAgentLinkParams(destination) })
  )

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-10-02T12:00:00Z'))
  ;(useAgent as jest.Mock).mockReturnValue({ agent: { config: { logger: {} } } })
  controller.set({
    approvals: [],
    reconnectGaveUp: false,
    link: {
      kind: 'linked',
      vtaDid: 'did:webvh:example:vta',
      label: 'bob',
      linkedAt: '2026-10-01T00:00:00Z',
      connection: { kind: 'online' },
    },
  })
})
afterEach(() => {
  controller.set({ approvals: [] })
  jest.useRealTimers()
})

const settle = (ms = 500) =>
  act(async () => {
    jest.advanceTimersByTime(ms)
  })

test('the notification link, from another tab: opens Requests, and its way back lands on "Your agent", not Contacts', async () => {
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await settle()
  expect(focused(navRef.current.getRootState())).toBe('Contacts')

  await act(async () => {
    await openLink(navRef)
  })
  await settle()
  expect(focused(navRef.current.getRootState())).toBe(Screens.VtaRequests)
  expect(tree.getByTestId(id('Requests'))).toBeTruthy()

  // Nothing waits: once the agent has been quiet, the screen offers the way back.
  await settle(QUIET_MS + 1000)
  await act(async () => fireEvent.press(tree.getByTestId(id('RequestsBackToAgent'))))
  await settle()
  const root = navRef.current.getRootState()
  expect(focused(root)).toBe(Screens.VtaAgent)
  expect(tabOf(root)).toBe('MyAgent')
  expect(tree.queryByTestId('ContactsScreen')).toBeNull()
})

test('the notification link opens Requests on top of "Your agent", so the header\'s own back lands there', async () => {
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await settle()
  await act(async () => {
    await openLink(navRef)
  })
  await settle()
  const agentStack = navRef.current.getRootState().routes[0].state.routes.find((r: any) => r.name === 'MyAgent').state
  expect(agentStack.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.VtaRequests])
  // Something is under it, so the screen's own fallback back is not drawn.
  expect(tree.queryByTestId(id('RequestsHeaderBack'))).toBeNull()
  await act(async () => {
    navRef.current.goBack()
  })
  await settle()
  const root = navRef.current.getRootState()
  expect(focused(root)).toBe(Screens.VtaAgent)
  expect(tabOf(root)).toBe('MyAgent')
})

test.each(['Banner', 'ManageRow'])('from "Your agent", the %s opens Requests, and back returns to it', async (way) => {
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await settle()
  await act(async () => {
    navRef.current.navigate('TabStack', { screen: 'MyAgent' })
  })
  await settle()
  await act(async () => fireEvent.press(tree.getByTestId(way)))
  await settle()
  expect(focused(navRef.current.getRootState())).toBe(Screens.VtaRequests)

  await settle(QUIET_MS + 1000)
  await act(async () => fireEvent.press(tree.getByTestId(id('RequestsBackToAgent'))))
  await settle()
  const root = navRef.current.getRootState()
  expect(focused(root)).toBe(Screens.VtaAgent)
  expect(tabOf(root)).toBe('MyAgent')
  // Back was a real back: Requests is gone from the stack, not stacked under a second "Your agent".
  const agentStack = root.routes[0].state.routes.find((r: any) => r.name === 'MyAgent').state
  expect(agentStack.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent])
})

test('the link while already on "Your agent": Requests opens on top of it, and back returns to it', async () => {
  const navRef = React.createRef<any>()
  const tree = render(<App navRef={navRef} />)
  await settle()
  await act(async () => {
    navRef.current.navigate('TabStack', { screen: 'MyAgent' })
  })
  await settle()
  await act(async () => {
    await openLink(navRef)
  })
  await settle()
  expect(focused(navRef.current.getRootState())).toBe(Screens.VtaRequests)
  await settle(QUIET_MS + 1000)
  await act(async () => fireEvent.press(tree.getByTestId(id('RequestsBackToAgent'))))
  await settle()
  expect(focused(navRef.current.getRootState())).toBe(Screens.VtaAgent)
})

// 233: a community link opened Join as the stack's only route, with no back.
test('a community link from another tab opens Join on top of "Your agent", and back lands there', async () => {
  const navRef = React.createRef<any>()
  render(<App navRef={navRef} />)
  await settle()
  expect(focused(navRef.current.getRootState())).toBe('Contacts')
  await act(async () => {
    navRef.current.navigate('TabStack', { screen: 'MyAgent', params: myAgentLinkParams('VtiJoin') })
  })
  await settle()
  let root = navRef.current.getRootState()
  expect(focused(root)).toBe(Screens.VtiJoin)
  const agentStack = root.routes[0].state.routes.find((r: any) => r.name === 'MyAgent').state
  expect(agentStack.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.VtiJoin])
  await act(async () => {
    navRef.current.goBack()
  })
  await settle()
  root = navRef.current.getRootState()
  expect(focused(root)).toBe(Screens.VtaAgent)
  expect(tabOf(root)).toBe('MyAgent')
})
