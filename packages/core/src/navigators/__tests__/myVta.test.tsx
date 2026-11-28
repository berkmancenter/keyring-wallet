/**
 * Backlog 2 R2, step 7.8 (agent-connect plan §6 "Where the screens sit", §7.8; D20, D26; frames 12 and 20). With the
 * agent-connect switch on, the My Agent tab opens on the AI agents and the VTA's screens move under Settings as
 * "My VTA"; every link that opened a VTA screen opens it there. With it off, everything is as it was (the controls).
 *
 * The stacks are read as far as registration goes (`@react-navigation/stack` mocked to collect the screens a navigator
 * was given), and the translation answers the key, so titles are checked by key and, for the copy rule, in English
 * from the locale file.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { SectionList } from 'react-native'

import { useNavigation as mockedNavigation } from '../../../__mocks__/@react-navigation/native'
import { testDefaultState } from '../../../__tests__/contexts/store'
import authContext from '../../../__tests__/contexts/auth'
import { BasicAppContext } from '../../../__tests__/helpers/app'
import { AuthContext } from '../../contexts/auth'
import { StoreContext } from '../../contexts/store'
import en from '../../localization/en/en.json'
import { setAgentConnectEnabled } from '../../modules/connected-agents/agentConnectFlag'
import { openInMyAgent } from '../../modules/rooms/roomLinks'
import { openCommunityFrom } from '../../modules/trust-tasks/screens/CommunityCardDetails'
import {
  MY_AGENT_SCREEN,
  myAgentLinkParams,
  myAgentLinkRoute,
  myVtaRoute,
  type MyAgentDestination,
} from '../../modules/trust-tasks/module/vtiLinks'
import Settings from '../../screens/Settings'
import { Screens, Stacks, TabStacks } from '../../types/navigators'
import { testIdWithKey } from '../../utils/testable'
import MyAgentStack from '../MyAgentStack'
import SettingStack from '../SettingStack'
import VtaStack from '../VtaStack'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-native-keychain', () => ({ ACCESS_CONTROL: {}, ACCESSIBLE: {}, STORAGE_TYPE: {} }))

type Registered = { name: string; component?: unknown; options?: unknown }
// What the last navigator rendered was given: its first screen and its screens, fragments opened.
const mockStack: { initial?: string; screens: Registered[] } = { screens: [] }
jest.mock('@react-navigation/stack', () => {
  const R = jest.requireActual('react')
  const collect = (children: unknown, out: Registered[]) =>
    R.Children.forEach(children, (child: { type?: unknown; props?: { name?: string; children?: unknown } }) => {
      if (!child) return
      if (child.type === R.Fragment) collect(child.props?.children, out)
      else if (child.props?.name) out.push(child.props as Registered)
    })
  return {
    createStackNavigator: () => ({
      Navigator: ({ children, initialRouteName }: { children: unknown; initialRouteName?: string }) => {
        const out: Registered[] = []
        collect(children, out)
        mockStack.screens = out
        mockStack.initial = initialRouteName
        return null
      },
      Screen: () => null,
    }),
  }
})

// Today's My Agent stack, in order: the VTA's screens, then the rooms' (MyAgentStack.tsx before R2).
const VTA = [
  Screens.MyAgent,
  Screens.VtiCommunity,
  Screens.Poll,
  Screens.PollBallot,
  Screens.BadgeDetail,
  Screens.CommunityMembers,
  Screens.CommunityMemberCard,
  Screens.CommunityCard,
  Screens.VtiVetting,
  Screens.VtiHiddenVetting,
  Screens.VtiHiddenVetter,
  Screens.VtaLink,
  Screens.VtaCreateAgent,
  Screens.VtaDevices,
  Screens.VtaNewPhoneOffer,
  Screens.EditRCard,
  Screens.VtiJoin,
  Screens.VtiInvited,
  Screens.VtaAgent,
  Screens.VtaRequests,
  Screens.VtaAskMe,
  Screens.VtaTrustedApprovers,
  Screens.VtaApproverPerson,
  Screens.VtaAgentSettings,
  Screens.SignIn,
  Screens.VtaClaim,
  Screens.SharedConnect,
  Screens.GuardianCardReceive,
  Screens.StateOfficeCodes,
]
const ROOMS = [Screens.RoomsHome, Screens.Room, Screens.RoomInfo, Screens.RoomPart, Screens.RoomOffer]
// With the agent chat (R3), registered here too.
const AGENTS = [Screens.AiAgents, Screens.AgentDetails, Screens.ConnectAgent, Screens.AgentMemories, Screens.AgentChat]
// Today's title keys, in the same order (RoomPart's title is a function of its part).
const TODAY_TITLES = [
  'Screens.MyAgent',
  'Screens.Community',
  'Polls.Poll',
  'Polls.Ballot',
  'Badges.Badge',
  'Screens.CommunityMembers',
  'Screens.CommunityMemberCard',
  'Screens.CommunityCard',
  'Screens.Vetting',
  'Screens.HiddenVetting',
  'Screens.HiddenVetter',
  'Screens.VtaLink',
  'Screens.VtaCreateAgent',
  'Screens.VtaDevices',
  'Screens.VtaNewPhoneOffer',
  'EditRCard.CreateTitle',
  'Screens.Join',
  'Screens.Invited',
  'Screens.VtaAgent',
  'Screens.VtaRequests',
  'Screens.VtaAskMe',
  'Screens.VtaTrustedApprovers',
  'Screens.VtaApproverPerson',
  'Screens.VtaAgentSettings',
  'Screens.SignIn',
  'Screens.VtaClaim',
  'Screens.SharedConnect',
  'Screens.GuardianCardReceive',
  'Screens.StateOfficeCodes',
  'Rooms.Rooms',
  'Rooms.Room',
  'Rooms.Details',
  'Rooms.Offer',
]

const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const stackOf = (node: React.ReactElement) => {
  mockStack.screens = []
  mockStack.initial = undefined
  show(node)
  return { initial: mockStack.initial, screens: mockStack.screens, names: mockStack.screens.map((s) => s.name) }
}
const titleKeys = (screens: Registered[]) =>
  screens
    .map((s) => (s.options as { title?: string } | undefined)?.title)
    .filter((title): title is string => typeof title === 'string')
const english = (key: string): string => {
  const [group, name] = key.split('.')
  return (en as unknown as Record<string, Record<string, string>>)[group]?.[name] ?? key
}
// §7.8's copy rule, over English titles: one that calls the VTA "your agent" (or "My Agent", the AI agents' tab now)
// must also say "My VTA".
const breaksTheRule = (title: string) => /\b(your|my) agent\b/i.test(title) && !title.includes('My VTA')

afterEach(() => setAgentConnectEnabled(false))

describe('the My Agent tab', () => {
  it('control: with the switch off, it is the stack of today: the same screens, order, titles and first screen', () => {
    setAgentConnectEnabled(false)
    const { initial, screens, names } = stackOf(<MyAgentStack />)
    expect(names).toEqual([...VTA, ...ROOMS])
    expect(titleKeys(screens)).toEqual(TODAY_TITLES)
    // The first screen is the agent home's choice, as before (`agentHomeScreen`).
    expect([Screens.MyAgent, Screens.VtaLink, Screens.VtaAgent]).toContain(initial)
  })

  it('with it on, it opens on the AI agents, beside the rooms, and no VTA screen is registered there', () => {
    setAgentConnectEnabled(true)
    const { initial, names } = stackOf(<MyAgentStack />)
    expect(initial).toBe(Screens.AiAgents)
    expect(names).toEqual([...AGENTS, ...ROOMS])
    for (const name of VTA) expect(names).not.toContain(name)
  })
})

describe('"My VTA" under Settings', () => {
  it('VtaStack is the VTA screens of today, the same order and first screen, with the rooms', () => {
    setAgentConnectEnabled(false)
    const before = stackOf(<MyAgentStack />)
    setAgentConnectEnabled(true)
    const moved = stackOf(<VtaStack />)
    expect(moved.names).toEqual([...VTA, ...ROOMS])
    expect(moved.initial).toBe(before.initial)
    // The same components: the list is one function both stacks call, not a copy.
    const components = (screens: Registered[]) => screens.map((s) => s.component)
    expect(components(moved.screens)).toEqual(components(before.screens))
  })

  it('no screen in the moved stack calls the VTA "your agent" without its header saying "My VTA" (§7.8)', () => {
    setAgentConnectEnabled(true)
    const titles = titleKeys(stackOf(<VtaStack />).screens).map(english)
    expect(titles.filter(breaksTheRule)).toEqual([])
    // Its home screens' header is "My VTA".
    expect(titles[VTA.indexOf(Screens.VtaAgent)]).toBe('My VTA')
    expect(titles[VTA.indexOf(Screens.MyAgent)]).toBe('My VTA')
  })

  it('control: the same rule over the tab of today finds the titles the move changes', () => {
    setAgentConnectEnabled(false)
    const titles = titleKeys(stackOf(<MyAgentStack />).screens).map(english)
    expect(titles.filter(breaksTheRule)).toEqual(['My Agent', 'Link your agent', 'Your agent', 'Set up your agent'])
  })

  it('SettingStack registers "My VTA" with the moved stack only with the switch on', () => {
    setAgentConnectEnabled(false)
    expect(stackOf(<SettingStack />).names).not.toContain(Screens.MyVta)
    setAgentConnectEnabled(true)
    const { screens } = stackOf(<SettingStack />)
    const myVta = screens.find((s) => s.name === Screens.MyVta)
    expect(myVta?.component).toBe(VtaStack)
    expect(myVta?.options).toEqual(expect.objectContaining({ title: 'ConnectedAgents.MyVta', headerShown: false }))
  })
})

describe('the Settings row', () => {
  const settings = async () => {
    const tree = render(
      <StoreContext.Provider value={[testDefaultState, () => undefined]}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={mockedNavigation() as never} route={{} as never} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    await act(async () => undefined)
    return tree
  }
  const appSettings = (tree: Awaited<ReturnType<typeof settings>>) =>
    (
      tree.UNSAFE_getByType(SectionList).props.sections as {
        header: { title: string }
        data: { testID?: string; title?: string }[]
      }[]
    ).find((s) => s.header.title === 'Settings.AppSettings')?.data ?? []

  it('control: with the switch off, there is no "My VTA" row', async () => {
    setAgentConnectEnabled(false)
    const rows = appSettings(await settings())
    expect(rows.map((r) => r.testID)).not.toContain(testIdWithKey('MyVtaRow'))
    expect(rows[0].testID).toBe(testIdWithKey('Biometrics'))
  })

  it('with it on, "My VTA" is first in App Settings, and opens the moved stack', async () => {
    setAgentConnectEnabled(true)
    const tree = await settings()
    const rows = appSettings(tree)
    expect(rows[0]).toEqual(
      expect.objectContaining({ testID: testIdWithKey('MyVtaRow'), title: 'ConnectedAgents.MyVta' })
    )
    const navigate = mockedNavigation().navigate as jest.Mock
    navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('MyVtaRow')))
    expect(navigate).toHaveBeenCalledWith(Screens.MyVta)
  })

  it('with it on, every other row is where it was, rows placed by position included', async () => {
    // Data retention is put in by position, and only with the verifier on.
    const withDataRetention = {
      ...testDefaultState.preferences,
      useVerifierCapability: true,
      disableDataRetentionOption: false,
    }
    const ids = async (on: boolean) => {
      setAgentConnectEnabled(on)
      const tree = render(
        <StoreContext.Provider value={[{ ...testDefaultState, preferences: withDataRetention }, () => undefined]}>
          <BasicAppContext>
            <AuthContext.Provider value={authContext}>
              <Settings navigation={mockedNavigation() as never} route={{} as never} />
            </AuthContext.Provider>
          </BasicAppContext>
        </StoreContext.Provider>
      )
      await act(async () => undefined)
      return appSettings(tree).map((r) => r.testID)
    }
    const off = await ids(false)
    // Control: the row placed by position is there, so the order below is a real check.
    expect(off.indexOf(testIdWithKey('DataRetention'))).toBeGreaterThan(0)
    const on = await ids(true)
    expect(on).toEqual([testIdWithKey('MyVtaRow'), ...off])
  })
})

describe('every link that opened a VTA screen opens the same screen in the moved stack', () => {
  const DESTINATIONS: MyAgentDestination[] = [
    ...(Object.keys(MY_AGENT_SCREEN) as MyAgentDestination[]).filter((d) => typeof d === 'string'),
    { screen: 'SignIn', link: 'https://example.org/#_f=x', scanId: 's1' },
  ]

  it('control: with the switch off, a link goes to the My Agent tab, as always', () => {
    setAgentConnectEnabled(false)
    for (const destination of DESTINATIONS)
      expect(myAgentLinkRoute(destination)).toEqual({
        name: Stacks.TabStack,
        params: { screen: TabStacks.MyAgentStack, params: myAgentLinkParams(destination) },
      })
    expect(myVtaRoute(Screens.VtaDevices)).toBeUndefined()
  })

  it('with it on, deep links and scans through myAgentLinkParams open "My VTA" with the same params', () => {
    setAgentConnectEnabled(true)
    for (const destination of DESTINATIONS) {
      const route = myAgentLinkRoute(destination)
      expect(route).toEqual({
        name: Stacks.SettingStack,
        params: { screen: Screens.MyVta, params: myAgentLinkParams(destination) },
      })
      // And the screen it lands on is registered in the moved stack.
      const inner = (route.params as { params: { screen: Screens } }).params.screen
      expect([...VTA, ...ROOMS]).toContain(inner)
    }
  })

  const navigation = () => ({ navigate: jest.fn() })

  it.each([
    ["a room's community", Screens.VtiCommunity, { communityDid: 'did:web:c' }],
    ['a member card', Screens.CommunityMemberCard, { communityDid: 'did:web:c', memberDid: 'did:key:m' }],
    ['the profile', Screens.EditRCard, { profileId: 'p1' }],
  ])('%s from a room opens there with the switch on, and in the tab with it off', (_what, screen, params) => {
    setAgentConnectEnabled(true)
    const on = navigation()
    openInMyAgent(on, screen, params)
    expect(on.navigate).toHaveBeenCalledWith(Stacks.SettingStack, {
      screen: Screens.MyVta,
      params: { screen, params, initial: false },
    })
    setAgentConnectEnabled(false)
    const off = navigation()
    openInMyAgent(off, screen, params)
    expect(off.navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MyAgentStack,
      params: { screen, params, initial: false },
    })
  })

  it('a community from a card opens there with the switch on, and in the tab with it off', () => {
    setAgentConnectEnabled(true)
    const on = navigation()
    openCommunityFrom(on, 'did:web:c')
    expect(on.navigate).toHaveBeenCalledWith(Stacks.SettingStack, {
      screen: Screens.MyVta,
      params: { screen: Screens.VtiCommunity, params: { communityDid: 'did:web:c' }, initial: false },
    })
    setAgentConnectEnabled(false)
    const off = navigation()
    openCommunityFrom(off, 'did:web:c')
    expect(off.navigate).toHaveBeenCalledWith(Stacks.TabStack, {
      screen: TabStacks.MyAgentStack,
      params: { screen: Screens.VtiCommunity, params: { communityDid: 'did:web:c' }, initial: false },
    })
  })

  it('the devices (the sibling notice) open there with the switch on', () => {
    setAgentConnectEnabled(true)
    expect(myVtaRoute(Screens.VtaDevices)).toEqual({
      name: Stacks.SettingStack,
      params: { screen: Screens.MyVta, params: { screen: Screens.VtaDevices, params: undefined, initial: false } },
    })
  })
})
