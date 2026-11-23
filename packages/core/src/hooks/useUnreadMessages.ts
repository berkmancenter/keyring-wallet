import type { DidCommBasicMessageRecord } from '@credo-ts/didcomm'
import { useBasicMessages } from '@bifold/react-hooks'
import { useMemo } from 'react'

import { useAllChatEvents } from '../modules/chat/chatEventsStore'
import type { ChatEventRecord } from '../modules/chat/records/ChatEventRecord'
import { isUnreadChatEvent } from '../modules/chat/seen'
import { usePendingContinuityConnections } from '../modules/vrc/contacts/useContinuityPrompt'
import { BasicMessageMetadata, basicMessageCustomMetadata } from '../types/metadata'
import { isConnectionExcludedFromNotifications, useExclusionVersion } from './notifications'
import { isProtocolMessage } from '../utils/protocolMessage'

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
 * Whether a keyring/chat event counts as unread chat: a received message not yet seen, from a connection not left
 * out of notifications. The badge and a tapped message notification use this one rule, as for BasicMessages.
 */
export function isUnreadKeyringChatEvent(record: ChatEventRecord): boolean {
  return !isConnectionExcludedFromNotifications(record.connectionId) && isUnreadChatEvent(record)
}

/**
 * Returns a map of connectionId → unseen message count,
 * plus the total unseen count across all non-excluded connections.
 * A continuity question ("Is this you?") waiting in a chat counts as one
 * unread there until it is answered.
 */
export const useUnreadMessages = (): { unreadByConnection: Record<string, number>; totalUnread: number } => {
  const { records: basicMessages } = useBasicMessages()
  const exclusionVersion = useExclusionVersion()
  const continuityPending = usePendingContinuityConnections()
  // keyring/chat events: a received message counts until seen; a reaction, a redaction or a system line never does.
  const chatEvents = useAllChatEvents()

  return useMemo(() => {
    const unreadByConnection: Record<string, number> = {}
    let totalUnread = 0

    for (const msg of basicMessages) {
      if (isUnreadChatMessage(msg)) {
        unreadByConnection[msg.connectionId] = (unreadByConnection[msg.connectionId] ?? 0) + 1
        totalUnread++
      }
    }
    for (const [connectionId, events] of chatEvents ?? []) {
      const unread = events.filter(isUnreadKeyringChatEvent).length
      if (!unread) continue
      unreadByConnection[connectionId] = (unreadByConnection[connectionId] ?? 0) + unread
      totalUnread += unread
    }
    for (const connectionId of continuityPending) {
      if (isConnectionExcludedFromNotifications(connectionId)) continue
      unreadByConnection[connectionId] = (unreadByConnection[connectionId] ?? 0) + 1
      totalUnread++
    }

    return { unreadByConnection, totalUnread }
    // exclusionVersion intentionally triggers recomputation when the exclusion list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basicMessages, exclusionVersion, continuityPending, chatEvents])
}
