import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react'
import { Agent, W3cCredentialRecord } from '@credo-ts/core'
import { useAgent } from '@credo-ts/react-hooks'

import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { getVrcNameForConnection } from '../utils/vrcNameHelper'
import { createVrcLogger } from '../vrc-logging'

/**
 * Cache for VRC names indexed by connection ID
 * This prevents redundant database lookups
 */
type VrcNameCache = Map<string, string | null>

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
  
  const [cache, setCache] = useState<VrcNameCache>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const logger = useMemo(() => createVrcLogger(null, { module: 'vrc', component: 'VrcNameCache' }), [])

  /**
   * Build a complete cache of all VRC names
   * This runs once when credentials change, not per-component
   */
  const buildCache = useCallback(async (
    agentInstance: Agent,
    credentials: W3cCredentialRecord[]
  ): Promise<VrcNameCache> => {
    const newCache = new Map<string, string | null>()

    try {
      // Get all relationship records once
      const repository = agentInstance.dependencyManager.resolve(RelationshipDidRepository)
      const allRelationshipRecords = await repository.getAll(agentInstance.context)

      // Build cache for each connection
      for (const relationshipRecord of allRelationshipRecords) {
        if (!relationshipRecord.connectionId || !relationshipRecord.counterpartyRelationshipDid) {
          continue
        }

        const connectionId = relationshipRecord.connectionId
        const _counterpartyDid = relationshipRecord.counterpartyRelationshipDid

        // Find matching VRC credential
        const vrcName = await getVrcNameForConnection(agentInstance, connectionId, credentials)
        newCache.set(connectionId, vrcName)
      }
    } catch (error) {
      logger.error('Failed to build cache:', error)
    }

    return newCache
  }, [])

  /**
   * Rebuild cache when credentials or agent changes
   */
  useEffect(() => {
    if (!agent) {
      setCache(new Map())
      setIsLoading(false)
      return
    }

    let isMounted = true

    const updateCache = async () => {
      setIsLoading(true)
      const newCache = await buildCache(agent, w3cCredentialRecords)
      
      if (isMounted) {
        setCache(newCache)
        setIsLoading(false)
      }
    }

    updateCache()

    return () => {
      isMounted = false
    }
  }, [agent, w3cCredentialRecords, buildCache])

  /**
   * Get VRC name from cache (synchronous, instant)
   */
  const getVrcName = useCallback((connectionId: string | undefined): string | null => {
    if (!connectionId) {
      return null
    }
    return cache.get(connectionId) ?? null
  }, [cache])

  const contextValue = useMemo(
    () => ({
      getVrcName,
      isLoading,
    }),
    [getVrcName, isLoading]
  )

  return (
    <VrcNameCacheContext.Provider value={contextValue}>
      {children}
    </VrcNameCacheContext.Provider>
  )
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
