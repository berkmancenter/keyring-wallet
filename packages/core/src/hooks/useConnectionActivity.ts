import { useBasicMessages } from '@bifold/react-hooks'
import { useCallback, useMemo } from 'react'

import { useAllChatEvents } from '../modules/chat/chatEventsStore'

/**
 * Each connection's newest activity, in ms: its newest message of either kind (a BasicMessage, or a keyring/chat
 * message), else when the connection was made. Only messages: a reaction or a timer change is no reason to open that
 * chat over another. One rule for the Messages row and a contact's Message action, so the two open the same chat
 * (vrc/contacts/messageRows' connectionToOpen).
 */
export function useConnectionActivity(): (connectionId: string, createdAt?: Date | string) => number {
  const { records: basicMessages } = useBasicMessages()
  const chatEvents = useAllChatEvents()
  const newest = useMemo(() => {
    const times = new Map<string, number>()
    const note = (connectionId: string, at: Date | string | undefined) => {
      const time = at ? new Date(at).getTime() : NaN
      if (!Number.isNaN(time) && time > (times.get(connectionId) ?? -Infinity)) times.set(connectionId, time)
    }
    for (const message of basicMessages) note(message.connectionId, message.createdAt)
    for (const [connectionId, events] of chatEvents ?? [])
      for (const event of events) if (event.eventType === 'message') note(connectionId, event.sentTime)
    return times
  }, [basicMessages, chatEvents])
  return useCallback(
    (connectionId: string, createdAt?: Date | string) =>
      Math.max(newest.get(connectionId) ?? -Infinity, createdAt ? new Date(createdAt).getTime() : -Infinity),
    [newest]
  )
}
