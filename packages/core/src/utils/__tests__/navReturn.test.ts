import fs from 'node:fs'
import path from 'node:path'

import { Screens, Stacks, TabStacks } from '../../types/navigators'
import {
  dropReturnState,
  keepReturnState,
  noteNavigationState,
  restorableState,
  restoreReturnState,
  setReturnNavigationRef,
} from '../navReturn'

// The agent home for the link state at unlock, as MainStack passes it (agentHomeScreen()); not linked unless a test
// says so.
let landsOn: string = Screens.MyAgent
beforeEach(() => {
  landsOn = Screens.MyAgent
})

// MainStack's state with a chat open on top of the tabs (Contacts tab focused).
const tabs = (contactRoutes: any[] = [{ name: Screens.Contacts }]) => ({
  type: 'tab',
  index: 1,
  routes: [
    { name: TabStacks.HomeStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.Home }] } },
    { name: TabStacks.ContactStack, state: { type: 'stack', index: contactRoutes.length - 1, routes: contactRoutes } },
  ],
})
const mainWithChat = () => ({
  type: 'stack',
  index: 1,
  routes: [
    { name: Stacks.TabStack, state: tabs() },
    { name: Screens.Chat, params: { connectionId: 'conn-1' } },
  ],
})
// MainStack's state with the My Agent tab focused and `agentRoutes` in its stack, as TabStack nests it: the
// rooms screens are in MyAgentStack, above the agent home it lands on. The other tabs unmount on blur.
const mainInMyAgent = (agentRoutes: any[]) => ({
  type: 'stack',
  index: 0,
  routes: [
    {
      name: Stacks.TabStack,
      state: {
        type: 'tab',
        index: 4,
        routes: [
          { name: TabStacks.ContactStack },
          { name: TabStacks.MessageStack },
          { name: TabStacks.ConnectStack },
          { name: TabStacks.CredentialStack },
          {
            name: TabStacks.MyAgentStack,
            state: { type: 'stack', index: agentRoutes.length - 1, routes: agentRoutes },
          },
          { name: TabStacks.SettingStack },
        ],
      },
    },
  ],
})
const agentStackOf = (state: any) => state.routes[0].state.routes[4].state
const room = { name: Screens.Room, params: { roomId: 'room-1' } }
const onboarding = { type: 'stack', index: 0, routes: [{ name: Screens.EnterPIN }] }

const makeRef = (ready = true) => ({ isReady: jest.fn(() => ready), resetRoot: jest.fn() })

describe('restorableState', () => {
  it('keeps an open chat, with its params, and the tabs under it', () => {
    const state = restorableState(mainWithChat() as any, landsOn) as any
    expect(state.index).toBe(1)
    expect(state.routes[1]).toEqual({ name: Screens.Chat, params: { connectionId: 'conn-1' }, state: undefined })
    expect(state.routes[0].state.index).toBe(1)
  })

  it('cuts a flow off at its first step, and focuses what is left (a scan pushed over the tabs)', () => {
    const state = restorableState(
      {
        type: 'stack',
        index: 1,
        routes: [
          { name: Stacks.TabStack, state: tabs() },
          { name: Stacks.ConnectStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.Scan }] } },
        ],
      } as any,
      landsOn
    ) as any
    expect(state.routes.map((r: any) => r.name)).toEqual([Stacks.TabStack])
    expect(state.index).toBe(0)
  })

  it('cuts inside a stack too: a contact, then a PIN change on top of it', () => {
    const state = restorableState(
      {
        type: 'stack',
        index: 2,
        routes: [{ name: Screens.Contacts }, { name: Screens.ContactDetails }, { name: Screens.ChangePIN }],
      } as any,
      landsOn
    ) as any
    expect(state.routes.map((r: any) => r.name)).toEqual([Screens.Contacts, Screens.ContactDetails])
    expect(state.index).toBe(1)
  })

  it('keeps every tab and the focus when one tab stack cannot come back', () => {
    const state = restorableState(tabs([{ name: 'Some flow screen' }]) as any, landsOn) as any
    expect(state.routes).toHaveLength(2)
    expect(state.index).toBe(1)
    expect(state.routes[1].state).toBeUndefined()
  })

  it('brings the My Agent tab back with no screen, so it lands by link state (agentHomeScreen)', () => {
    const state = restorableState(
      {
        type: 'tab',
        index: 1,
        routes: [
          { name: TabStacks.HomeStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.Home }] } },
          { name: TabStacks.MyAgentStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.MyAgent }] } },
        ],
      } as any,
      landsOn
    ) as any
    expect(state.index).toBe(1)
    expect(state.routes[1]).toMatchObject({ name: TabStacks.MyAgentStack, state: undefined })
  })

  it('has nothing to give back when the first screen is not restorable', () => {
    expect(
      restorableState({ type: 'stack', index: 0, routes: [{ name: Screens.Scan }] } as any, landsOn)
    ).toBeUndefined()
    expect(restorableState(undefined, landsOn)).toBeUndefined()
  })
})

// MainStack's state with the Messages tab focused and `messageRoutes` in its stack: a room opened from its row in
// Messages is in MessageStack (rooms in Messages, R2).
const mainInMessages = (messageRoutes: any[]) => ({
  type: 'stack',
  index: 0,
  routes: [
    {
      name: Stacks.TabStack,
      state: {
        type: 'tab',
        index: 1,
        routes: [
          { name: TabStacks.ContactStack },
          {
            name: TabStacks.MessageStack,
            state: { type: 'stack', index: messageRoutes.length - 1, routes: messageRoutes },
          },
        ],
      },
    },
  ],
})
const messageStackOf = (state: any) => state.routes[0].state.routes[1].state

describe('restorableState in a room opened from Messages', () => {
  it('keeps the room, its details and the part open over them, with their params, and the Messages tab focused', () => {
    const info = { name: Screens.RoomInfo, params: { roomId: 'room-1' } }
    const notes = { name: Screens.RoomPart, params: { roomId: 'room-1', part: 'notes' } }
    const state = restorableState(
      mainInMessages([{ name: Screens.Messages }, room, info, notes]) as any,
      landsOn
    ) as any
    expect(state.routes[0].state.index).toBe(1)
    const messages = messageStackOf(state)
    expect(messages.routes.map((r: any) => r.name)).toEqual([
      Screens.Messages,
      Screens.Room,
      Screens.RoomInfo,
      Screens.RoomPart,
    ])
    expect(messages.index).toBe(3)
    expect(messages.routes[3].params).toEqual({ roomId: 'room-1', part: 'notes' })
  })

  it('cuts a room offer off, and lands on Messages below it (control: the screens above are kept)', () => {
    const offer = { name: Screens.RoomOffer, params: { offerRef: 'offer-1' } }
    const messages = messageStackOf(
      restorableState(mainInMessages([{ name: Screens.Messages }, offer]) as any, landsOn)
    )
    expect(messages.routes.map((r: any) => r.name)).toEqual([Screens.Messages])
    expect(messages.index).toBe(0)
  })
})

describe('restorableState in rooms (the My Agent stack)', () => {
  beforeEach(() => {
    landsOn = Screens.VtaAgent
  })

  it('keeps a room opened from Rooms, with its params, over the agent home, and the tab focused', () => {
    const state = restorableState(
      mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, room]) as any,
      landsOn
    ) as any
    expect(state.routes[0].state.index).toBe(4)
    const agent = agentStackOf(state)
    expect(agent.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.RoomsHome, Screens.Room])
    expect(agent.index).toBe(2)
    expect(agent.routes[2].params).toEqual({ roomId: 'room-1' })
  })

  it('keeps a room opened from its community, and the community with its params', () => {
    const community = { name: Screens.VtiCommunity, params: { communityDid: 'did:example:community' } }
    const agent = agentStackOf(
      restorableState(mainInMyAgent([{ name: Screens.VtaAgent }, community, room]) as any, landsOn)
    )
    expect(agent.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.VtiCommunity, Screens.Room])
    expect(agent.routes[1].params).toEqual({ communityDid: 'did:example:community' })
  })

  it('cuts a room offer off, and lands on Rooms below it', () => {
    const offer = { name: Screens.RoomOffer, params: { offerRef: 'offer-1' } }
    const agent = agentStackOf(
      restorableState(mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, offer]) as any, landsOn)
    )
    expect(agent.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.RoomsHome])
    expect(agent.index).toBe(1)
  })

  it('brings the tab back with no screen when nothing above the home is kept (an offer opened from it)', () => {
    const offer = { name: Screens.RoomOffer, params: { offerRef: 'offer-1' } }
    const state = restorableState(mainInMyAgent([{ name: Screens.VtaAgent }, offer]) as any, landsOn) as any
    expect(state.routes[0].state.index).toBe(4)
    expect(agentStackOf(state)).toBeUndefined()
  })

  it('cuts at a home that is no longer the home: unlinked during the lock, the tab lands by link state', () => {
    landsOn = Screens.MyAgent
    const state = restorableState(
      mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, room]) as any,
      landsOn
    ) as any
    expect(agentStackOf(state)).toBeUndefined()
  })

  it('keeps the agent home only at the bottom of a stack', () => {
    const state = restorableState(
      {
        type: 'stack',
        index: 1,
        routes: [{ name: Screens.Contacts }, { name: Screens.VtaAgent }],
      } as any,
      landsOn
    ) as any
    expect(state.routes.map((r: any) => r.name)).toEqual([Screens.Contacts])
  })
})

describe('coming back after a lock', () => {
  let ref: ReturnType<typeof makeRef>
  beforeEach(() => {
    dropReturnState()
    ref = makeRef()
    setReturnNavigationRef(ref as any)
  })

  it('an inactivity lock comes back to the open chat, once', () => {
    noteNavigationState(mainWithChat() as any)
    keepReturnState()
    // The PIN screens replace MainStack: their state must not replace what was kept.
    noteNavigationState(onboarding as any)

    expect(restoreReturnState(landsOn)).toBe(true)
    expect(ref.resetRoot).toHaveBeenCalledTimes(1)
    const restored = ref.resetRoot.mock.calls[0][0]
    expect(restored.routes[restored.index]).toMatchObject({ name: Screens.Chat, params: { connectionId: 'conn-1' } })

    // A later unlock without a new lock has nothing to restore.
    expect(restoreReturnState(landsOn)).toBe(false)
    expect(ref.resetRoot).toHaveBeenCalledTimes(1)
  })

  it('an inactivity lock in a room comes back to that room (agentHomeScreen() at unlock)', () => {
    landsOn = Screens.VtaAgent
    noteNavigationState(mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, room]) as any)
    keepReturnState()
    noteNavigationState(onboarding as any)

    expect(restoreReturnState(landsOn)).toBe(true)
    const agent = agentStackOf(ref.resetRoot.mock.calls[0][0])
    expect(agent.routes[agent.index]).toMatchObject({ name: Screens.Room, params: { roomId: 'room-1' } })
  })

  it('a log out does not come back', () => {
    noteNavigationState(mainWithChat() as any)
    dropReturnState()
    expect(restoreReturnState(landsOn)).toBe(false)
    expect(ref.resetRoot).not.toHaveBeenCalled()
  })

  it('a cold start (nothing noted) opens on the default', () => {
    keepReturnState()
    expect(restoreReturnState(landsOn)).toBe(false)
    expect(ref.resetRoot).not.toHaveBeenCalled()
  })

  it('does nothing before the container is ready', () => {
    const notReady = makeRef(false)
    setReturnNavigationRef(notReady as any)
    noteNavigationState(mainWithChat() as any)
    keepReturnState()
    expect(restoreReturnState(landsOn)).toBe(false)
    expect(notReady.resetRoot).not.toHaveBeenCalled()
  })
})

// auth.tsx imports this file, so it stays a leaf: the agent home (which reads the VTA agent) comes from MainStack.
describe('the agent home comes from MainStack', () => {
  const source = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8')

  // The whole set, not a modules/ substring: a new import of any kind is looked at, since one that isn't spelled
  // modules/ could still pull the VTA agent in.
  it('navReturn imports only the navigation types and the screen names', () => {
    const specifiers = [...source('../navReturn.ts').matchAll(/^import [^;]*? from '([^']+)'/gm)].map(
      ([, spec]) => spec
    )
    expect(specifiers.sort()).toEqual(['../types/navigators', '@react-navigation/native'])
  })

  // The default parameter guaranteed a read at unlock; now the call site does. agentHomeScreen() is called inside
  // MainStack's mount effect, after the PIN, never a value read earlier or a screen named outright.
  it('MainStack passes agentHomeScreen() as it mounts after the PIN', () => {
    const mainStack = source('../../navigators/MainStack.tsx')
    expect(mainStack).toMatch(/import \{ agentHomeScreen \} from '\.\.\/modules\/trust-tasks\/screens\/agentHome'/)
    expect(mainStack).toMatch(/useEffect\(\(\) => \{\s*restoreReturnState\(agentHomeScreen\(\)\)\s*\}, \[\]\)/)
    expect(mainStack.match(/restoreReturnState\(/g)).toHaveLength(1)
  })
})
