/**
 * Which agent holds each identity, for the Wallet's community cards: with
 * several agents, a card says whose it is ("Member of X · Personal"), since two
 * agents' identities can each be a member of one community. With one agent the
 * cards read as before.
 *
 * @module trust-tasks/screens/cardAgentNames
 */
import type { Agent } from '@credo-ts/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommunityChanged } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'

import { agentDisplayName, withAgentName, type NamedAgent } from './agentName'
import { setCardAgentNames } from './communityCardDisplay'

/** Identity DID → the name of the agent that holds it; empty with fewer than two agents. */
export function cardAgentNamesOf(
  personas: Pick<VtiPersona, 'did' | 'vtaDid'>[],
  agents: readonly NamedAgent[],
  nameOf: (agent: NamedAgent) => string
): Map<string, string> {
  const names = new Map<string, string>()
  if (agents.length < 2) return names
  for (const p of personas) {
    const holder = agents.find((a) => a.vtaDid === p.vtaDid)
    if (holder) names.set(p.did, nameOf(holder))
  }
  return names
}

export function useCardAgentNames(agent: Agent | undefined): void {
  const { t } = useTranslation()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const agents = state.agents
  const agentNames = state.agentNames
  // An identity minted or forgotten changes whose cards are whose.
  const [changed, setChanged] = useState(0)
  useCommunityChanged(() => setChanged((n) => n + 1))
  useEffect(() => {
    if (!agent) return
    let live = true
    void new GenericRecordsIdentityStore(agent)
      .listPersonas()
      .then((personas) => {
        if (!live) return
        setCardAgentNames(
          cardAgentNamesOf(personas, agents ?? [], (a) => agentDisplayName(withAgentName(a, agentNames), t))
        )
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [agent, agents, agentNames, t, changed])
}
