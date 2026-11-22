import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView, TouchableOpacity } from 'react-native-gesture-handler'

import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'
import { ChatIds } from './Chat.ids'
import ReactionBar from './ReactionBar'

export interface MessageActionsProps {
  visible: boolean
  onClose: () => void
  /** Shown only for chat messages, which are the only ones that can be reacted to. */
  onReact?: (emoji: string) => void
  /** This phone's current reaction to the message. */
  selectedReaction?: string
  /** Opens the full emoji picker from the reaction bar. */
  onMoreReactions?: () => void
  onReply?: () => void
  onCopy?: () => void
  onDeleteForMe?: () => void
  /** A room's own message: new words. */
  onEdit?: () => void
  /** A room's own message: an empty version in its place. */
  onWithdraw?: () => void
  /** Why the sheet offers less than it might, said above its entries. */
  notice?: string
}

/** What a long press on a message offers. Each entry is shown only when its handler is given. */
const MessageActions: React.FC<MessageActionsProps> = ({
  visible,
  onClose,
  onReact,
  selectedReaction,
  onMoreReactions,
  onReply,
  onCopy,
  onDeleteForMe,
  onEdit,
  onWithdraw,
  notice,
}) => {
  const { t } = useTranslation()
  const entry = (label: string, testID: string, onPress: () => void, destructive = false) => (
    <TouchableOpacity
      onPress={onPress}
      style={styles.entry}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testIdWithKey(testID)}
    >
      <ThemedText style={[styles.entryText, destructive && styles.destructive]}>{label}</ThemedText>
    </TouchableOpacity>
  )

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/*
       * On Android a Modal is its own window, outside every gesture root above it: without this one, the
       * gesture-handler touchables here (the entries and the reaction bar) never get a tap.
       */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/*
         * The backdrop is a sibling behind the sheet, not its parent: an accessible Pressable is one element to iOS
         * accessibility, so every button inside it was unreachable to VoiceOver (and to the e2e driver).
         */}
        <View style={styles.layout}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('Global.Close')}
            testID={testIdWithKey(ChatIds.actionsBackdrop)}
          />
          <View style={styles.sheet} testID={testIdWithKey(ChatIds.actions)}>
            {onReact && <ReactionBar selected={selectedReaction} onReact={onReact} onMore={onMoreReactions} />}
            <View style={styles.entries}>
              {notice ? (
                <ThemedText style={styles.notice} testID={testIdWithKey(ChatIds.actionsNotice)}>
                  {notice}
                </ThemedText>
              ) : null}
              {onReply && entry(t('Chat.Reply'), ChatIds.reply, onReply)}
              {onCopy && entry(t('Chat.Copy'), ChatIds.copy, onCopy)}
              {onEdit && entry(t('Chat.Edit'), ChatIds.edit, onEdit)}
              {onWithdraw && entry(t('Chat.Withdraw'), ChatIds.withdraw, onWithdraw, true)}
              {onDeleteForMe && entry(t('Chat.DeleteForMe'), ChatIds.deleteForMe, onDeleteForMe, true)}
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  layout: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.35)', justifyContent: 'flex-end' },
  sheet: { padding: 16, paddingBottom: 32, gap: 12 },
  entries: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden' },
  entry: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 20 },
  entryText: { fontSize: 17, color: '#222222' },
  // The first line of the card, above its entries, and divided from them.
  notice: {
    fontSize: 15,
    lineHeight: 20,
    color: '#555555',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#D3D3D3',
  },
  destructive: { color: '#C62828' },
})

export default MessageActions
