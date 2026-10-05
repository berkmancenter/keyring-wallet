/**
 * Look at the agents that are not current when the app opens and whenever it
 * comes back to the foreground (several agents, step 3): a request there waits
 * on this phone as well. Never on a timer, and never in the background.
 *
 * @module trust-tasks/module/lookAtOtherAgents
 */
import type { Agent } from '@credo-ts/core'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { vtaAgent } from './vtaAgent'

export function useLookAtOtherAgents(agent: Agent | undefined): void {
  useEffect(() => {
    if (!agent) return
    void vtaAgent.lookAtOtherAgents(agent)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void vtaAgent.lookAtOtherAgents(agent)
    })
    return () => sub?.remove?.()
  }, [agent])
}
