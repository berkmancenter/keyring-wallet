import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useAgent } from '@bifold/react-hooks'

import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { contactFacts, knownName } from '../contacts/useContactFacts'
import { createVrcLogger } from '../vrc-logging'

interface VrcNameCacheContextValue {
  getVrcName: (connectionId: string | undefined) => string | null
  isLoading: boolean
}

const VrcNameCacheContext = createContext<VrcNameCacheContextValue | undefined>(undefined)

/**
 * Provider that maintains a centralized cache of VRC names for all connections.
 * This prevents each component from doing individual database lookups.
 *
 * The cache is automatically updated when:
 * - W3C credentials are added/removed
 * - The agent becomes available
 *
 * Benefits:
 * - Single database query for all connections (not per-component)
 * - Instant lookups from cache (no async delays)
 * - Automatic updates when VRC credentials change
 */
export const VrcNameCacheProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { agent } = useAgent()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()
  const logger = useMemo(() => createVrcLogger(null, { module: 'vrc', component: 'VrcNameCache' }), [])

  // One read of the relationship records, with the wallet's credentials, into the
  // contact facts every screen reads (contacts/useContactFacts). It read them once
  // per relationship, again for each.
  useEffect(() => {
    // No agent, nothing known: a later one never sees the last one's contacts.
    if (!agent) {
      contactFacts.forget()
      return
    }
    contactFacts.load(agent, w3cCredentialRecords).catch((error) => logger.error('Failed to build cache:', error))
  }, [agent, w3cCredentialRecords, logger])

  // The facts as they stand; `changes` moves whenever one of them does.
  const changes = useSyncExternalStore(contactFacts.subscribe, () => contactFacts.changes)

  /**
   * Get VRC name from cache (synchronous, instant). Null both before the first
   * read and when the contact has no name: `useConnectionFacts` tells them apart.
   * A new function whenever the facts move (`changes`), so a caller that
   * memoises on it reads again.
   */
  const getVrcName = useMemo(() => {
    const asOf = changes
    return (connectionId: string | undefined): string | null =>
      asOf >= 0 ? (knownName(contactFacts.connection(connectionId).name) ?? null) : null
  }, [changes])
  const isLoading = Boolean(agent) && !contactFacts.isLoaded

  const contextValue = useMemo(
    () => ({
      getVrcName,
      isLoading,
    }),
    [getVrcName, isLoading]
  )

  return <VrcNameCacheContext.Provider value={contextValue}>{children}</VrcNameCacheContext.Provider>
}

/**
 * Hook to access the VRC name cache
 * @throws Error if used outside of VrcNameCacheProvider
 */
export const useVrcNameCache = (): VrcNameCacheContextValue => {
  const context = useContext(VrcNameCacheContext)
  if (!context) {
    throw new Error('useVrcNameCache must be used within VrcNameCacheProvider')
  }
  return context
}
