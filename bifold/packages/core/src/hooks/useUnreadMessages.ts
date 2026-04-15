import { useBasicMessages } from '@credo-ts/react-hooks'
import { useMemo } from 'react'

import { BasicMessageMetadata, basicMessageCustomMetadata } from '../types/metadata'
import { isConnectionExcludedFromNotifications, useExclusionVersion } from './notifications'

function isProtocolMessage(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && parsed !== null && ('type' in parsed || '@type' in parsed)
  } catch {
    return false
  }
}

/**
 * Returns a map of connectionId → unseen message count,
 * plus the total unseen count across all non-excluded connections.
 */
export const useUnreadMessages = (): { unreadByConnection: Record<string, number>; totalUnread: number } => {
  const { records: basicMessages } = useBasicMessages()
  const exclusionVersion = useExclusionVersion()

  return useMemo(() => {
    const unreadByConnection: Record<string, number> = {}
    let totalUnread = 0

    for (const msg of basicMessages) {
      if (isConnectionExcludedFromNotifications(msg.connectionId)) continue
      if (isProtocolMessage(msg.content)) continue

      const meta = msg.metadata.get(BasicMessageMetadata.customMetadata) as basicMessageCustomMetadata
      if (!meta?.seen) {
        unreadByConnection[msg.connectionId] = (unreadByConnection[msg.connectionId] ?? 0) + 1
        totalUnread++
      }
    }

    return { unreadByConnection, totalUnread }
  }, [basicMessages, exclusionVersion])
}
