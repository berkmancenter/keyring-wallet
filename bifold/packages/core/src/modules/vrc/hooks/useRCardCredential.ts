import { useCallback, useEffect, useMemo } from 'react'
import { useAgent } from '@credo-ts/react-hooks'

import { DispatchAction } from '../../../contexts/reducers/store'
import { useStore } from '../../../contexts/store'
import { loadRCardTemplate, storeRCardTemplate } from '../services/rCardCredential'
import { RCardTemplate } from '../types/rcard'
import { createVrcLogger } from '../vrc-logging'

export const useRCardCredential = () => {
  const [state, dispatch] = useStore()
  const { agent } = useAgent()

  // Create logger instance (works with or without agent)
  const logger = useMemo(
    () => createVrcLogger(agent || null, { module: 'vrc', component: 'useRCardCredential' }),
    [agent]
  )

  // Load R-card credential from Credo when agent becomes available
  // Also migrate any credential from state to Credo if it exists
  useEffect(() => {
    if (!agent) {
      return
    }

    // If we've already synced or cleared the R-card once for this wallet,
    // don't keep re-running the Credo sync on every agent startup / unlock.
    if (state.rCard.lastSyncedAt) {
      return
    }

    const syncRCard = async () => {
      try {
        // First, try to load template from Credo
        const credoTemplate = await loadRCardTemplate(agent)

        if (credoTemplate) {
          // Credo has the template, sync to state
          dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [credoTemplate] })
        } else if (state.rCard.template) {
          const persisted = await storeRCardTemplate(state.rCard.template, agent)

          if (persisted) {
            // Update state to mark as synced (sets lastSyncedAt)
            dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [state.rCard.template] })
          } else {
            // Don't dispatch - leave lastSyncedAt unset so migration is retried next time
          }
        }
      } catch (error) {
        logger.error('Error syncing R-card', {
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        })
      }
    }

    syncRCard()
  }, [agent, state.rCard.template, state.rCard.lastSyncedAt, dispatch, logger])

  const refresh = useCallback(async (): Promise<RCardTemplate | undefined> => {
    if (!agent) {
      return undefined
    }
    const template = await loadRCardTemplate(agent)
    if (template) {
      dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [template] })
    }
    return template
  }, [agent, dispatch])

  return {
    template: state.rCard.template,
    lastSyncedAt: state.rCard.lastSyncedAt,
    refresh,
  }
}

export default useRCardCredential
