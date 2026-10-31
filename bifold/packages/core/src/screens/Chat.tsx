import { DidCommBasicMessageRepository, DidCommConnectionRecord } from '@credo-ts/didcomm'
import { useAgent, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import { StackNavigationProp, StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GiftedChat, IMessage, MessageProps, ReplyMessage } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import Clipboard from '@react-native-clipboard/clipboard'
import Toast from 'react-native-toast-message'
import { SafeAreaView } from 'react-native-safe-area-context'

import ChatHeaderTitle from '../modules/vrc/components/ChatHeaderTitle'
import InfoIcon from '../modules/vrc/components/InfoIcon'
// Temporarily removed for cleaner witness chat UI
// import { WitnessChatBanner } from '../modules/vrc/components/WitnessChatBanner'
import { renderComposer, renderInputToolbar, renderSend } from '../components/chat'
import { ComposerEmojiButton } from '../components/chat/MessageInput'
import ActionSlider from '../components/chat/ActionSlider'
import { ChatIds } from '../components/chat/Chat.ids'
import MessageActions from '../components/chat/MessageActions'
import { useChatAttended } from '../components/chat/useChatAttended'
import { useComposerText } from '../components/chat/useComposerText'
import { ToastType } from '../components/toast/BaseToast'
import { pickAndSendPhoto } from '../modules/chat/media/compose'
import { confirmGifAsIs, showPhotoOutcome } from '../modules/chat/media/outcome'
import type { PhotoSource } from '../modules/chat/media/pick'
import EmojiPickerSheet from '../modules/chat/emoji/EmojiPickerSheet'
import { type ChatMessageIds, deleteChatMessages } from '../modules/chat/history'
import { removeReaction, sendChatText, sendReaction } from '../modules/chat/send'
import type { ChatSendOutcome } from '../modules/chat/send'
import { chatEventsShown } from '../modules/chat/shown'
import { renderActions } from '../components/chat/ChatActions'
import { ChatMessage, ExtendedChatMessage } from '../components/chat/ChatMessage'
import { renderDayPill } from '../components/chat/DayPill'
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
import { getActiveChatConnectionId, setActiveChatConnectionId } from '../utils/activeChatTracker'
import { sendCapabilityNoticeIfNeeded } from '../modules/chat/notice'
import { counterpartySpeaksChat } from '../modules/chat/capability'
import { useChatEvents } from '../modules/chat/chatEventsStore'
import { useChatDraft } from '../modules/chat/useChatDraft'
import { timerOf } from '../modules/chat/timer'
import { registerOtaApplyBlocker } from '../utils/otaApply'
import { RootStackParams, ContactStackParams, Screens, Stacks, TabStacks } from '../types/navigators'
import { Alert, Animated, Easing, Platform, View, StyleSheet, Text, TouchableOpacity, ViewToken } from 'react-native'

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
  const attended = useChatAttended()
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

  // The chat someone is looking at, so its messages raise no toast: only while attended, so one arriving under a
  // screen pushed over it, or with the app in the background, still does.
  useEffect(() => {
    if (!attended) return
    setActiveChatConnectionId(connectionId)
    // Only its own entry: another chat that has since set itself is left as it is.
    return () => {
      if (getActiveChatConnectionId() === connectionId) setActiveChatConnectionId(undefined)
    }
  }, [attended, connectionId])

  // Opening a chat is when a contact made before chat learns that this phone
  // speaks it (plan §4.5). Best effort: a failed notice is retried next time.
  useEffect(() => {
    if (!agent) return
    sendCapabilityNoticeIfNeeded(agent, connectionId).catch((error) => {
      agent.config?.logger?.warn(`[Chat] capability notice for ${connectionId} not sent`, { error })
    })
  }, [agent, connectionId])

  // An unsent draft is kept per chat (chat/draft.ts), so it outlives this screen: unlocking after the app locked
  // resets navigation (271, 272). It is saved a moment after it changes, so applying an over-the-air update (a
  // reload) could still lose the last keystrokes: watch the text, without controlling it (a controlled composer is
  // what broke typing on 2026-08-26), and block applying while there is any. gifted-chat reports '' after a send,
  // which clears the kept draft too. `composer.insert` puts text at the caret (the emoji button).
  const draft = useChatDraft(agent, connectionId)
  const composer = useComposerText({ onTextChange: draft.onTextChange })
  const { hasDraft, focusAtCaret, restore } = composer
  useEffect(() => {
    if (draft.saved) restore(draft.saved)
  }, [draft.saved, restore])
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

  // The emoji picker: open for the composer (each choice is typed in, and it stays open), or for one
  // message's reaction (its "+"), kept here because the action sheet closes before the picker opens.
  const [picker, setPicker] = useState<{ for: 'composer' } | { for: 'reaction'; target: ExtendedChatMessage } | null>(
    null
  )
  // Closing the composer's picker puts the person back in the field, caret after what they chose. iOS can focus it
  // only once the sheet's modal is gone, which its onDismiss says; Android's modal never says so, and needs no wait.
  const refocusComposer = useRef(false)
  const closePicker = useCallback(() => {
    if (picker?.for === 'composer') {
      if (Platform.OS === 'ios') refocusComposer.current = true
      else focusAtCaret()
    }
    setPicker(null)
  }, [focusAtCaret, picker])
  const onPickerClosed = useCallback(() => {
    if (!refocusComposer.current) return
    refocusComposer.current = false
    focusAtCaret()
  }, [focusAtCaret])
  // A picker opened before the last one's onDismiss came is not the composer's to refocus after.
  useEffect(() => {
    if (picker) refocusComposer.current = false
  }, [picker])

  // Received chat messages as they scroll into view, each reported once while someone is looking at this chat
  // (plan §4.6, D4). What is in view while nobody is (another screen over it, the app in the background) is
  // reported when they come back. FlatList takes onViewableItemsChanged once, so it reads the current chat through
  // a ref.
  const shownRef = useRef({ connectionId, agent, attended, viewable: [] as ViewToken[], ids: new Set<string>() })
  if (shownRef.current.connectionId !== connectionId) {
    shownRef.current = { connectionId, agent, attended, viewable: [], ids: new Set<string>() }
  }
  shownRef.current.agent = agent
  shownRef.current.attended = attended
  const reportShown = useRef(() => {
    const current = shownRef.current
    if (!current.attended || !current.agent) return
    const fresh: string[] = []
    for (const token of current.viewable) {
      const item = token.item as ExtendedChatMessage | undefined
      if (!item?.chatEventId || item.kind === 'system' || item.user?._id !== Role.them) continue
      if (current.ids.has(item.chatEventId)) continue
      current.ids.add(item.chatEventId)
      fresh.push(item.chatEventId)
    }
    if (fresh.length > 0) {
      // Marked before the call so a scroll during it does not report twice; un-marked if it fails, so the next
      // scroll retries instead of leaving a disappearing message's clock unstarted until the chat is reopened.
      void chatEventsShown(current.agent, current.connectionId, fresh).catch(() => {
        for (const eventId of fresh) current.ids.delete(eventId)
      })
    }
  }).current
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    shownRef.current.viewable = viewableItems
    reportShown()
  }).current
  // ...and when the agent arrives, for what came into view before it did.
  useEffect(() => {
    if (attended) reportShown()
  }, [attended, agent, reportShown])

  useEffect(() => {
    navigation.setOptions({
      title: theirLabel,
      // Their photo beside their name, as in the chat list. `title` stays: it names the screen for Back and the OS.
      headerTitle: ({ tintColor, style }) => (
        <ChatHeaderTitle
          connectionId={connectionId}
          label={theirLabel}
          fallbackUrl={connection?.imageUrl}
          tintColor={tintColor}
          style={style}
        />
      ),
      headerRight: () => <InfoIcon connectionId={connection?.id as string} />,
    })
  }, [navigation, theirLabel, connection, connectionId])

  // While someone is looking at the chat, mark its messages seen, and again when they come back to it: a message
  // that arrives under another screen, or with the app in the background, stays unread until then.
  useEffect(() => {
    if (!attended) return
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
  }, [attended, basicMessages, chatMessages, agent, connectionId])

  // A chat event to a contact that speaks chat, a plain BasicMessage otherwise (sendChatText decides). gifted-chat
  // attaches the reply target it was showing, and clears it after this.
  // With disappearing messages on, a contact whose Keyring cannot honour them would get a plain message that never
  // disappears: the person is asked first, and their text and reply are put back if they would rather not.
  const chatEvents = useChatEvents(connectionId)
  const timerOn = useMemo(() => (chatEvents ? (timerOf(chatEvents)?.expiresIn ?? 0) > 0 : false), [chatEvents])
  const onSend = useCallback(
    async (messages: IMessage[]) => {
      // gifted-chat has just reset the field, to a hand-over's text if one was still on: empty it either way.
      composer.sent()
      if (!agent) return
      const message = messages[0]
      const inReplyTo = message.replyMessage?._id
      const send = () =>
        sendChatText(agent, connectionId, message.text, typeof inReplyTo === 'string' && inReplyTo ? { inReplyTo } : {})
      if (timerOn && !(await counterpartySpeaksChat(agent, connectionId))) {
        const putBack = () => {
          composer.insert(message.text)
          if (message.replyMessage) setReplyTarget(message.replyMessage)
        }
        Alert.alert(
          t('Chat.PlainSendTitle'),
          t('Chat.PlainSendBody', { name: theirLabel, interpolation: { escapeValue: false } }),
          [
            { text: t('Global.Cancel'), style: 'cancel', onPress: putBack },
            { text: t('Chat.PlainSendConfirm'), onPress: () => void send() },
          ],
          { cancelable: true, onDismiss: putBack }
        )
        return
      }
      await send()
    },
    [agent, connectionId, timerOn, composer, t, theirLabel]
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

  const reactTo = useCallback(
    async (target: ExtendedChatMessage | null, emoji: string) => {
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
    [agent, connectionId, notSentNotice, t]
  )

  const onReact = useCallback(
    async (emoji: string) => {
      const target = actionTarget
      closeActions()
      await reactTo(target, emoji)
    },
    [actionTarget, closeActions, reactTo]
  )

  // "+" on the reaction bar: close the sheet, keep the message, and open the full picker for it.
  const openReactionPicker = useCallback(() => {
    const target = actionTarget
    closeActions()
    if (target?.chatEventId) setPicker({ for: 'reaction', target })
  }, [actionTarget, closeActions])

  const onPickEmoji = useCallback(
    (emoji: string) => {
      if (!picker) return
      if (picker.for === 'composer') {
        composer.insert(emoji)
        return
      }
      setPicker(null)
      reactTo(picker.target, emoji)
    },
    [composer, picker, reactTo]
  )

  const onReply = useCallback(() => {
    const target = actionTarget
    closeActions()
    if (!target?.chatEventId) return
    // Named for the preview above the composer (gifted-chat's ReplyPreview prints `user.name`, or "Unknown").
    const author = target.user?._id === Role.me ? t('Chat.UserYou') : theirLabel
    setReplyTarget({ _id: target.chatEventId, text: target.text, user: { _id: `quote:${author}`, name: author } })
  }, [actionTarget, closeActions, t, theirLabel])

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
    const ids: ChatMessageIds = target.chatEventId
      ? { events: [{ role: target.user._id === Role.me ? 'sent' : 'received', eventId: target.chatEventId }] }
      : { basicMessageIds: [target.basicMessageId!] }
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

  // A photo from the camera or the library (rich-messaging-plan.md §5): fitted to one message and sent, or the reason
  // it was not. A GIF goes as it is, with whatever it carries, so the person is asked first.
  const onPhoto = useCallback(
    async (source: PhotoSource) => {
      setShowActionSlider(false)
      if (!agent) return
      const outcome = await pickAndSendPhoto(agent, connectionId, source, {
        fallbackText: t('Chat.PhotoFallback'),
        confirmGif: confirmGifAsIs(t),
      })
      showPhotoOutcome(outcome, t)
    },
    [agent, connectionId, t]
  )

  const actions = useMemo(() => {
    const photo = _isWitnessConnection
      ? []
      : [
          {
            text: t('Chat.AttachCamera'),
            testID: ChatIds.attachCamera,
            onPress: () => void onPhoto('camera'),
            icon: () => <Icon name="camera-outline" size={30} color={ColorPalette.brand.primary} />,
          },
          {
            text: t('Chat.AttachLibrary'),
            testID: ChatIds.attachLibrary,
            onPress: () => void onPhoto('library'),
            icon: () => <Icon name="image-outline" size={30} color={ColorPalette.brand.primary} />,
          },
        ]
    const proof = store.preferences.useVerifierCapability
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
      : []
    const all = [...photo, ...proof]
    return all.length > 0 ? all : undefined
  }, [_isWitnessConnection, store.preferences.useVerifierCapability, t, onPhoto, onSendRequest, Assets, ColorPalette])

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
          // The day marker: gifted-chat draws it above each day's first message (every kind of message, its own
          // DayWrapper) and as the copy floating while the list scrolls. ChatMessage draws none of its own: 272's
          // second date line, and the doubled pill C1 first had, were a marker of ours beside gifted-chat's.
          renderDay={renderDayPill}
          renderInputToolbar={(props) => renderInputToolbar(props, theme)}
          // Camera while the field is empty, where the chat takes photos; Send once it holds text.
          renderSend={(props) =>
            renderSend(
              props,
              theme,
              _isWitnessConnection
                ? undefined
                : {
                    label: t('Chat.AttachCamera'),
                    onPress: () => void onPhoto('camera'),
                    // As the field and the emoji button: not offline, nor during a VRC exchange.
                    disabled: !silentAssertConnectedNetwork() || vrcFlowInProgress,
                  }
            )
          }
          renderComposer={(props) => {
            const disabled = !silentAssertConnectedNetwork() || vrcFlowInProgress
            return renderComposer(
              props,
              theme,
              t('Chat.MessagePlaceholder'),
              disabled,
              <ComposerEmojiButton
                label={t('Emoji.Open')}
                disabled={disabled}
                onPress={() => setPicker({ for: 'composer' })}
              />
            )
          }}
          onSend={onSend}
          text={composer.text}
          textInputProps={composer.textInputProps}
          textInputRef={composer.inputRef}
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
          onMoreReactions={actionTarget?.chatEventId ? openReactionPicker : undefined}
          selectedReaction={actionTarget?.reactions?.find((reaction) => reaction.author === 'sent')?.emoji}
          onReply={actionTarget?.chatEventId ? onReply : undefined}
          // A photo's label is not something anyone wrote, so a photo with no caption has nothing to copy.
          onCopy={actionTarget && !actionTarget.textIsLabel ? onCopy : undefined}
          onDeleteForMe={actionTarget ? onDeleteForMe : undefined}
        />
        <EmojiPickerSheet
          visible={picker !== null}
          onSelect={onPickEmoji}
          onClose={closePicker}
          onClosed={onPickerClosed}
        />

        {/* VRC exchange flow loading overlay */}
        {vrcFlowInProgress && (
          <View style={styles.flowOverlay} pointerEvents="auto">
            <View style={styles.flowOverlayContent}>
              {vrcConfirmed ? (
                <>
                  <Text style={styles.flowOverlayText}>
                    {theirLabel
                      ? t('Chat.RelationshipConfirmedWith', { name: theirLabel })
                      : t('Chat.RelationshipConfirmed')}
                  </Text>
                  <TouchableOpacity
                    style={[styles.flowOverlayDismissButton, { backgroundColor: ColorPalette.brand.primary }]}
                    onPress={() => {
                      onDismissConfirmation()
                      const nav = navigation.getParent() ?? navigation
                      ;(nav as any).navigate(TabStacks.ContactStack, { screen: Screens.Contacts })
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('Chat.ViewContacts')}
                  >
                    <Text style={styles.flowOverlayDismissText}>{t('Chat.ViewContacts')}</Text>
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
