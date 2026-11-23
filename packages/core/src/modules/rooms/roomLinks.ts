/**
 * Where a room's links go. A room opens in Messages or in My Agent (rooms in Messages, R2), and its community, a
 * member's card and the member's own profile are My Agent's screens: from either, they open there, above what My
 * Agent already shows.
 *
 * @module rooms/roomLinks
 */
import { Screens, Stacks, TabStacks } from '../../types/navigators'

type Navigates = { navigate: (name: string, params?: object) => void }

export const openInMyAgent = (navigation: unknown, screen: Screens, params?: object): void =>
  (navigation as Navigates).navigate(Stacks.TabStack, {
    screen: TabStacks.MyAgentStack,
    params: { screen, params, initial: false },
  })
