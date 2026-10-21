/**
 * A tapped message notification with REAL navigators, driven the way the app
 * drives it: from inside the main stack, with the navigation the TabStack
 * component gets from useNavigation(), under an outer root stack (RootStack →
 * MainStack → TabStack, MessageStack, ContactStack → Chat). The Messages list
 * says when it has focus (useReportMessagesListFocus), as the real one does.
 *
 * Build 265 (VTRM-RFH2) opened no chat: the check read navigation state for
 * the focused route, and in the app's nested tree it never saw the list, even
 * while the list was on screen. The test before this one drove the wake from
 * the container's root ref, and so never ran the app's path.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, useNavigation, useRoute } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, render } from '@testing-library/react-native'
import React, { useEffect, useState } from 'react'
import { Text } from 'react-native'

import { Screens, Stacks, TabStacks } from '../../types/navigators'
import { setActiveChatConnectionId } from '../activeChatTracker'
import {
  appMessageWakeDeps,
  messageWakeHold,
  openMessageWake,
  useReportMessagesListFocus,
  type WakeNavigation,
} from '../messageWake'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

/** How late the list mounts, as on a cold start (0 = at once). */
let listMountsAfterMs = 0
/** The main stack's navigation, as TabStack's handleDeepLink holds it. */
let mainNavigation: WakeNavigation | undefined

const Contacts = () => <Text testID="ContactsScreen">contacts</Text>
const List = () => {
  useReportMessagesListFocus()
  return <Text testID="MessagesScreen">messages</Text>
}
const Messages = () => {
  const [mounted, setMounted] = useState(listMountsAfterMs === 0)
  useEffect(() => {
    if (mounted) return
    const timer = setTimeout(() => setMounted(true), listMountsAfterMs)
    return () => clearTimeout(timer)
  }, [mounted])
  return mounted ? <List /> : <Text testID="MessagesLoading">loading</Text>
}
const Chat = () => {
  const { connectionId } = useRoute().params as { connectionId: string }
  useEffect(() => {
    setActiveChatConnectionId(connectionId)
    return () => setActiveChatConnectionId(undefined)
  }, [connectionId])
  return <Text testID={`Chat_${connectionId}`}>chat</Text>
}

const Tabs = createBottomTabNavigator()
const MessageStack = createStackNavigator()
const ContactStack = createStackNavigator()
const Main = createStackNavigator()
const Root = createStackNavigator()
const MessagesTab = () => (
  <MessageStack.Navigator>
    <MessageStack.Screen name={Screens.Messages} component={Messages} />
  </MessageStack.Navigator>
)
/** As TabStack.tsx: it takes the main stack's navigation with useNavigation(). */
const TabStack = () => {
  mainNavigation = useNavigation() as unknown as WakeNavigation
  return (
    <Tabs.Navigator initialRouteName="Contacts">
      <Tabs.Screen name="Contacts" component={Contacts} />
      <Tabs.Screen name={TabStacks.MessageStack} component={MessagesTab} />
    </Tabs.Navigator>
  )
}
const Contact = () => (
  <ContactStack.Navigator>
    <ContactStack.Screen name={Screens.Chat} component={Chat} />
  </ContactStack.Navigator>
)
const MainStack = () => (
  <Main.Navigator initialRouteName={Stacks.TabStack}>
    <Main.Screen name={Stacks.TabStack} component={TabStack} />
    <Main.Screen name={Stacks.ContactStack} component={Contact} />
  </Main.Navigator>
)
const App = () => (
  <NavigationContainer>
    <Root.Navigator>
      <Root.Screen name="MainStack" component={MainStack} />
    </Root.Navigator>
  </NavigationContainer>
)

const record = (connectionId: string, at: string) => ({
  connectionId,
  content: `hello from ${connectionId}`,
  role: 'receiver',
  createdAt: new Date(at),
  metadata: { get: () => undefined },
})

function agentWith(
  stored: ReturnType<typeof record>[],
  waiting: ReturnType<typeof record>[],
  duringPickup?: () => Promise<void>
) {
  const listeners = new Set<(event: unknown) => void>()
  return {
    events: {
      observable: () => ({
        subscribe: (fn: (event: unknown) => void) => {
          listeners.add(fn)
          return { unsubscribe: () => listeners.delete(fn) }
        },
      }),
    },
    modules: {
      didcomm: {
        mediationRecipient: { findDefaultMediator: async () => ({ connectionId: 'mediator', protocolVersion: 'v1' }) },
        messagePickup: {
          pickupMessages: jest.fn(async () => {
            await duringPickup?.()
            for (const message of waiting) {
              stored.push(message)
              listeners.forEach((fn) => fn({ payload: { basicMessageRecord: message } }))
            }
          }),
        },
        basicMessages: { findAllByQuery: async () => stored },
      },
    },
  } as never
}

/** The app's tap: the main stack's own navigation, the app's own wiring. */
const tap = (agent: never) =>
  openMessageWake({
    ...appMessageWakeDeps({
      navigation: mainNavigation!,
      agent,
      names: {
        tabStack: Stacks.TabStack,
        messageStack: TabStacks.MessageStack,
        contactStack: Stacks.ContactStack,
        chat: Screens.Chat,
      },
    }),
    graceMs: 0,
  })

/** Let React render between the tap's steps, as the app does; a single act() would hold every render back. */
async function settle<T>(work: Promise<T>): Promise<T> {
  let done = false
  let value: T | undefined
  void work.then((v) => {
    done = true
    value = v
  })
  for (let i = 0; i < 400 && !done; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  if (!done) throw new Error('the tap did not settle')
  return value as T
}

beforeEach(() => {
  listMountsAfterMs = 0
  mainNavigation = undefined
})

describe('a tapped message notification, driven as the app drives it', () => {
  it('two contacts with unread messages: the chat with the newest one opens', async () => {
    const tree = render(<App />)
    const agent = agentWith([record('ada', '2026-10-20T10:00:00Z')], [record('bob', '2026-10-20T10:05:00Z')])
    expect(await settle(tap(agent))).toBe('chat')
    expect(await tree.findByTestId('Chat_bob')).toBeTruthy()
    expect(tree.queryByTestId('Chat_ada')).toBeNull()
  })

  it('a cold-start tap, the list mounting 1.5 s late: the chat still opens (build 265 stayed put)', async () => {
    listMountsAfterMs = 1500
    const tree = render(<App />)
    const agent = agentWith([], [record('bob', '2026-10-20T10:05:00Z')])
    expect(await settle(tap(agent))).toBe('chat')
    expect(await tree.findByTestId('Chat_bob')).toBeTruthy()
  })

  it('a person who goes elsewhere after the list took focus is not moved', async () => {
    const tree = render(<App />)
    const agent = agentWith([], [record('bob', '2026-10-20T10:05:00Z')], async () => {
      mainNavigation!.navigate(Stacks.TabStack, { screen: 'Contacts' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(await settle(tap(agent))).toBe('moved')
    expect(tree.getByTestId('ContactsScreen')).toBeTruthy()
    expect(tree.queryByTestId('Chat_bob')).toBeNull()
    expect(messageWakeHold.isHolding()).toBe(false)
  })

  it('nothing unread: it stays on the Messages list', async () => {
    const tree = render(<App />)
    expect(await settle(tap(agentWith([], [])))).toBe('list')
    expect(tree.getByTestId('MessagesScreen')).toBeTruthy()
  })
})

/**
 * Why the list reports its own focus, pinned so it stays true or says it no
 * longer is. In this tree, the main stack's state (what TabStack's
 * navigation.getState() returns) reaches the tabs but not the message stack's
 * own state, so a walk for the focused route stops at the tab while the list is
 * on screen. That is what build 265 tripped over. If a react-navigation upgrade
 * makes the nested state visible here, this fails: the focus report still
 * holds, but the reason recorded for it would then be out of date.
 */
describe('why the Messages list reports its own focus', () => {
  const deepest = (state: unknown): string | undefined => {
    let node = state as { index?: number; routes?: { name: string; state?: unknown }[] } | undefined
    let name: string | undefined
    while (node?.routes?.length) {
      const route = node.routes[node.index ?? node.routes.length - 1]
      name = route.name
      node = route.state as typeof node
    }
    return name
  }

  it("the main stack's state stops at the tab while the list is on screen", async () => {
    const tree = render(<App />)
    await act(async () => {
      mainNavigation!.navigate(Stacks.TabStack, { screen: TabStacks.MessageStack })
    })
    for (let i = 0; i < 10; i++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    expect(tree.getByTestId('MessagesScreen')).toBeTruthy()
    const seen = deepest((mainNavigation as unknown as { getState(): unknown }).getState())
    expect(seen).toBe(TabStacks.MessageStack)
    expect(seen).not.toBe(Screens.Messages)
  })
})
