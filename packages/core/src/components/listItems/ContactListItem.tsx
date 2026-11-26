import { useAgent } from '@bifold/react-hooks'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../contexts/theme'
import { useChatMessagesByConnection } from '../../hooks/chat-messages'
import { useConnectionDisplayName } from '../../hooks/connections'
import { useUnreadMessages } from '../../hooks/useUnreadMessages'
import { ContactStackParams, Screens, Stacks } from '../../types/navigators'
import { useDateWords, useUses24HourClock } from '../../utils/localDay'
import { testIdWithKey } from '../../utils/testable'
import { TOKENS, useServices } from '../../container-api'
import ContactPhoto from '../../modules/vrc/components/ContactPhoto'
import { useConnectionFacts } from '../../modules/vrc/contacts/useContactFacts'
import { useChatEvents } from '../../modules/chat/chatEventsStore'
import { deleteChatMessages } from '../../modules/chat/history'
import { UNDO_WINDOW_MS, cancelChatDelete, scheduleChatDelete } from '../../modules/chat/pendingChatDeletes'
import { timerOf } from '../../modules/chat/timer'
import { ThemedText } from '../texts/ThemedText'
import { ToastType } from '../toast/BaseToast'

import DeleteChatSheet from './DeleteChatSheet'
import { rowPreview, rowTime } from './messagesListRow'
import SwipeRow from './SwipeRow'

export interface ContactListItemProps {
  /**
   * The connection the row shows and opens; its preview and time are this connection's (for a merged contact, the
   * one holding unread messages, else the newest: messageRows' connectionToOpen).
   */
  contact: DidCommConnectionRecord
  /**
   * Every connection of the contact the row stands for (a merged contact has one per exchange), `contact`'s among
   * them: the unread count is summed over them. Absent, the row is `contact` alone.
   */
  connectionIds?: string[]
  navigation: StackNavigationProp<ContactStackParams, Screens.Contacts>
}

const AVATAR_SIZE = 44
const NAME_COLOR = '#010B13'
const PREVIEW_COLOR = '#666666'
const DIVIDER = '#E3DEE3'

/**
 * A Messages row (the Messages list redesign, L2): a 44 pt photo or initials on a muted tone; the name, with a timer
 * when the chat's messages disappear; the time as the chat says it; one line of the newest thing said (messagesListRow);
 * and, while unread, the name and line in bold, the time in the brand colour and a count.
 */
const ContactListItem: React.FC<ContactListItemProps> = ({ contact, connectionIds, navigation }) => {
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const words = useDateWords()
  const use24h = useUses24HourClock()
  const messages = useChatMessagesByConnection(contact)
  // The newest thing said, never a line about the chat itself (a timer set).
  const message = messages.find((m) => m.kind !== 'system')
  // A chat holding only the line about the connection being made has nothing said in it yet.
  const hasOnlyInitialMessage = messages.length < 2
  const chatEvents = useChatEvents(contact.id)
  const timer = useMemo(() => (chatEvents ? timerOf(chatEvents) : undefined), [chatEvents])
  const [{ enableChat }] = useServices([TOKENS.CONFIG])
  const { unreadByConnection } = useUnreadMessages()
  const unreadCount = (connectionIds ?? [contact.id]).reduce((sum, id) => sum + (unreadByConnection[id] ?? 0), 0)
  const unread = unreadCount > 0

  const contactLabel = useConnectionDisplayName(contact.id)
  // Their photo from their contact card, as on Contacts; else the connection's own image; else their initials.
  const facts = useConnectionFacts(contact.id)

  const preview = useMemo(
    () =>
      rowPreview({
        message: hasOnlyInitialMessage ? undefined : message,
        events: chatEvents ?? undefined,
        timer,
        labels: { photo: t('Chat.Photo'), unsupported: t('Chat.UnsupportedAttachment') },
      }),
    [hasOnlyInitialMessage, message, chatEvents, timer, t]
  )
  const asWritten = { interpolation: { escapeValue: false } }
  const firstName = contactLabel.trim().split(/\s+/)[0] ?? contactLabel
  const line = (() => {
    switch (preview.kind) {
      case 'none':
        return ''
      case 'hidden':
        return t('Chat.PreviewHidden')
      case 'reaction': {
        const values = { name: firstName, emoji: preview.emoji, text: preview.quoted, ...asWritten }
        if (preview.mine) return t(preview.quoted ? 'MessagesList.YouReactedTo' : 'MessagesList.YouReacted', values)
        return t(preview.quoted ? 'MessagesList.ReactedTo' : 'MessagesList.Reacted', values)
      }
      case 'message': {
        const text = preview.photo ? `📷 ${preview.text}` : preview.text
        return preview.mine ? t('MessagesList.You', { text, ...asWritten }) : text
      }
    }
  })()
  const at = preview.kind === 'reaction' ? preview.at : preview.kind === 'none' ? undefined : message?.createdAt
  const when = at ? rowTime(at, words, use24h) : ''
  const timerOn = (timer?.expiresIn ?? 0) > 0

  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    middle: { flex: 1, minWidth: 0, gap: 2 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nameWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
    name: { flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: unread ? '700' : '600', color: NAME_COLOR },
    when: {
      fontSize: 13,
      lineHeight: 18,
      color: unread ? ColorPalette.brand.primary : PREVIEW_COLOR,
      fontWeight: unread ? '600' : '400',
    },
    bottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    preview: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      lineHeight: 20,
      color: unread ? NAME_COLOR : PREVIEW_COLOR,
      fontWeight: unread ? '600' : '400',
    },
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: ColorPalette.brand.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: '700' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: DIVIDER, marginLeft: 16 + AVATAR_SIZE + 12 },
  })

  // Delete (L4): a swipe, a long press or a screen reader's action, then the question, then the row goes at once and
  // the chat is deleted when the Undo window ends (pendingChatDeletes), even if the person has left the list.
  const { agent } = useAgent()
  const [confirming, setConfirming] = useState(false)
  const ids = useMemo(() => connectionIds ?? [contact.id], [connectionIds, contact.id])
  const askToDelete = useCallback(() => setConfirming(true), [])
  const deleteChat = useCallback(() => {
    setConfirming(false)
    if (!agent) return
    const key = ids.join(',')
    const scheduled = scheduleChatDelete({
      key,
      connectionIds: ids,
      // No ids: the whole chat, its draft included (#612).
      deleteChat: (connectionId) => deleteChatMessages(agent, connectionId),
      onFailed: (error) => {
        agent.config.logger.warn(`[chat] Delete from the Messages list failed: ${String(error)}`)
        Toast.show({ type: ToastType.Error, text1: t('Chat.ClearChatFailed') })
      },
    })
    if (!scheduled) return
    Toast.show({
      type: 'undo',
      text1: t('MessagesList.Deleted', { name: contactLabel, interpolation: { escapeValue: false } }),
      visibilityTime: UNDO_WINDOW_MS,
      props: { onUndo: () => cancelChatDelete(key) },
    })
  }, [agent, ids, t, contactLabel])

  const navigateToContact = useCallback(() => {
    navigation.getParent()?.navigate(Stacks.ContactStack, {
      screen: enableChat ? Screens.Chat : Screens.ContactDetails,
      params: { connectionId: contact.id },
    })
  }, [navigation, contact, enableChat])

  // One sentence for a screen reader: who, what was said, when, and how many are unread.
  const label = [
    t('MessagesList.RowLabel', { name: contactLabel, preview: line, when, ...asWritten }),
    timerOn ? t('MessagesList.TimerOn') : '',
    unread ? t('MessagesList.Unread', { count: unreadCount }) : '',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      <SwipeRow
        action={{
          name: 'delete',
          label: t('MessagesList.Delete'),
          icon: 'trash-can-outline',
          tone: 'destructive',
          onPress: askToDelete,
          testID: testIdWithKey('MessagesListDelete'),
        }}
      >
        {(touch) => (
          <TouchableOpacity
            onPress={navigateToContact}
            testID={testIdWithKey('Contact')}
            accessibilityLabel={label}
            accessibilityRole="button"
            {...touch}
          >
            <View style={styles.row}>
              <ContactPhoto
                photo={facts.photo}
                name={contactLabel}
                fallbackUrl={contact.imageUrl}
                size={AVATAR_SIZE}
                initials={2}
                muted
              />
              <View style={styles.middle}>
                <View style={styles.top}>
                  <View style={styles.nameWrap}>
                    <ThemedText style={styles.name} numberOfLines={1}>
                      {contactLabel}
                    </ThemedText>
                    {timerOn ? (
                      <Icon
                        name="timer-outline"
                        size={14}
                        color={PREVIEW_COLOR}
                        testID={testIdWithKey('MessagesListTimer')}
                      />
                    ) : null}
                  </View>
                  {when ? <ThemedText style={styles.when}>{when}</ThemedText> : null}
                </View>
                <View style={styles.bottom}>
                  <ThemedText style={styles.preview} numberOfLines={1} ellipsizeMode="tail">
                    {line}
                  </ThemedText>
                  {unread ? (
                    <View style={styles.badge} testID={testIdWithKey('MessagesListUnread')}>
                      <ThemedText style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            <View style={styles.divider} />
          </TouchableOpacity>
        )}
      </SwipeRow>
      <DeleteChatSheet
        visible={confirming}
        name={contactLabel}
        onDelete={deleteChat}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

export default ContactListItem
