import { DidCommBasicMessageEventTypes, DidCommBasicMessageRecord, DidCommBasicMessageRole } from '@credo-ts/didcomm'
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useEffect } from 'react'
import Toast from 'react-native-toast-message'

import { LocalStorageKeys } from '../constants'
import { isConnectionExcludedFromNotifications } from '../hooks/notifications'
import { getVrcNameForConnection } from '../modules/vrc/utils/vrcNameHelper'
import { PersistentStorage } from '../services/storage'
import { Preferences } from '../types/state'
import { getActiveChatConnectionId } from '../utils/activeChatTracker'
import { Screens, Stacks } from '../types/navigators'

const isVrcProtocolMessage = (content: string): boolean => {
  // Plain-text protocol traffic. The relationship-DID announcement
  // ("This is my relationship DID: vrc:relationshipDid:… vrc:rceVersion:N")
  // and the biometric-status ping are basic messages carrying protocol
  // payloads, not anything a user should be toasted about. The chat screen
  // already hides/transforms these (see chat-messages.tsx); this guard was
  // JSON-only, so the plain-text ones leaked into the notification as raw
  // protocol text (seen on device, 2026-08-26).
  if (content.includes('vrc:relationshipDid:') || content.startsWith('vrc:')) {
    return true
  }
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && parsed !== null && ('type' in parsed || '@type' in parsed)
  } catch {
    return false
  }
}

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

/**
 * Listens for incoming basic messages and shows an in-app toast
 * when the user is not currently viewing that conversation.
 */
const InAppMessageNotifier: React.FC = () => {
  const { agent } = useAgent()
  const navigation = useNavigation<any>()

  useEffect(() => {
    if (!agent) return

    const handleMessage = async ({ payload }: any) => {
      const record = payload.basicMessageRecord as DidCommBasicMessageRecord
      if (record.role !== DidCommBasicMessageRole.Receiver) return
      if (isVrcProtocolMessage(record.content)) return
      if (isConnectionExcludedFromNotifications(record.connectionId)) return
      if (getActiveChatConnectionId() === record.connectionId) return

      const senderName = await resolveContactName(agent, record.connectionId)

      const preview = record.content.length > 80
        ? record.content.substring(0, 80) + '…'
        : record.content

      Toast.show({
        type: 'message',
        text1: senderName,
        text2: preview,
        visibilityTime: 4000,
        topOffset: 0,
        props: {
          senderInitial: senderName.charAt(0).toUpperCase(),
        },
        onPress: () => {
          Toast.hide()
          navigation.navigate(Stacks.ContactStack, {
            screen: Screens.Chat,
            params: { connectionId: record.connectionId },
          })
        },
      })
    }

    agent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, handleMessage)

    return () => {
      agent.events.off(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, handleMessage)
    }
  }, [agent, navigation])

  return null
}

export default InAppMessageNotifier
