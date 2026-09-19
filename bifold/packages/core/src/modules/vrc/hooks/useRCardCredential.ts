import { useCallback, useEffect, useMemo } from 'react'
import { useAgent } from '@bifold/react-hooks'

import { DispatchAction } from '../../../contexts/reducers/store'
import { useStore } from '../../../contexts/store'
import {
  adoptLegacyRCardTemplate,
  deleteRCardTemplate,
  loadAllRCardTemplates,
  loadRCardTemplate,
  setActiveRCardProfile,
  storeRCardTemplate,
  updateRCardTemplate,
} from '../services/rCardCredential'
import { buildRCardTemplate, RCardFormInput, RCardTemplate, validateRCardForm } from '../types/rcard'
import { createVrcLogger } from '../vrc-logging'

export type RemoveProfileResult = { ok: true } | { ok: false; reason: 'LastProfile' | 'ActiveProfile' | 'NoAgent' }

export const useRCardCredential = () => {
  const [state, dispatch] = useStore()
  const { agent } = useAgent()

  // Create logger instance (works with or without agent)
  const logger = useMemo(
    () => createVrcLogger(agent || null, { module: 'vrc', component: 'useRCardCredential' }),
    [agent]
  )

  // Load every R-card profile from Credo when agent becomes available, adopting
  // a pre-multi-profile legacy record first if there is one. Also migrates any
  // profile staged in state (pre-agent) to Credo if nothing is there yet.
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
        await adoptLegacyRCardTemplate(agent)
        const fromCredo = await loadAllRCardTemplates(agent)

        if (fromCredo.profiles.length > 0) {
          dispatch({
            type: DispatchAction.R_CARD_PROFILES_LOADED,
            payload: [fromCredo.profiles, fromCredo.activeProfileId],
          })
          return
        }

        if (state.rCard.profiles.length > 0) {
          let allPersisted = true
          for (const template of state.rCard.profiles) {
            allPersisted = (await storeRCardTemplate(template, agent)) && allPersisted
          }

          if (allPersisted) {
            const migrated = await loadAllRCardTemplates(agent)
            dispatch({
              type: DispatchAction.R_CARD_PROFILES_LOADED,
              payload: [migrated.profiles, migrated.activeProfileId],
            })
          }
          // else: don't dispatch - leave lastSyncedAt unset so migration is retried next time
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
  }, [agent, state.rCard.profiles, state.rCard.lastSyncedAt, dispatch, logger])

  const refresh = useCallback(async (): Promise<RCardTemplate | undefined> => {
    if (!agent) {
      return undefined
    }
    const { profiles, activeProfileId } = await loadAllRCardTemplates(agent)
    if (profiles.length > 0) {
      dispatch({ type: DispatchAction.R_CARD_PROFILES_LOADED, payload: [profiles, activeProfileId] })
    }
    return profiles.find((p) => p.id === activeProfileId)
  }, [agent, dispatch])

  // Replaces one profile's jcard in place. Returns false, without touching
  // storage or dispatching, when there is no agent or the input fails
  // validation.
  const update = useCallback(
    async (profileId: string, input: RCardFormInput): Promise<boolean> => {
      if (!agent) {
        return false
      }

      if (!validateRCardForm(input).isValid) {
        return false
      }

      const persisted = await updateRCardTemplate(profileId, input, agent)
      if (!persisted) {
        return false
      }

      const updated = await loadRCardTemplate(agent, profileId)
      if (updated) {
        dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [updated] })
      }
      return true
    },
    [agent, dispatch]
  )

  // Adds a new profile. The first profile a wallet ever gets becomes active
  // automatically (storeRCardTemplate's own rule); a later one does not.
  const create = useCallback(
    async (input: RCardFormInput): Promise<RCardTemplate | undefined> => {
      if (!agent) {
        return undefined
      }

      if (!validateRCardForm(input).isValid) {
        return undefined
      }

      const template = buildRCardTemplate(input)
      const persisted = await storeRCardTemplate(template, agent)
      if (!persisted) {
        return undefined
      }

      dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [template] })
      return template
    },
    [agent, dispatch]
  )

  // Refuses to remove the last remaining profile, or the active one — a
  // replacement active profile must be chosen first (setActive), so a user is
  // never left with zero or an undefined active profile.
  const remove = useCallback(
    async (profileId: string): Promise<RemoveProfileResult> => {
      if (!agent) {
        return { ok: false, reason: 'NoAgent' }
      }
      if (state.rCard.profiles.length <= 1) {
        return { ok: false, reason: 'LastProfile' }
      }
      if (state.rCard.activeProfileId === profileId) {
        return { ok: false, reason: 'ActiveProfile' }
      }

      await deleteRCardTemplate(agent, profileId)
      dispatch({ type: DispatchAction.R_CARD_PROFILE_DELETED, payload: [profileId] })
      return { ok: true }
    },
    [agent, state.rCard.profiles, state.rCard.activeProfileId, dispatch]
  )

  const setActive = useCallback(
    async (profileId: string): Promise<boolean> => {
      if (!agent || !state.rCard.profiles.some((p) => p.id === profileId)) {
        return false
      }

      const persisted = await setActiveRCardProfile(agent, profileId)
      if (!persisted) {
        return false
      }

      dispatch({ type: DispatchAction.R_CARD_ACTIVE_PROFILE_SET, payload: [profileId] })
      return true
    },
    [agent, state.rCard.profiles, dispatch]
  )

  return {
    /** The active profile — the one offered when connecting. */
    template: state.rCard.profiles.find((p) => p.id === state.rCard.activeProfileId),
    profiles: state.rCard.profiles,
    activeProfileId: state.rCard.activeProfileId,
    lastSyncedAt: state.rCard.lastSyncedAt,
    refresh,
    update,
    create,
    remove,
    setActive,
  }
}

export default useRCardCredential
