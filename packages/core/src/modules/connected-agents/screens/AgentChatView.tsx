/**
 * The agent chat (plan §3.5, §6, §7.9; frames 27 and 28): a view from props, over fb-C4's `useAgentChat(agentId)`
 * (the route's container, `screens/agents/AgentChatScreen.tsx`, maps the hook to these props).
 *
 * - **The header** is the view's own: back, the robot, the name with "AI agent", and "Belongs to {owner}" (frame 27),
 *   left out when no owner's name is given. The navigator's header is hidden for this screen.
 * - **The bubbles** are plain, like a person's chat: only the header differs (§6). Mine on the right, the agent's on
 *   the left, each with its time.
 * - **The states** (frame 28), each with its own words, never a generic failure:
 *   - `notConnected`: "Not connected right now" under the header; the composer stays (the message waits for the agent);
 *   - `stopped` (20 with no reply): "Waiting for your session" above the composer, and the composer disabled;
 *   - `versionMismatch`: its line in place of the composer;
 *   - `waiting`: no line; the messages show.
 *
 * @module connected-agents/screens/AgentChatView
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import { AgentAvatar, AgentTag } from '../components/AgentMark'
import { AGENT_COLORS } from '../components/agentStyle'

/** One message as the view draws it: `at` is an ISO instant, formatted by `formatTime`. */
export interface AgentChatViewMessage {
  id: string
  mine: boolean
  text: string
  at: string
}

export type AgentChatViewState = 'connected' | 'waiting' | 'notConnected' | 'versionMismatch'

export interface AgentChatViewProps {
  name: string
  /** The persona the agent belongs to. With none, "Belongs to" is left out rather than drawn with no name. */
  ownerName?: string
  /** Oldest first. */
  messages: AgentChatViewMessage[]
  state: AgentChatViewState
  /** Stopped at 20 messages with no reply. */
  stopped: boolean
  onSend: (text: string) => void
  formatTime: (iso: string) => string
  /** The header's back arrow (the navigator's header is hidden for this screen). */
  onBack: () => void
}

const BUBBLE_MINE = AGENT_COLORS.primary
const BUBBLE_THEIRS = '#FFFFFF'
const BUBBLE_EDGE = '#D3CCD3'
const BACKGROUND = '#F4F4F4'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BACKGROUND },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: AGENT_COLORS.primary,
  },
  back: { padding: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: 'SourceSans3-Bold', fontSize: 20, color: '#FFFFFF' },
  owner: { fontSize: 15, color: '#FFFFFF' },
  tagOnDark: { backgroundColor: '#FFFFFF', borderRadius: 7 },
  unreachable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: AGENT_COLORS.warnBg,
    borderBottomWidth: 1,
    borderBottomColor: '#E8B64A',
  },
  unreachableText: { fontFamily: 'SourceSans3-Bold', fontSize: 16, color: AGENT_COLORS.warnText },
  list: { flexGrow: 1, justifyContent: 'flex-end', padding: 12, gap: 10 },
  bubbleRow: { gap: 2 },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  mine: { alignSelf: 'flex-end', backgroundColor: BUBBLE_MINE },
  theirs: { alignSelf: 'flex-start', backgroundColor: BUBBLE_THEIRS, borderWidth: 1, borderColor: BUBBLE_EDGE },
  mineText: { fontSize: 17, color: '#FFFFFF' },
  theirsText: { fontSize: 17, color: AGENT_COLORS.text },
  time: { fontSize: 12, color: AGENT_COLORS.muted },
  timeMine: { alignSelf: 'flex-end' },
  timeTheirs: { alignSelf: 'flex-start' },
  waiting: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: AGENT_COLORS.quietBg,
  },
  waitingText: { fontSize: 15, color: AGENT_COLORS.quietText },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: BUBBLE_EDGE,
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BUBBLE_EDGE,
    borderRadius: 20,
    fontSize: 17,
    color: AGENT_COLORS.text,
  },
  inputOff: { backgroundColor: BACKGROUND, color: AGENT_COLORS.disabled },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  versionMismatch: { padding: 16, borderTopWidth: 1, borderTopColor: BUBBLE_EDGE, backgroundColor: '#FFFFFF' },
  versionMismatchText: { fontSize: 15, color: AGENT_COLORS.text, textAlign: 'center' },
})

const AgentChatView: React.FC<AgentChatViewProps> = ({
  name,
  ownerName,
  messages,
  state,
  stopped,
  onSend,
  formatTime,
  onBack,
}) => {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  // Stopped at 20: nothing more is sent until the agent answers, so the composer takes nothing.
  const composerOff = stopped
  const canSend = !composerOff && text.trim().length > 0
  const send = () => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
  }

  return (
    <View style={styles.screen} testID={testIdWithKey('AgentChat')}>
      <View style={styles.header} testID={testIdWithKey('AgentChatHeader')}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('Global.Back')}
          testID={testIdWithKey('AgentChatBack')}
          hitSlop={8}
          style={styles.back}
        >
          <Icon name="arrow-left" size={26} color="#FFFFFF" />
        </Pressable>
        <AgentAvatar size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.name} accessibilityRole="header">
              {name}
            </ThemedText>
            <View style={styles.tagOnDark}>
              <AgentTag />
            </View>
          </View>
          {ownerName ? (
            <ThemedText style={styles.owner}>{t('ConnectedAgents.BelongsTo', { owner: ownerName })}</ThemedText>
          ) : null}
        </View>
      </View>

      {state === 'notConnected' ? (
        <View style={styles.unreachable} testID={testIdWithKey('AgentChatState')}>
          <Icon name="clock-outline" size={18} color={AGENT_COLORS.warnText} />
          <ThemedText style={styles.unreachableText}>{t('ConnectedAgents.StatusUnreachable')}</ThemedText>
        </View>
      ) : null}

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.bubbleRow}>
            <View
              style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}
              testID={testIdWithKey('AgentChatBubble')}
            >
              <ThemedText style={item.mine ? styles.mineText : styles.theirsText}>{item.text}</ThemedText>
            </View>
            <ThemedText style={[styles.time, item.mine ? styles.timeMine : styles.timeTheirs]}>
              {formatTime(item.at)}
            </ThemedText>
          </View>
        )}
        ListFooterComponent={
          stopped && state !== 'versionMismatch' ? (
            <View style={styles.waiting} testID={testIdWithKey('AgentChatState')}>
              <ThemedText style={styles.waitingText}>{t('ConnectedAgents.ChatWaiting')}</ThemedText>
            </View>
          ) : null
        }
      />

      {state === 'versionMismatch' ? (
        <View style={styles.versionMismatch} testID={testIdWithKey('AgentChatState')}>
          <ThemedText style={styles.versionMismatchText}>{t('ConnectedAgents.VersionMismatch')}</ThemedText>
        </View>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={[styles.input, composerOff && styles.inputOff]}
            value={text}
            onChangeText={setText}
            placeholder={t('Chat.MessagePlaceholder')}
            placeholderTextColor={AGENT_COLORS.disabled}
            editable={!composerOff}
            accessibilityLabel={t('Chat.MessagePlaceholder')}
            accessibilityState={{ disabled: composerOff }}
            testID={testIdWithKey('AgentChatInput')}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={t('Global.Send')}
            accessibilityState={{ disabled: !canSend }}
            testID={testIdWithKey('AgentChatSend')}
            style={[styles.send, { backgroundColor: canSend ? AGENT_COLORS.primary : AGENT_COLORS.quietBg }]}
          >
            <Icon name="arrow-up" size={22} color={canSend ? '#FFFFFF' : AGENT_COLORS.disabled} />
          </Pressable>
        </View>
      )}
    </View>
  )
}

export default AgentChatView
