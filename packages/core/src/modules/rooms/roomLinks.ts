/**
 * Where a room's links go. A room opens in Messages or in My Agent (rooms in Messages, R2), and its community, a
 * member's card and the member's own profile are My Agent's screens: from either, they open there, above what My
 * Agent already shows.
 *
 * With agent connect's developer switch on, those screens have moved under Settings as "My VTA" (agent-connect plan
 * §7.8), so they open there instead. With it off, the My Agent tab, as always.
 *
 * @module rooms/roomLinks
 */
import { isAgentConnectEnabled } from '../connected-agents/agentConnectFlag'
import { Screens, Stacks, TabStacks } from '../../types/navigators'

type Navigates = { navigate: (name: string, params?: object) => void }

export const openInMyAgent = (navigation: unknown, screen: Screens, params?: object): void =>
  isAgentConnectEnabled()
    ? (navigation as Navigates).navigate(Stacks.SettingStack, {
        screen: Screens.MyVta,
        params: { screen, params, initial: false },
      })
    : (navigation as Navigates).navigate(Stacks.TabStack, {
        screen: TabStacks.MyAgentStack,
        params: { screen, params, initial: false },
      })
