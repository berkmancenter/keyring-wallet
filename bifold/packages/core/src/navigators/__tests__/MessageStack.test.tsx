/**
 * A notice opens a screen in Messages through the tab route's params, and every tab unmounts on blur. Kept on the tab,
 * those params opened the screen again each time Messages was rebuilt: an offer accepted or withdrawn said it couldn't
 * be read, on every return to the tab, even after Back. The stack drops them once it has acted on them.
 *
 * With the real navigators, not the app's mocks: what is under test is how they replay a route.
 */
import { act, render } from '@testing-library/react-native'
import React, { useEffect } from 'react'
import { Text } from 'react-native'

import { Screens } from '../../types/navigators'
import MessageStack from '../MessageStack'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.unmock('@react-navigation/stack')
jest.unmock('@react-navigation/bottom-tabs')

let mockMounts: string[] = []
// A declaration, so the mocks below, which load before any `const` here, can call it.
function mockScreen(name: string) {
  const Screen: React.FC = () => {
    useEffect(() => {
      mockMounts.push(name)
    }, [])
    return <Text>{name}</Text>
  }
  return Screen
}
jest.mock('../../screens/Messages', () => ({ __esModule: true, default: mockScreen('Messages') }))
jest.mock('../../screens/NewMessage', () => ({ __esModule: true, default: mockScreen('NewMessage') }))
jest.mock('../../modules/vrc/screens/WhatAreConnections', () => ({
  __esModule: true,
  default: mockScreen('WhatAreConnections'),
}))
jest.mock('../../modules/rooms/screens/Room', () => ({ __esModule: true, default: mockScreen('Room') }))
jest.mock('../../modules/rooms/screens/RoomInfo', () => ({ __esModule: true, default: mockScreen('RoomInfo') }))
jest.mock('../../modules/rooms/screens/RoomOffer', () => ({ __esModule: true, default: mockScreen('RoomOffer') }))
jest.mock('../../modules/rooms/screens/RoomPart', () => ({
  __esModule: true,
  default: mockScreen('RoomPart'),
  roomPartTitle: () => 'part',
}))
jest.mock('../defaultStackOptions', () => ({ useDefaultStackOptions: () => ({}) }))
jest.mock('../../contexts/theme', () => ({ useTheme: () => ({}) }))
jest.mock('../../container-api', () => ({ TOKENS: { OBJECT_SCREEN_CONFIG: 'screens' }, useServices: () => [{}] }))

const { createBottomTabNavigator } = jest.requireActual('@react-navigation/bottom-tabs')
const { createNavigationContainerRef, NavigationContainer } = jest.requireActual('@react-navigation/native')
const { createStackNavigator } = jest.requireActual('@react-navigation/stack')

const Tabs = createBottomTabNavigator()
const Root = createStackNavigator()
const MESSAGES = 'MessageTab'
const AGENT = 'AgentTab'
const Agent = mockScreen('Agent')

// As the app: a root stack over tabs that unmount on blur (TabStack.tsx), with the real MessageStack in one.
const TabStack: React.FC = () => (
  <Tabs.Navigator initialRouteName={MESSAGES} screenOptions={{ unmountOnBlur: true }}>
    <Tabs.Screen name={MESSAGES} component={MessageStack} />
    <Tabs.Screen name={AGENT} component={Agent} />
  </Tabs.Navigator>
)

type Nav = ReturnType<typeof createNavigationContainerRef>

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })

const open = async () => {
  const nav = createNavigationContainerRef() as Nav
  render(
    <NavigationContainer ref={nav}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="TabStack" component={TabStack} />
      </Root.Navigator>
    </NavigationContainer>
  )
  await settle()
  return nav
}

// The route roomNotices.ts sends from a notice's tap.
const notice = async (nav: Nav, screen: Screens, params: object) => {
  act(() =>
    (nav as unknown as { navigate: (name: string, params: object) => void }).navigate('TabStack', {
      screen: MESSAGES,
      params: { screen, initial: false, params },
    })
  )
  await settle()
}

const tabsState = (nav: Nav) =>
  nav.getRootState().routes[0].state as NonNullable<ReturnType<Nav['getRootState']>['routes'][0]['state']>

// A press on a tab: a navigate that merges, so the tab keeps what its route carries.
const tapTab = async (nav: Nav, name: string) => {
  act(() => nav.dispatch({ type: 'NAVIGATE', payload: { name, merge: true }, target: tabsState(nav).key }))
  await settle()
}

const awayAndBack = async (nav: Nav, times = 1) => {
  for (let i = 0; i < times; i++) {
    await tapTab(nav, AGENT)
    await tapTab(nav, MESSAGES)
  }
}

const mounted = (name: string) => mockMounts.filter((screen) => screen === name).length
const top = (nav: Nav) => nav.getCurrentRoute()?.name

beforeEach(() => {
  mockMounts = []
})

describe('a notice opens a screen in Messages once', () => {
  test('an offer opens above Messages, once; three returns to the tab land on Messages', async () => {
    const nav = await open()
    await notice(nav, Screens.RoomOffer, { offerRef: 'o1' })
    expect(top(nav)).toBe(Screens.RoomOffer)
    const opened = mounted('RoomOffer')

    await awayAndBack(nav, 3)
    expect(top(nav)).toBe(Screens.Messages)
    expect(mounted('RoomOffer')).toBe(opened)
  })

  test('Back, then a return to the tab: Messages, and the offer does not open again', async () => {
    const nav = await open()
    await notice(nav, Screens.RoomOffer, { offerRef: 'o1' })
    act(() => nav.goBack())
    await settle()
    expect(top(nav)).toBe(Screens.Messages)
    const opened = mounted('RoomOffer')

    await awayAndBack(nav)
    expect(top(nav)).toBe(Screens.Messages)
    expect(mounted('RoomOffer')).toBe(opened)
  })

  test('a room opened by a notice does not open again either', async () => {
    const nav = await open()
    await notice(nav, Screens.Room, { roomId: 'r1' })
    expect(top(nav)).toBe(Screens.Room)
    const opened = mounted('Room')

    await awayAndBack(nav)
    expect(top(nav)).toBe(Screens.Messages)
    expect(mounted('Room')).toBe(opened)
  })

  test('a later notice still opens: what is dropped is the one acted on', async () => {
    const nav = await open()
    await notice(nav, Screens.RoomOffer, { offerRef: 'o1' })
    await awayAndBack(nav)
    expect(top(nav)).toBe(Screens.Messages)

    await notice(nav, Screens.RoomOffer, { offerRef: 'o2' })
    expect(top(nav)).toBe(Screens.RoomOffer)
    expect(nav.getCurrentRoute()?.params).toEqual({ offerRef: 'o2' })
  })

  test('with no notice, returns to the tab open nothing (control)', async () => {
    const nav = await open()
    await awayAndBack(nav, 3)
    expect(top(nav)).toBe(Screens.Messages)
    expect(mounted('RoomOffer')).toBe(0)
  })

  test('an offer is mounted once, so it is read once, on the tap', async () => {
    const nav = await open()
    await notice(nav, Screens.RoomOffer, { offerRef: 'o1' })
    expect(mounted('RoomOffer')).toBe(1)
  })
})
