/**
 * "AI agents" (agent-connect plan §3.15 item 4, §7.7; backlog 2 R1): `AgentListView` over `useAgentConnections()` and
 * `useAgentActions()`. A container only: it reads hooks and passes props.
 *
 * - Open goes to the details; Connect, and Connect again (with the expired agent's id), to "Connect an agent".
 * - Extend re-asks through Approve and the biometric (`AgentExtendSheet`), Remove is `actions.remove`, and Revoke opens
 *   the same Revoke sheet as the details (`AgentRevokeSheet`), so one routed `revokeAgentConnection` call serves both.
 * - The listing is read again on each return to this screen, and after each act.
 *
 * Not here yet: the HCP list (`HcpAgentListView`, #1110) for `isHcpEnabled()`. Its view is not on this branch's base,
 * so with HCP on this screen still draws the base list; see the R1 pull request.
 */
import type { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { useAgentActions, useAgentConnections } from '../../modules/connected-agents/ConnectedAgentsProvider'
import AgentListView from '../../modules/connected-agents/screens/AgentListView'
import { MyAgentStackParams, Screens } from '../../types/navigators'

import { AgentExtendSheet, AgentRevokeSheet, agentRow } from './AgentDetailsScreen'

type AiAgentsScreenProps = StackScreenProps<MyAgentStackParams, Screens.AiAgents>

type Sheet = { kind: 'extend' | 'revoke'; id: string } | undefined

const AiAgentsScreen: React.FC<AiAgentsScreenProps> = ({ navigation }) => {
  const { agents, loading, refresh } = useAgentConnections()
  const actions = useAgentActions()
  const [sheet, setSheet] = useState<Sheet>()

  // Read again on each return (the details may have changed or removed one); the first focus is the mount's own read.
  const focused = useRef(false)
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (focused.current) void refresh()
        focused.current = true
      }),
    [navigation, refresh]
  )

  const close = useCallback(() => {
    setSheet(undefined)
    void refresh()
  }, [refresh])
  const open = sheet ? agents.find((a) => a.id === sheet.id) : undefined

  return (
    <>
      <AgentListView
        agents={loading && agents.length === 0 ? undefined : agents.map(agentRow)}
        onOpen={(id) => {
          const agent = agents.find((a) => a.id === id)
          if (agent) navigation.navigate(Screens.AgentDetails, { agentId: id, name: agent.name })
        }}
        onConnect={() => navigation.navigate(Screens.ConnectAgent)}
        onExtend={(id) => setSheet({ kind: 'extend', id })}
        onRemove={(id) => {
          void actions
            .remove(id)
            .catch(() => undefined)
            .finally(() => void refresh())
        }}
        onConnectAgain={(id) => navigation.navigate(Screens.ConnectAgent, { againFrom: id })}
        onRevoke={(id) => setSheet({ kind: 'revoke', id })}
      />
      {open && sheet?.kind === 'extend' ? <AgentExtendSheet agent={open} onClose={close} /> : null}
      {open && sheet?.kind === 'revoke' ? (
        <AgentRevokeSheet agentId={open.id} name={open.name} onClose={close} />
      ) : null}
    </>
  )
}

export default AiAgentsScreen
