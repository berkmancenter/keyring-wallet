import { Screens, Stacks, TabStacks } from '../../types/navigators'
import {
  dropReturnState,
  keepReturnState,
  noteNavigationState,
  restorableState,
  restoreReturnState,
  setReturnNavigationRef,
} from '../navReturn'

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
