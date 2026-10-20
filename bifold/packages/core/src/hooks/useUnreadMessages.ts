import type { DidCommBasicMessageRecord } from '@credo-ts/didcomm'
import { useBasicMessages } from '@bifold/react-hooks'
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
 * Whether a basic message counts as unread chat: not from a connection left
 * out of notifications, not a protocol message carried as one, and not yet
 * seen. The one rule for the Messages badge and for which chat a tapped
 * message notification opens (utils/messageWake.ts), so the two never disagree.
 */
export function isUnreadChatMessage(msg: DidCommBasicMessageRecord): boolean {
  if (isConnectionExcludedFromNotifications(msg.connectionId)) return false
  if (isProtocolMessage(msg.content)) return false
  const meta = msg.metadata.get(BasicMessageMetadata.customMetadata) as basicMessageCustomMetadata
  return !meta?.seen
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
      if (isUnreadChatMessage(msg)) {
        unreadByConnection[msg.connectionId] = (unreadByConnection[msg.connectionId] ?? 0) + 1
        totalUnread++
      }
    }

    return { unreadByConnection, totalUnread }
    // exclusionVersion intentionally triggers recomputation when the exclusion list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basicMessages, exclusionVersion])
}
