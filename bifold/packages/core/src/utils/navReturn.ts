/**
 * Coming back to where the person was after an inactivity lock.
 *
 * A lock sets `didAuthenticate` to false, and RootStack then swaps MainStack
 * for the PIN screens: MainStack unmounts and its navigation state goes with
 * it, so after the PIN the app opened on its first tab, not on the chat the
 * person had open (Signal and WhatsApp return you to it).
 *
 * So the container's state is noted as it changes (NavContainer), kept when an
 * inactivity lock happens (auth's lockOutUser, LockoutReason.Timeout only), and
 * put back once, as MainStack mounts after the PIN. It lives in memory only: a
 * cold start opens on the default, and nothing of the previous screen renders
 * before the PIN, because MainStack does not exist until then.
 *
 * Only screens that show something are put back: a flow that was half-way
 * through an action (a scan, an offer, a PIN change, linking an agent) is cut
 * off at its first step, and the person lands on the screen below it.
 */
import type { NavigationState, PartialState } from '@react-navigation/native'

import { Screens, Stacks, TabStacks } from '../types/navigators'

type AnyState = NavigationState | PartialState<NavigationState>

/**
 * Screens that are safe to open again with the same params. Every stack and tab is a container and allowed.
 * Neither agent screen is here: the My Agent tab comes back with no screen of its own, so its stack lands
 * on the agent home for the link state at unlock, never on the old panel for a linked person (225 gate).
 * The one exception is the home under a room or a community opened from it (see restorableState). A room
 * offer is not here: it is an action, so it lands on the screen below.
 */
const RESTORABLE: ReadonlySet<string> = new Set<string>([
  ...Object.values(Stacks),
  ...Object.values(TabStacks),
  Screens.Home,
  Screens.Contacts,
  Screens.Messages,
  Screens.ContactDetails,
  Screens.Chat,
  Screens.WhatAreContacts,
  Screens.WhatAreConnections,
  Screens.WitnessConnections,
  Screens.Credentials,
  Screens.CredentialDetails,
  Screens.OpenIDCredentialDetails,
  Screens.Settings,
  Screens.Language,
  Screens.DataRetention,
  Screens.About,
  Screens.AutoLock,
  Screens.HistorySettings,
  Screens.HistoryPage,
  Screens.HistoryDetails,
  Screens.MyProfiles,
  Screens.ProofRequests,
  Screens.ProofDetails,
  Screens.JSONDetails,
  Screens.RoomsHome,
  Screens.Room,
  Screens.RoomInfo,
  Screens.RoomPart,
  Screens.VtiCommunity,
])

/** What this needs of the container's ref. */
interface ReturnNavigationRef {
  isReady(): boolean
  resetRoot(state?: PartialState<NavigationState> | NavigationState): void
}

let navigationRef: ReturnNavigationRef | null = null
let latest: AnyState | undefined
let kept: AnyState | undefined

/** MainStack's root navigator is the one that has the tab stack. */
const isMainState = (state: AnyState | undefined): boolean =>
  !!state?.routes?.some((route) => route.name === Stacks.TabStack)

/** NavContainer registers its ref, so the state can be put back from anywhere. */
export const setReturnNavigationRef = (ref: ReturnNavigationRef | null): void => {
  navigationRef = ref
}

/** NavContainer's onStateChange: the latest state while the main screens are up. */
export const noteNavigationState = (state: AnyState | undefined): void => {
  if (isMainState(state)) latest = state
}

/** An inactivity lock: keep where the person was. */
export const keepReturnState = (): void => {
  kept = latest
}

/** A lock that is not for inactivity (log out): nothing to come back to. */
export const dropReturnState = (): void => {
  kept = undefined
  latest = undefined
}

/**
 * The state cut down to restorable screens: in each stack, the routes up to
 * (not including) the first that isn't, with the focus moved onto the last one
 * kept; in the tab navigator every tab, each cut the same way. Undefined when
 * nothing is left.
 *
 * A stack whose first screen is the agent home (`landsOn`: agentHomeScreen()
 * for the link state at unlock, read by the caller) keeps it under a room or
 * a community opened from it, so the person comes back to that room with the
 * home below it. With nothing kept above it the tab comes back with no screen,
 * as before, and a home that is no longer the home for the link state cuts the
 * stack there.
 */
export const restorableState = (state: AnyState | undefined, landsOn: string): AnyState | undefined => {
  if (!state?.routes?.length) return undefined
  const routes = []
  const landing = state.type !== 'tab' && state.routes[0].name === landsOn
  for (const route of state.routes) {
    if (!RESTORABLE.has(route.name) && !(landing && route === state.routes[0])) break
    const nested = route.state ? restorableState(route.state as AnyState, landsOn) : undefined
    // A tab whose stack can't come back keeps its place with its first screen, so
    // the other tabs and the focus stay right. A pushed stack in a stack does not:
    // its first screen may be the very flow being cut off (Connect Stack opens on Scan).
    if (route.state && !nested && state.type !== 'tab') break
    routes.push(nested ? { ...route, state: nested } : { ...route, state: undefined })
  }
  if (routes.length === (landing ? 1 : 0)) return undefined
  const index = Math.min(state.index ?? routes.length - 1, routes.length - 1)
  return { ...state, index, routes } as AnyState
}

/**
 * Called once as MainStack mounts after the PIN: puts the kept state back and
 * forgets it. False when there was nothing to put back.
 *
 * `landsOn` is the agent home for the link state now, agentHomeScreen(), read
 * by MainStack at unlock. It is passed in rather than read here so this file
 * stays a leaf: auth.tsx imports it, and the agent home reads the VTA agent.
 */
export const restoreReturnState = (landsOn: string): boolean => {
  const state = restorableState(kept, landsOn)
  kept = undefined
  if (!state || !navigationRef?.isReady()) return false
  navigationRef.resetRoot(state as PartialState<NavigationState>)
  return true
}
