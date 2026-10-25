import { DidCommBasicMessageRepository, DidCommConnectionRecord } from '@credo-ts/didcomm'
import { useAgent, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { useIsFocused, useNavigation } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import { StackNavigationProp, StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GiftedChat, IMessage, MessageProps, ReplyMessage } from 'react-native-gifted-chat'
import Clipboard from '@react-native-clipboard/clipboard'
import Toast from 'react-native-toast-message'
import { SafeAreaView } from 'react-native-safe-area-context'

import InfoIcon from '../modules/vrc/components/InfoIcon'
// Temporarily removed for cleaner witness chat UI
// import { WitnessChatBanner } from '../modules/vrc/components/WitnessChatBanner'
import { renderComposer, renderInputToolbar, renderSend } from '../components/chat'
import ActionSlider from '../components/chat/ActionSlider'
import MessageActions from '../components/chat/MessageActions'
import { useComposerText } from '../components/chat/useComposerText'
import { ToastType } from '../components/toast/BaseToast'
import { deleteChatMessages } from '../modules/chat/history'
import { removeReaction, sendChatText, sendReaction } from '../modules/chat/send'
import type { ChatSendOutcome } from '../modules/chat/send'
import { chatEventsShown } from '../modules/chat/shown'
import { renderActions } from '../components/chat/ChatActions'
import { ChatMessage, ExtendedChatMessage } from '../components/chat/ChatMessage'
import { useNetwork } from '../contexts/network'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { useChatMessagesByConnection, useVrcFlowInProgress, PROGRESS_MILESTONES } from '../hooks/chat-messages'
import { useConnectionDisplayName } from '../hooks/connections'
import ContinuityRequestCard from '../modules/vrc/components/ContinuityRequestCard'
import { useWitnessConnection } from '../modules/vrc/context/WitnessConnectionProvider'
import { Role } from '../types/chat'
import { markChatEventsSeen } from '../modules/chat/seen'
import { BasicMessageMetadata, basicMessageCustomMetadata } from '../types/metadata'
import { setActiveChatConnectionId } from '../utils/activeChatTracker'
import { sendCapabilityNoticeIfNeeded } from '../modules/chat/notice'
import { registerOtaApplyBlocker } from '../utils/otaApply'
import { RootStackParams, ContactStackParams, Screens, Stacks, TabStacks } from '../types/navigators'
import { Alert, Animated, Easing, View, StyleSheet, Text, TouchableOpacity, ViewToken } from 'react-native'

const PROGRESS_BAR_WIDTH = 200

const FlowProgressBar: React.FC<{ fraction: number; color: string; complete?: boolean }> = ({
  fraction,
  color,
  complete,
}) => {
  const progress = useRef(new Animated.Value(0)).current

  // Milestone-driven with creep: snap toward the flow's actual milestone,
  // then drift toward (never past) the next rung — the waits between
  // milestones are real multi-second protocol round trips, and a frozen bar
  // reads as a hang. The creep runs long (60s, longer than any normal phase)
  // with an ease-out curve, so motion is clearly visible early and only
  // asymptotically slows — the bar never sits dead still mid-phase.
  // Monotonic: the creep stops short of the next milestone, so the next real
  // advance always lands ahead of the drift.
  useEffect(() => {
    const next = PROGRESS_MILESTONES.find((m) => m > fraction) ?? 1
    const creepTarget = fraction + (next - fraction) * 0.9
    const animation = Animated.sequence([
      Animated.timing(progress, {
        toValue: fraction,
        duration: 600,
        useNativeDriver: false,
      }),
      Animated.timing(progress, {
        toValue: creepTarget,
        duration: 60000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ])
    animation.start()
    return () => animation.stop()
  }, [fraction, progress])

  useEffect(() => {
    if (complete) {
      Animated.timing(progress, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }).start()
    }
  }, [complete, progress])

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, PROGRESS_BAR_WIDTH],
  })

  return (
    <View style={progressStyles.track}>
      <Animated.View style={[progressStyles.fill, { width, backgroundColor: color }]} />
    </View>
  )
}

const progressStyles = StyleSheet.create({
  track: {
    width: PROGRESS_BAR_WIDTH,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginTop: 14,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
})

type ChatProps = StackScreenProps<ContactStackParams, Screens.Chat> | StackScreenProps<RootStackParams, Screens.Chat>

const Chat: React.FC<ChatProps> = ({ route }) => {
  if (!route?.params) {
    throw new Error('Chat route params were not set properly')
  }

  const { connectionId } = route.params
  const [store] = useStore()
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<RootStackParams | ContactStackParams>>()
  const connection = useConnectionById(connectionId) as DidCommConnectionRecord
  const basicMessages = useBasicMessagesByConnectionId(connectionId)
  const chatMessages = useChatMessagesByConnection(connection)
  const _isFocused = useIsFocused()
  const { assertNetworkConnected, silentAssertConnectedNetwork } = useNetwork()
  const [showActionSlider, setShowActionSlider] = useState(false)
  const { ChatTheme: theme, Assets, ColorPalette } = useTheme()
  const theirLabel = useConnectionDisplayName(connectionId)
  const headerHeight = useHeaderHeight()
  const { connectedWitness } = useWitnessConnection()

  // Track VRC flow in progress to show loading overlay during exchanges
  const {
    inProgress: vrcFlowInProgress,
    statusText: vrcStatusText,
    timedOut: vrcTimedOut,
    waitingOnPeer: vrcWaitingOnPeer,
    progressFraction,
    progressComplete,
    confirmed: vrcConfirmed,
    onDismissTimeout,
    onDismissConfirmation,
    onDismissWaiting,
  } = useVrcFlowInProgress(connectionId)

  // Check if this connection is a witness connection by matching connectionId
  const _isWitnessConnection = connectedWitness?.connectionId === connectionId

  useEffect(() => {
    assertNetworkConnected()
  }, [assertNetworkConnected])

  useEffect(() => {
    setActiveChatConnectionId(connectionId)
    return () => setActiveChatConnectionId(undefined)
  }, [connectionId])

  // Opening a chat is when a contact made before chat learns that this phone
  // speaks it (plan §4.5). Best effort: a failed notice is retried next time.
  useEffect(() => {
    if (!agent) return
    sendCapabilityNoticeIfNeeded(agent, connectionId).catch((error) => {
      agent.config?.logger?.warn(`[Chat] capability notice for ${connectionId} not sent`, { error })
    })
  }, [agent, connectionId])

  // An unsent draft lives only in gifted-chat's own state, so applying an
  // over-the-air update (a reload) would lose it. Watch the text, without
  // controlling it (a controlled composer is what broke typing on 2026-08-26),
  // and block applying while there is any. gifted-chat reports '' after a send.
  // `composer.insert` puts text at the caret (the emoji button).
  const composer = useComposerText()
  const { hasDraft } = composer
  useEffect(() => {
    if (!hasDraft) return
    return registerOtaApplyBlocker('chat-draft')
  }, [hasDraft])

  // The message being replied to, shown above the composer until sent or dismissed. A reload would lose it too.
  const [replyTarget, setReplyTarget] = useState<ReplyMessage | null>(null)
  useEffect(() => {
    if (!replyTarget) return
    return registerOtaApplyBlocker('chat-reply')
  }, [replyTarget])

  // The message a long press opened the actions for.
  const [actionTarget, setActionTarget] = useState<ExtendedChatMessage | null>(null)
  const closeActions = useCallback(() => setActionTarget(null), [])

  // Received chat messages as they scroll into view, each reported once while this chat is open (plan §4.6, D4).
  // FlatList takes onViewableItemsChanged once, so it reads the current chat through a ref.
  const shownRef = useRef({ connectionId, agent, ids: new Set<string>() })
  if (shownRef.current.connectionId !== connectionId) {
    shownRef.current = { connectionId, agent, ids: new Set<string>() }
  }
  shownRef.current.agent = agent
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const current = shownRef.current
    const fresh: string[] = []
    for (const token of viewableItems) {
      const item = token.item as ExtendedChatMessage | undefined
      if (!item?.chatEventId || item.kind === 'system' || item.user?._id !== Role.them) continue
      if (current.ids.has(item.chatEventId)) continue
      current.ids.add(item.chatEventId)
      fresh.push(item.chatEventId)
    }
    if (fresh.length > 0 && current.agent) {
      // Marked before the call so a scroll during it does not report twice; un-marked if it fails, so the next
      // scroll retries instead of leaving a disappearing message's clock unstarted until the chat is reopened.
      void chatEventsShown(current.agent, current.connectionId, fresh).catch(() => {
        for (const eventId of fresh) current.ids.delete(eventId)
      })
    }
  }).current

  useEffect(() => {
    navigation.setOptions({
      title: theirLabel,
      headerRight: () => <InfoIcon connectionId={connection?.id as string} />,
    })
  }, [navigation, theirLabel, connection])

  // when chat is open, mark messages as seen
  useEffect(() => {
    basicMessages.forEach((msg) => {
      const meta = msg.metadata.get(BasicMessageMetadata.customMetadata) as basicMessageCustomMetadata
      if (agent && !meta?.seen) {
        msg.metadata.set(BasicMessageMetadata.customMetadata, { ...meta, seen: true })
        const basicMessageRepository: DidCommBasicMessageRepository =
          agent.context.dependencyManager.resolve(DidCommBasicMessageRepository)
        basicMessageRepository.update(agent.context, msg)
      }
    })
    // keyring/chat events too, again whenever the timeline changes (one may have just arrived): only the unseen
    // are written, so this is free once they are.
    if (agent && connectionId) void markChatEventsSeen(agent, connectionId).catch(() => undefined)
  }, [basicMessages, chatMessages, agent, connectionId])

  // A chat event to a contact that speaks chat, a plain BasicMessage otherwise (sendChatText decides). gifted-chat
  // attaches the reply target it was showing, and clears it after this.
  const onSend = useCallback(
    async (messages: IMessage[]) => {
      if (!agent) return
      const inReplyTo = messages[0].replyMessage?._id
      await sendChatText(
        agent,
        connectionId,
        messages[0].text,
        typeof inReplyTo === 'string' && inReplyTo ? { inReplyTo } : {}
      )
    },
    [agent, connectionId]
  )

  const onLongPressMessage = useCallback((_context: unknown, message: ExtendedChatMessage) => {
    // Only text: chat messages and plain BasicMessages. Cards and system lines have no actions.
    if (message.kind === 'system' || (!message.chatEventId && !message.basicMessageId)) return
    setActionTarget(message)
  }, [])

  const notSentNotice = useCallback(
    (outcome: ChatSendOutcome) => {
      if (outcome.carriedAs !== 'not-sent') return
      // A contact's name is shown as typed: i18next would otherwise turn "A/B" into "A&#x2F;B".
      Toast.show({
        type: ToastType.Info,
        text1: t('Chat.ReactionNeedsUpdate', { name: theirLabel, interpolation: { escapeValue: false } }),
      })
    },
    [t, theirLabel]
  )

  const onReact = useCallback(
    async (emoji: string) => {
      const target = actionTarget
      closeActions()
      if (!agent || !target?.chatEventId) return
      // Choosing the reaction this phone already gave removes it; anything else replaces it.
      const mine = target.reactions?.find((reaction) => reaction.author === 'sent')
      try {
        const outcome =
          mine?.emoji === emoji
            ? await removeReaction(agent, connectionId, mine.eventId)
            : await sendReaction(agent, connectionId, target.chatEventId, emoji)
        notSentNotice(outcome)
      } catch {
        Toast.show({ type: ToastType.Error, text1: t('Chat.ReactionNotSent') })
      }
    },
    [actionTarget, agent, closeActions, connectionId, notSentNotice, t]
  )

  const onReply = useCallback(() => {
    const target = actionTarget
    closeActions()
    if (!target?.chatEventId) return
    setReplyTarget({ _id: target.chatEventId, text: target.text, user: target.user })
  }, [actionTarget, closeActions])

  const onCopy = useCallback(() => {
    const target = actionTarget
    closeActions()
    if (!target) return
    Clipboard.setString(target.text)
    Toast.show({ type: ToastType.Success, text1: t('Chat.Copied') })
  }, [actionTarget, closeActions, t])

  const onDeleteForMe = useCallback(() => {
    const target = actionTarget
    closeActions()
    if (!agent || !target) return
    const ids = target.chatEventId ? { eventIds: [target.chatEventId] } : { basicMessageIds: [target.basicMessageId!] }
    Alert.alert(t('Chat.DeleteForMeTitle'), t('Chat.DeleteForMeBody'), [
      { text: t('Global.Cancel'), style: 'cancel' },
      {
        text: t('Chat.Delete'),
        style: 'destructive',
        onPress: () => {
          if (replyTarget && replyTarget._id === target.chatEventId) setReplyTarget(null)
          deleteChatMessages(agent, connectionId, ids).catch(() => {
            Toast.show({ type: ToastType.Error, text1: t('Chat.DeleteFailed') })
          })
        },
      },
    ])
  }, [actionTarget, agent, closeActions, connectionId, replyTarget, t])

  const onSendRequest = useCallback(async () => {
    navigation.navigate(Stacks.ProofRequestsStack as any, {
      screen: Screens.ProofRequests,
      params: { connectionId },
    })
  }, [navigation, connectionId])

  const actions = useMemo(() => {
    return store.preferences.useVerifierCapability
      ? [
          {
            text: t('Verifier.SendProofRequest'),
            onPress: () => {
              setShowActionSlider(false)
              onSendRequest()
            },
            icon: () => <Assets.svg.iconInfoSentDark height={30} width={30} />,
          },
        ]
      : undefined
  }, [store.preferences.useVerifierCapability, t, onSendRequest, Assets])

  const onDismiss = useCallback(() => {
    setShowActionSlider(false)
  }, [])

  const renderMessage = useCallback((props: MessageProps<ExtendedChatMessage>) => {
    return <ChatMessage messageProps={props} />
  }, [])

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Temporarily removed for cleaner witness chat UI */}
      {/* {isWitnessConnection && <WitnessChatBanner connectionId={connectionId} />} */}
      {/*
       * No KeyboardAvoidingView of our own here — gifted-chat v3 already
       * mounts one (plus its own KeyboardProvider) internally, and wrapping it
       * in a second one is what broke the composer on device 2026-08-26: two
       * avoiders over nested providers produced ~135 UIKeyboardAutomatic frame
       * events per second, tore the text input session down and rebuilt it on
       * each keystroke, and the field cleared and re-asserted sentence
       * capitalisation as a result.
       *
       * The original complaint (keyboard covering the composer, message
       * unsendable) had the same single root cause seen from the other side:
       * gifted-chat's internal avoider defaults to
       * keyboardVerticalOffset={insets.top}, the safe-area inset, which is
       * wrong for a screen inside a navigation header. Give it the real header
       * height instead and it behaves.
       */}
      <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
        {/* "Is this you?" waits here until it is answered, even if it arrived while the app was closed. */}
        <ContinuityRequestCard connectionId={connectionId} />
        <GiftedChat<ExtendedChatMessage>
          keyboardAvoidingViewProps={{ keyboardVerticalOffset: headerHeight }}
          messages={chatMessages}
          isAvatarVisibleForEveryMessage={true}
          renderAvatar={() => null}
          messageIdGenerator={(msg) => msg?._id.toString() || '0'}
          renderMessage={renderMessage}
          renderInputToolbar={(props) => renderInputToolbar(props, theme)}
          renderSend={(props) => renderSend(props, theme)}
          renderComposer={(props) =>
            renderComposer(props, theme, t('Contacts.TypeHere'), !silentAssertConnectedNetwork() || vrcFlowInProgress)
          }
          onSend={onSend}
          text={composer.text}
          textInputProps={composer.textInputProps}
          onLongPressMessage={onLongPressMessage}
          reply={{ message: replyTarget, onClear: () => setReplyTarget(null) }}
          user={{
            _id: Role.me,
          }}
          renderActions={(props) => renderActions(props, theme, actions)}
          onPressActionButton={actions ? () => setShowActionSlider(true) : undefined}
          listProps={{
            keyboardShouldPersistTaps: 'handled',
            style: { backgroundColor: '#F5F5F5' },
            onViewableItemsChanged,
            viewabilityConfig: { itemVisiblePercentThreshold: 50 },
          }}
        />
        {showActionSlider && <ActionSlider onDismiss={onDismiss} actions={actions} />}
        <MessageActions
          visible={actionTarget !== null}
          onClose={closeActions}
          onReact={actionTarget?.chatEventId ? onReact : undefined}
          selectedReaction={actionTarget?.reactions?.find((reaction) => reaction.author === 'sent')?.emoji}
          onReply={actionTarget?.chatEventId ? onReply : undefined}
          onCopy={actionTarget ? onCopy : undefined}
          onDeleteForMe={actionTarget ? onDeleteForMe : undefined}
        />

        {/* VRC exchange flow loading overlay */}
        {vrcFlowInProgress && (
          <View style={styles.flowOverlay} pointerEvents="auto">
            <View style={styles.flowOverlayContent}>
              {vrcConfirmed ? (
                <>
                  <Text style={styles.flowOverlayText}>
                    {theirLabel
                      ? `Relationship confirmed — ${theirLabel} added to Contacts`
                      : 'Relationship confirmed — contact added'}
                  </Text>
                  <TouchableOpacity
                    style={[styles.flowOverlayDismissButton, { backgroundColor: ColorPalette.brand.primary }]}
                    onPress={() => {
                      onDismissConfirmation()
                      const nav = navigation.getParent() ?? navigation
                      ;(nav as any).navigate(TabStacks.ContactStack, { screen: Screens.Contacts })
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={'View contacts'}
                  >
                    <Text style={styles.flowOverlayDismissText}>View contacts</Text>
                  </TouchableOpacity>
                </>
              ) : vrcTimedOut ? (
                <>
                  <Text style={styles.flowOverlayTimeoutIcon}>⚠</Text>
                  <Text style={styles.flowOverlayText}>{vrcStatusText}</Text>
                  <TouchableOpacity
                    style={[styles.flowOverlayDismissButton, { backgroundColor: ColorPalette.brand.primary }]}
                    onPress={() => {
                      onDismissTimeout()
                      const nav = navigation.getParent() ?? navigation
                      ;(nav as any).navigate(Stacks.TabStack)
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('Global.Dismiss')}
                  >
                    <Text style={styles.flowOverlayDismissText}>{t('Global.Dismiss')}</Text>
                  </TouchableOpacity>
                </>
              ) : vrcWaitingOnPeer ? (
                <>
                  <Text style={styles.flowOverlayText}>{t('Relationship.WaitingForAnswer', { name: theirLabel })}</Text>
                  <TouchableOpacity
                    style={[styles.flowOverlayDismissButton, { backgroundColor: ColorPalette.brand.primary }]}
                    onPress={onDismissWaiting}
                    accessibilityRole="button"
                    accessibilityLabel={t('Global.Dismiss')}
                  >
                    <Text style={styles.flowOverlayDismissText}>{t('Global.Dismiss')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.flowOverlayText}>{vrcStatusText}</Text>
                  {progressFraction > 0 && (
                    <FlowProgressBar
                      fraction={progressFraction}
                      color={ColorPalette.brand.primary}
                      complete={progressComplete}
                    />
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flowOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  flowOverlayContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    maxWidth: '80%',
  },
  flowOverlayText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    textAlign: 'center',
  },
  flowOverlayTimeoutIcon: {
    fontSize: 36,
    marginBottom: 4,
  },
  flowOverlayDismissButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  flowOverlayDismissText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
})

export default Chat
