/**
 * "I was invited" sends the person to the scanner, and keeps the way back
 * only while it is on screen (IN-304). Whether its unmount is a sound place to
 * end that depends on the navigators: the scanner is the main stack's Connect
 * Stack, pushed over the tabs, not the QR tab, so opening it does not change
 * the active tab and `unmountOnBlur` (TabStack) does not unmount My Agent.
 * Leaving to another tab does. Real navigators here, with the app's own route
 * names and `openScanner`, rather than a screen rendered alone.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, fireEvent, render } from '@testing-library/react-native'
import React, { useEffect } from 'react'
import { Pressable, Text } from 'react-native'

import { Screens, Stacks, TabStacks } from '../../../types/navigators'
import { communityLinkReturn } from '../module/vtiLinks'
import { openScanner } from '../screens/openScanner'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const leftInvited = jest.fn()

/** As VtiInvited: "Scan the community" sets the way back and opens the scanner; leaving ends it. */
const Invited: React.FC<{ navigation: unknown }> = ({ navigation }) => {
  useEffect(
    () => () => {
      leftInvited()
      communityLinkReturn.cancel()
    },
    []
  )
  return (
    <Pressable
      testID="scanCommunity"
      onPress={() => {
        communityLinkReturn.toInvited()
        openScanner(navigation)
      }}
    >
      <Text>Invited</Text>
    </Pressable>
  )
}
const Scanner = () => <Text>Scanner</Text>
const Contacts = () => <Text>Contacts</Text>

const Root = createStackNavigator()
const Tabs = createBottomTabNavigator()
const AgentStack = createStackNavigator()
const Connect = createStackNavigator()

const MyAgent = () => (
  <AgentStack.Navigator>
    <AgentStack.Screen name={Screens.VtiInvited} component={Invited as React.FC} />
  </AgentStack.Navigator>
)
const ConnectStack = () => (
  <Connect.Navigator>
    <Connect.Screen name={Screens.Scan} component={Scanner} />
  </Connect.Navigator>
)
// As TabStack.tsx: every tab unmounts when it loses focus.
const TabStack = () => (
  <Tabs.Navigator initialRouteName={TabStacks.MyAgentStack} screenOptions={{ unmountOnBlur: true }}>
    <Tabs.Screen name={TabStacks.ContactStack} component={Contacts} />
    <Tabs.Screen name={TabStacks.MyAgentStack} component={MyAgent} />
  </Tabs.Navigator>
)

const renderApp = (navRef: React.RefObject<any>) =>
  render(
    <NavigationContainer ref={navRef}>
      <Root.Navigator>
        <Root.Screen name={Stacks.TabStack} component={TabStack} />
        <Root.Screen name={Stacks.ConnectStack} component={ConnectStack} />
      </Root.Navigator>
    </NavigationContainer>
  )

beforeEach(() => {
  leftInvited.mockClear()
  communityLinkReturn.take()
})

describe('the way back to "I was invited", with the app’s navigators', () => {
  it('survives opening the scanner: the scanner is pushed over the tabs, and My Agent stays mounted', async () => {
    const navRef = React.createRef<any>()
    const tree = renderApp(navRef)
    await act(async () => fireEvent.press(tree.getByTestId('scanCommunity')))
    expect(tree.getByText('Scanner')).toBeTruthy()
    expect(leftInvited).not.toHaveBeenCalled()
    // A community scanned now would land back on "I was invited".
    expect(communityLinkReturn.take()).toBe(true)
  })

  it('ends when the person leaves for another tab: My Agent unmounts on blur', async () => {
    const navRef = React.createRef<any>()
    const tree = renderApp(navRef)
    await act(async () => fireEvent.press(tree.getByTestId('scanCommunity')))
    await act(async () => navRef.current.navigate(Stacks.TabStack, { screen: TabStacks.ContactStack }))
    expect(leftInvited).toHaveBeenCalledTimes(1)
    expect(communityLinkReturn.take()).toBe(false)
  })
})
