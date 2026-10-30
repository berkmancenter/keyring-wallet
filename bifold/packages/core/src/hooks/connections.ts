import { DidCommConnectionRecord, DidCommOutOfBandRecord } from '@credo-ts/didcomm'
import { useAgent, useConnectionById, useConnections } from '@bifold/react-hooks'
import { useMemo, useState } from 'react'

import { useStore } from '../contexts/store'
import { getConnectionName } from '../utils/helpers'
import { useVrcNameCache } from '../modules/vrc/context/VrcNameCacheProvider'

export const useOutOfBandById = (oobId: string): DidCommOutOfBandRecord | undefined => {
  const { agent } = useAgent()
  const [oob, setOob] = useState<DidCommOutOfBandRecord | undefined>(undefined)
  if (!oob) {
    agent?.modules.didcomm.oob.findById(oobId).then((res: DidCommOutOfBandRecord | null) => {
      if (res) {
        setOob(res)
      }
    })
  }
  return oob
}

export const useConnectionByOutOfBandId = (outOfBandId: string): DidCommConnectionRecord | undefined => {
  const reuseConnectionId = useOutOfBandById(outOfBandId)?.reuseConnectionId
  const { records: connections } = useConnections()

  return useMemo(
    () =>
      connections.find(
        (connection: DidCommConnectionRecord) =>
          connection.outOfBandId === outOfBandId ||
          // Check for a reusable connection
          (reuseConnectionId && connection.id === reuseConnectionId)
      ),
    [connections, outOfBandId, reuseConnectionId]
  )
}

export const useOutOfBandByConnectionId = (connectionId: string): DidCommOutOfBandRecord | undefined => {
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
/**
 * A connection's name as the app shows it: the name the person gave it; else the name on the contact's card (the
 * VRC issuer's, cached); else the connection's own label (getConnectionName). One rule for every place a name is
 * shown or searched.
 */
export function connectionDisplayName(
  connection: DidCommConnectionRecord | undefined,
  alternateContactNames: Record<string, string>,
  vrcName: string | null | undefined
): string {
  if (connection?.id && alternateContactNames[connection.id]) return alternateContactNames[connection.id]
  if (vrcName) return vrcName
  return getConnectionName(connection, alternateContactNames)
}

export const useConnectionDisplayName = (connectionId: string | undefined): string => {
  const connection = useConnectionById(connectionId ?? '')
  const [store] = useStore()
  const { getVrcName } = useVrcNameCache()

  // Memoize the final display name with proper priority
  return useMemo(
    () => connectionDisplayName(connection, store.preferences.alternateContactNames, getVrcName(connectionId)),
    [connection, connectionId, getVrcName, store.preferences.alternateContactNames]
  )
}
