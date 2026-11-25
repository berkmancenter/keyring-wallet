import { RepositoryEventTypes, type Agent, type BaseEvent } from '@credo-ts/core'
import { DidCommBasicMessageEventTypes, DidCommBasicMessageRecord, DidCommBasicMessageRole } from '@credo-ts/didcomm'
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from 'react-native-toast-message'

import { LocalStorageKeys } from '../constants'
import { isConnectionExcludedFromNotifications } from '../hooks/notifications'
import { getChatEventRepository } from '../modules/chat/ChatModule'
import { ChatEventRecord } from '../modules/chat/records/ChatEventRecord'
import { timerOf, type ChatTimer } from '../modules/chat/timer'
import { hidesText } from './chat/disappearing'
import { messageTextOf } from './chat/messageText'
import { getVrcNameForConnection } from '../modules/vrc/utils/vrcNameHelper'
import { PersistentStorage } from '../services/storage'
import { Preferences } from '../types/state'
import { getActiveChatConnectionId } from '../utils/activeChatTracker'
import { messageWakeHold } from '../utils/messageWake'
import { isProtocolMessage } from '../utils/protocolMessage'
import { Screens, Stacks } from '../types/navigators'

/**
 * Resolves the best display name for a connection following the same priority
 * as useConnectionDisplayName, but without requiring React hooks.
 */
const resolveContactName = async (agent: any, connectionId: string): Promise<string> => {
  try {
    const connection = await agent.modules.didcomm.connections.findById(connectionId)
    if (!connection) return 'Contact'

    // Priority 1: User-set alternate name
    const prefs = await PersistentStorage.fetchValueForKey<Preferences>(LocalStorageKeys.Preferences)
    if (prefs?.alternateContactNames?.[connectionId]) {
      return prefs.alternateContactNames[connectionId]
    }

    // Priority 2: VRC issuer name (real contact name after credential exchange)
    try {
      const w3cRecords = await agent.w3cCredentials.getAll()
      const vrcName = await getVrcNameForConnection(agent, connectionId, w3cRecords)
      if (vrcName) return vrcName
    } catch {
      // VRC lookup failed — continue to fallback
    }

    // Priority 3+: wallet label / alias
    return connection.theirLabel ?? connection.alias ?? 'Contact'
  } catch {
    return 'Contact'
  }
}

const cut = (text: string) => (text.length > 80 ? text.substring(0, 80) + '…' : text)

/**
 * Listens for incoming messages, plain BasicMessages and received keyring/chat messages, and shows an in-app toast
 * when the user is not looking at that conversation.
 *
 * A chat message's text is shown only when it is certain not to disappear (rich-messaging-plan.md §4.6): the
 * message carries no timer and its chat, read from storage now, has none on. Otherwise, and whenever that cannot be
 * read, the toast says only "New message", so no preview outlives the message. System notifications never carry
 * text at all (KEYRING_WAKE).
 */
const InAppMessageNotifier: React.FC = () => {
  const { agent } = useAgent()
  const navigation = useNavigation<any>()
  const { t } = useTranslation()

  useEffect(() => {
    if (!agent) return

    const handleMessage = async ({ payload }: any) => {
      const record = payload.basicMessageRecord as DidCommBasicMessageRecord
      if (record.role !== DidCommBasicMessageRole.Receiver) return
      if (isProtocolMessage(record.content)) return
      await notify(record.connectionId, async () => cut(record.content))
    }

    // A keyring/chat event is stored once, when it arrives (a duplicate is never saved): only a received message
    // toasts, never a reaction, a redaction, a timer change or what this phone sent.
    const handleChatEvent = async ({ payload }: BaseEvent) => {
      const record = (payload as { record?: ChatEventRecord }).record
      if (record?.type !== ChatEventRecord.type || record.role !== 'received' || record.eventType !== 'message') return
      await notify(record.connectionId, () => chatPreview(record))
    }

    const chatPreview = async (record: ChatEventRecord): Promise<string> => {
      // The chat's timer as stored now; unknown when it cannot be read, and then no text shows.
      let timer: ChatTimer | null | undefined
      try {
        const events = await getChatEventRepository(agent as unknown as Agent).findByConnection(
          agent.context,
          record.connectionId
        )
        timer = timerOf(events)
      } catch {
        timer = undefined
      }
      if (hidesText(timer, record.expiresIn)) return t('Chat.NewMessage')
      return cut(messageTextOf(record, { photo: t('Chat.Photo'), unsupported: t('Chat.UnsupportedAttachment') }))
    }

    const notify = async (connectionId: string, preview: () => Promise<string>) => {
      if (isConnectionExcludedFromNotifications(connectionId)) return
      if (getActiveChatConnectionId() === connectionId) return
      // A tapped message notification is being resolved: wait for it. If it
      // opens this message's chat, no toast; otherwise toast as usual.
      if (messageWakeHold.isHolding()) {
        messageWakeHold.after((opened) => {
          if (opened === connectionId || getActiveChatConnectionId() === connectionId) return
          void showToast(connectionId, preview)
        })
        return
      }
      await showToast(connectionId, preview)
    }

    const showToast = async (connectionId: string, preview: () => Promise<string>) => {
      const senderName = await resolveContactName(agent, connectionId)
      const text2 = await preview()

      Toast.show({
        type: 'message',
        text1: senderName,
        text2,
        visibilityTime: 4000,
        topOffset: 0,
        props: {
          senderInitial: senderName.charAt(0).toUpperCase(),
        },
        onPress: () => {
          Toast.hide()
          navigation.navigate(Stacks.ContactStack, {
            screen: Screens.Chat,
            params: { connectionId },
          })
        },
      })
    }

    agent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, handleMessage)
    agent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged, handleMessage)
    agent.events.on(RepositoryEventTypes.RecordSaved, handleChatEvent)

    return () => {
      agent.events.off(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, handleMessage)
      agent.events.off(DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged, handleMessage)
      agent.events.off(RepositoryEventTypes.RecordSaved, handleChatEvent)
    }
  }, [agent, navigation, t])

  return null
}

export default InAppMessageNotifier
