/**
 * "Open <community>" from a Wallet card's Details (226) opens the community on
 * the My Agent tab ABOVE "Your agent", so the tab can come back. On a device
 * (candidate 3) the community screen became the My Agent stack's only route and
 * the tab was stuck there. This renders real navigators (a root stack, the tabs,
 * the My Agent stack) and reads the state the navigation leaves.
 */
jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, createNavigationContainerRef, useNavigation } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

import { COMMUNITY } from '../../../../__tests__/helpers/cardVault'
import { Screens, Stacks, TabStacks } from '../../../types/navigators'
import { openCommunityFrom } from '../screens/CommunityCardDetails'

type State = { routes: { name: string; state?: State }[] }

const Root = createStackNavigator()
const Tabs = createBottomTabNavigator()
const MyAgent = createStackNavigator()

let walletNavigation: unknown
const Wallet = () => {
  walletNavigation = useNavigation()
  return <Text>wallet</Text>
}
const Page = ({ name }: { name: string }) => () => <Text>{name}</Text>
const AgentHome = Page({ name: 'agent home' })
const Community = Page({ name: 'community' })

const MyAgentStack = () => (
  <MyAgent.Navigator initialRouteName={Screens.VtaAgent}>
    <MyAgent.Screen name={Screens.VtaAgent} component={AgentHome} />
    <MyAgent.Screen name={Screens.VtiCommunity} component={Community} />
  </MyAgent.Navigator>
)
const TabStack = () => (
  <Tabs.Navigator>
    <Tabs.Screen name={TabStacks.CredentialStack} component={Wallet} />
    <Tabs.Screen name={TabStacks.MyAgentStack} component={MyAgentStack} />
  </Tabs.Navigator>
)

const myAgentRoutes = (state: State | undefined): string[] => {
  const tabs = state?.routes.find((r) => r.name === Stacks.TabStack)?.state
  const myAgent = tabs?.routes.find((r) => r.name === TabStacks.MyAgentStack)?.state
  return myAgent?.routes.map((r) => r.name) ?? []
}

describe('Open <community> from a Wallet card', () => {
  it('leaves "Your agent" under the community, so the My Agent tab can go back', async () => {
    const ref = createNavigationContainerRef()
    render(
      <NavigationContainer ref={ref}>
        <Root.Navigator>
          <Root.Screen name={Stacks.TabStack} component={TabStack} />
        </Root.Navigator>
      </NavigationContainer>
    )
    await act(async () => {
      openCommunityFrom(walletNavigation, COMMUNITY)
    })
    expect(myAgentRoutes(ref.getRootState() as unknown as State)).toEqual([Screens.VtaAgent, Screens.VtiCommunity])
  })
})
