import { BasicMessageRecord, BasicMessageRole } from '@credo-ts/core'
import { useAgent } from '@credo-ts/react-hooks'
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
    const connection = await agent.connections.findById(connectionId)
    if (!connection) return 'Contact'

    // Priority 1: User-set alternate name
    const prefs = await PersistentStorage.fetchValueForKey<Preferences>(LocalStorageKeys.Preferences)
    if (prefs?.alternateContactNames?.[connectionId]) {
      return prefs.alternateContactNames[connectionId]
    }

    // Priority 2: VRC issuer name (real contact name after credential exchange)
    try {
      const w3cRecords = await agent.w3cCredentials.getAllCredentialRecords()
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
      const record = payload.basicMessageRecord as BasicMessageRecord
      if (record.role !== BasicMessageRole.Receiver) return
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

    agent.events.on('BasicMessageStateChanged' as any, handleMessage)

    return () => {
      agent.events.off('BasicMessageStateChanged' as any, handleMessage)
    }
  }, [agent, navigation])

  return null
}

export default InAppMessageNotifier
