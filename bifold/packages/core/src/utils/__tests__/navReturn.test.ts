import { Screens, Stacks, TabStacks } from '../../types/navigators'
import {
  dropReturnState,
  keepReturnState,
  noteNavigationState,
  restorableState,
  restoreReturnState,
  setReturnNavigationRef,
} from '../navReturn'

// The agent home for the link state at unlock (agentHomeScreen()); not linked unless a test says so.
let mockLandsOn: string = Screens.MyAgent
jest.mock('../../modules/trust-tasks/screens/agentHome', () => ({ agentHomeScreen: () => mockLandsOn }))
beforeEach(() => {
  mockLandsOn = Screens.MyAgent
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
    const state = restorableState(mainWithChat() as any) as any
    expect(state.index).toBe(1)
    expect(state.routes[1]).toEqual({ name: Screens.Chat, params: { connectionId: 'conn-1' }, state: undefined })
    expect(state.routes[0].state.index).toBe(1)
  })

  it('cuts a flow off at its first step, and focuses what is left (a scan pushed over the tabs)', () => {
    const state = restorableState({
      type: 'stack',
      index: 1,
      routes: [
        { name: Stacks.TabStack, state: tabs() },
        { name: Stacks.ConnectStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.Scan }] } },
      ],
    } as any) as any
    expect(state.routes.map((r: any) => r.name)).toEqual([Stacks.TabStack])
    expect(state.index).toBe(0)
  })

  it('cuts inside a stack too: a contact, then a PIN change on top of it', () => {
    const state = restorableState({
      type: 'stack',
      index: 2,
      routes: [{ name: Screens.Contacts }, { name: Screens.ContactDetails }, { name: Screens.ChangePIN }],
    } as any) as any
    expect(state.routes.map((r: any) => r.name)).toEqual([Screens.Contacts, Screens.ContactDetails])
    expect(state.index).toBe(1)
  })

  it('keeps every tab and the focus when one tab stack cannot come back', () => {
    const state = restorableState(tabs([{ name: 'Some flow screen' }]) as any) as any
    expect(state.routes).toHaveLength(2)
    expect(state.index).toBe(1)
    expect(state.routes[1].state).toBeUndefined()
  })

  it('brings the My Agent tab back with no screen, so it lands by link state (agentHomeScreen)', () => {
    const state = restorableState({
      type: 'tab',
      index: 1,
      routes: [
        { name: TabStacks.HomeStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.Home }] } },
        { name: TabStacks.MyAgentStack, state: { type: 'stack', index: 0, routes: [{ name: Screens.MyAgent }] } },
      ],
    } as any) as any
    expect(state.index).toBe(1)
    expect(state.routes[1]).toMatchObject({ name: TabStacks.MyAgentStack, state: undefined })
  })

  it('has nothing to give back when the first screen is not restorable', () => {
    expect(restorableState({ type: 'stack', index: 0, routes: [{ name: Screens.Scan }] } as any)).toBeUndefined()
    expect(restorableState(undefined)).toBeUndefined()
  })
})

describe('restorableState in rooms (the My Agent stack)', () => {
  beforeEach(() => {
    mockLandsOn = Screens.VtaAgent
  })

  it('keeps a room opened from Rooms, with its params, over the agent home, and the tab focused', () => {
    const state = restorableState(
      mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, room]) as any
    ) as any
    expect(state.routes[0].state.index).toBe(4)
    const agent = agentStackOf(state)
    expect(agent.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.RoomsHome, Screens.Room])
    expect(agent.index).toBe(2)
    expect(agent.routes[2].params).toEqual({ roomId: 'room-1' })
  })

  it('keeps a room opened from its community, and the community with its params', () => {
    const community = { name: Screens.VtiCommunity, params: { communityDid: 'did:example:community' } }
    const agent = agentStackOf(restorableState(mainInMyAgent([{ name: Screens.VtaAgent }, community, room]) as any))
    expect(agent.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.VtiCommunity, Screens.Room])
    expect(agent.routes[1].params).toEqual({ communityDid: 'did:example:community' })
  })

  it('cuts a room offer off, and lands on Rooms below it', () => {
    const offer = { name: Screens.RoomOffer, params: { offerRef: 'offer-1' } }
    const agent = agentStackOf(
      restorableState(mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, offer]) as any)
    )
    expect(agent.routes.map((r: any) => r.name)).toEqual([Screens.VtaAgent, Screens.RoomsHome])
    expect(agent.index).toBe(1)
  })

  it('brings the tab back with no screen when nothing above the home is kept (an offer opened from it)', () => {
    const offer = { name: Screens.RoomOffer, params: { offerRef: 'offer-1' } }
    const state = restorableState(mainInMyAgent([{ name: Screens.VtaAgent }, offer]) as any) as any
    expect(state.routes[0].state.index).toBe(4)
    expect(agentStackOf(state)).toBeUndefined()
  })

  it('cuts at a home that is no longer the home: unlinked during the lock, the tab lands by link state', () => {
    mockLandsOn = Screens.MyAgent
    const state = restorableState(
      mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, room]) as any
    ) as any
    expect(agentStackOf(state)).toBeUndefined()
  })

  it('keeps the agent home only at the bottom of a stack', () => {
    const state = restorableState({
      type: 'stack',
      index: 1,
      routes: [{ name: Screens.Contacts }, { name: Screens.VtaAgent }],
    } as any) as any
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

    expect(restoreReturnState()).toBe(true)
    expect(ref.resetRoot).toHaveBeenCalledTimes(1)
    const restored = ref.resetRoot.mock.calls[0][0]
    expect(restored.routes[restored.index]).toMatchObject({ name: Screens.Chat, params: { connectionId: 'conn-1' } })

    // A later unlock without a new lock has nothing to restore.
    expect(restoreReturnState()).toBe(false)
    expect(ref.resetRoot).toHaveBeenCalledTimes(1)
  })

  it('an inactivity lock in a room comes back to that room (agentHomeScreen() at unlock)', () => {
    mockLandsOn = Screens.VtaAgent
    noteNavigationState(mainInMyAgent([{ name: Screens.VtaAgent }, { name: Screens.RoomsHome }, room]) as any)
    keepReturnState()
    noteNavigationState(onboarding as any)

    expect(restoreReturnState()).toBe(true)
    const agent = agentStackOf(ref.resetRoot.mock.calls[0][0])
    expect(agent.routes[agent.index]).toMatchObject({ name: Screens.Room, params: { roomId: 'room-1' } })
  })

  it('a log out does not come back', () => {
    noteNavigationState(mainWithChat() as any)
    dropReturnState()
    expect(restoreReturnState()).toBe(false)
    expect(ref.resetRoot).not.toHaveBeenCalled()
  })

  it('a cold start (nothing noted) opens on the default', () => {
    keepReturnState()
    expect(restoreReturnState()).toBe(false)
    expect(ref.resetRoot).not.toHaveBeenCalled()
  })

  it('does nothing before the container is ready', () => {
    const notReady = makeRef(false)
    setReturnNavigationRef(notReady as any)
    noteNavigationState(mainWithChat() as any)
    keepReturnState()
    expect(restoreReturnState()).toBe(false)
    expect(notReady.resetRoot).not.toHaveBeenCalled()
  })
})
