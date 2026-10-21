/**
 * A tapped message notification with REAL navigators in the app's shape: the
 * root stack, the tabs (Messages among them) and the contact stack the chat is
 * in (TabStack.tsx, MessageStack.tsx, ContactStack.tsx). The wiring is the app's
 * own (`appMessageWakeDeps`); only the agent is a stand-in, whose pickup brings
 * the messages that were waiting at the mediator.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer, useRoute } from '@react-navigation/native'
import { createStackNavigator } from '@react-navigation/stack'
import { act, render } from '@testing-library/react-native'
import React, { useEffect, useSyncExternalStore } from 'react'
import { Text } from 'react-native'

import { Screens, Stacks, TabStacks } from '../../types/navigators'
import { setActiveChatConnectionId } from '../activeChatTracker'
import { appMessageWakeDeps, messageWakeFetching, openMessageWake } from '../messageWake'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const Contacts = () => <Text testID="ContactsScreen">contacts</Text>
const Messages = () => {
  const fetching = useSyncExternalStore(messageWakeFetching.subscribe, messageWakeFetching.get)
  return (
    <>
      <Text testID="MessagesScreen">messages</Text>
      {fetching ? <Text testID="FetchingNew">fetching</Text> : null}
    </>
  )
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
const Root = createStackNavigator()
const MessagesTab = () => (
  <MessageStack.Navigator>
    <MessageStack.Screen name={Screens.Messages} component={Messages} />
  </MessageStack.Navigator>
)
const TabStack = () => (
  <Tabs.Navigator initialRouteName="Contacts">
    <Tabs.Screen name="Contacts" component={Contacts} />
    <Tabs.Screen name={TabStacks.MessageStack} component={MessagesTab} />
  </Tabs.Navigator>
)
const Contact = () => (
  <ContactStack.Navigator>
    <ContactStack.Screen name={Screens.Chat} component={Chat} />
  </ContactStack.Navigator>
)
const App = ({ navRef }: { navRef: React.RefObject<any> }) => (
  <NavigationContainer ref={navRef}>
    <Root.Navigator>
      <Root.Screen name={Stacks.TabStack} component={TabStack} />
      <Root.Screen name={Stacks.ContactStack} component={Contact} />
    </Root.Navigator>
  </NavigationContainer>
)

/** A basic message as the agent stores it. */
const record = (connectionId: string, at: string) => ({
  connectionId,
  content: `hello from ${connectionId}`,
  role: 'receiver',
  createdAt: new Date(at),
  metadata: { get: () => undefined },
})

/** An agent with a mediator whose pickup delivers `waiting`, and its messages store. */
function agentWith(
  stored: ReturnType<typeof record>[],
  waiting: ReturnType<typeof record>[],
  duringPickup?: () => void
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

const tap = (navRef: React.RefObject<any>, agent: never) =>
  openMessageWake({
    ...appMessageWakeDeps({
      navigation: {
        navigate: (name, params) => navRef.current.navigate(name, params),
        getState: () => navRef.current.getRootState(),
      },
      agent,
      names: {
        tabStack: Stacks.TabStack,
        messageStack: TabStacks.MessageStack,
        messages: Screens.Messages,
        contactStack: Stacks.ContactStack,
        chat: Screens.Chat,
      },
    }),
    graceMs: 0,
  })

/**
 * Run a tap the way the app does: started from outside React, with React free
 * to render between its steps (a single act() around it would hold every
 * render, and so the navigation, back until the tap had finished).
 */
async function settle<T>(work: Promise<T>): Promise<T> {
  let done = false
  let value: T | undefined
  void work.then((v) => {
    done = true
    value = v
  })
  for (let i = 0; i < 200 && !done; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
  if (!done) throw new Error('the tap did not settle')
  return value as T
}

describe('a tapped message notification, with real navigators', () => {
  it('two contacts with unread messages: the chat with the newest one opens', async () => {
    const navRef = React.createRef<any>()
    const tree = render(<App navRef={navRef} />)
    const agent = agentWith([record('ada', '2026-10-20T10:00:00Z')], [record('bob', '2026-10-20T10:05:00Z')])
    const outcome = await settle(tap(navRef, agent))
    expect(outcome).toBe('chat')
    expect(await tree.findByTestId('Chat_bob')).toBeTruthy()
    expect(tree.queryByTestId('Chat_ada')).toBeNull()
  })

  it('a person who goes elsewhere while the messages come in is not moved', async () => {
    const navRef = React.createRef<any>()
    const tree = render(<App navRef={navRef} />)
    // They tap the Contacts tab while the pickup is still under way; the tap
    // renders before the waiting message has landed, as a real tap does.
    const agent = agentWith([], [record('bob', '2026-10-20T10:05:00Z')], async () => {
      navRef.current.navigate('Contacts')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const outcome = await settle(tap(navRef, agent))
    expect(outcome).toBe('moved')
    expect(tree.getByTestId('ContactsScreen')).toBeTruthy()
    expect(tree.queryByTestId('Chat_bob')).toBeNull()
  })

  it('nothing unread: it stays on the Messages list, and stops saying it is fetching', async () => {
    const navRef = React.createRef<any>()
    const tree = render(<App navRef={navRef} />)
    const agent = agentWith([], [])
    const outcome = await settle(tap(navRef, agent))
    expect(outcome).toBe('list')
    expect(tree.getByTestId('MessagesScreen')).toBeTruthy()
    expect(tree.queryByTestId('FetchingNew')).toBeNull()
  })
})
