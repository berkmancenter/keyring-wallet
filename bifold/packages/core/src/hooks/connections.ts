import { ConnectionRecord, OutOfBandRecord } from '@credo-ts/core'
import { useAgent, useConnectionById, useConnections } from '@credo-ts/react-hooks'
import { useMemo, useState } from 'react'

import { useStore } from '../contexts/store'
import { getConnectionName } from '../utils/helpers'
import { useVrcNameCache } from '../modules/vrc/context/VrcNameCacheProvider'

export const useOutOfBandById = (oobId: string): OutOfBandRecord | undefined => {
  const { agent } = useAgent()
  const [oob, setOob] = useState<OutOfBandRecord | undefined>(undefined)
  if (!oob) {
    agent?.oob.findById(oobId).then((res) => {
      if (res) {
        setOob(res)
      }
    })
  }
  return oob
}

export const useConnectionByOutOfBandId = (outOfBandId: string): ConnectionRecord | undefined => {
  const reuseConnectionId = useOutOfBandById(outOfBandId)?.reuseConnectionId
  const { records: connections } = useConnections()

  return useMemo(
    () =>
      connections.find(
        (connection: ConnectionRecord) =>
          connection.outOfBandId === outOfBandId ||
          // Check for a reusable connection
          (reuseConnectionId && connection.id === reuseConnectionId)
      ),
    [connections, outOfBandId, reuseConnectionId]
  )
}

export const useOutOfBandByConnectionId = (connectionId: string): OutOfBandRecord | undefined => {
  const connection = useConnectionById(connectionId)
  return useOutOfBandById(connection?.outOfBandId ?? '')
}

/**
 * Custom hook to get the display name for a connection with proper priority:
 * 1. User-set alternate name (highest priority)
 * 2. VRC issuer name (from Verifiable Relationship Credential)
 * 3. connection.theirLabel
 * 4. connection.alias
 * 5. connection.id (fallback)
 * 
 * This hook automatically updates when VRC credentials are received or when
 * the user changes the alternate contact name.
 * 
 * Performance optimized:
 * - Uses centralized VRC name cache (no per-component database lookups)
 * - Synchronous cache lookup (no async delays or loading states)
 * - Single source of truth updated when credentials change
 * 
 * @param connectionId - The connection ID to get the display name for
 * @returns The display name for the connection
 */
export const useConnectionDisplayName = (connectionId: string | undefined): string => {
  const connection = useConnectionById(connectionId ?? '')
  const [store] = useStore()
  const { getVrcName } = useVrcNameCache()

  // Memoize the final display name with proper priority
  return useMemo(() => {
    const alternateContactNames = store.preferences.alternateContactNames

    // Priority 1: User-set alternate name
    if (connection?.id && alternateContactNames[connection.id]) {
      return alternateContactNames[connection.id]
    }

    // Priority 2: VRC issuer name (synchronous cache lookup)
    const vrcName = getVrcName(connectionId)
    if (vrcName) {
      return vrcName
    }

    // Priority 3-5: Fall back to standard getConnectionName logic
    return getConnectionName(connection, alternateContactNames)
  }, [connection, connectionId, getVrcName, store.preferences.alternateContactNames])
}
