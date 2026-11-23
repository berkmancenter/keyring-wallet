/**
 * Clear chat (rich-messaging-plan.md §4.6): every message, chat event and media file of one chat removed from this
 * phone, after the person confirms. The contact stays, and nothing is sent: the other person keeps their copy.
 * The chat's menu calls `clearChat(connectionId, name)`.
 *
 * @module chat/useClearChat
 */

import { useAgent } from '@bifold/react-hooks'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../components/toast/BaseToast'
import { deleteChatMessages } from './history'

export function useClearChat(): (connectionId: string, name: string, onCleared?: () => void) => void {
  const { agent } = useAgent()
  const { t } = useTranslation()

  return useCallback(
    (connectionId: string, name: string, onCleared?: () => void) => {
      if (!agent) return
      const clear = async () => {
        try {
          await deleteChatMessages(agent, connectionId)
          Toast.show({ type: ToastType.Success, text1: t('Chat.ClearChatDone') })
          onCleared?.()
        } catch (error) {
          agent.config.logger.warn(`[chat] Clear chat failed: ${String(error)}`)
          // Deletion is not atomic: what went before the failure is already gone, and the words say so.
          Toast.show({ type: ToastType.Error, text1: t('Chat.ClearChatFailed') })
        }
      }
      Alert.alert(t('Chat.ClearChatTitle'), t('Chat.ClearChatBody', { name }), [
        { text: t('Global.Cancel'), style: 'cancel' },
        { text: t('Chat.ClearChat'), style: 'destructive', onPress: () => void clear() },
      ])
    },
    [agent, t]
  )
}
