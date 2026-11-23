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
import {
  addPendingPhoto,
  pendingPhoto,
  removePendingPhoto,
  updatePendingPhoto,
  usePendingPhotos,
  type PendingPhoto,
} from '../modules/chat/media/pending'
import type { PhotoSource } from '../modules/chat/media/pick'
import EmojiPickerSheet from '../modules/chat/emoji/EmojiPickerSheet'
import { type ChatMessageIds, deleteChatMessages } from '../modules/chat/history'
import { loadChatDraft, saveChatDraft } from '../modules/chat/draft'
import { removeReaction, sendChatText, sendReaction } from '../modules/chat/send'
import { failureCategory } from '../modules/rooms/roomsLogWords'
import type { ChatSendOutcome } from '../modules/chat/send'
import { chatEventsShown } from '../modules/chat/shown'
import { renderActions } from '../components/chat/ChatActions'
import { ChatMessage, ExtendedChatMessage } from '../components/chat/ChatMessage'
import { renderDayPill } from '../components/chat/DayPill'
import { useNetwork } from '../contexts/network'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import {
  isPeerWaitStatus,
  useChatMessagesByConnection,
  useVrcFlowInProgress,
  PROGRESS_MILESTONES,
} from '../hooks/chat-messages'
import { useConnectionDisplayName } from '../hooks/connections'
import ContinuityRequestCard from '../modules/vrc/components/ContinuityRequestCard'
import ConfirmWithSheet from '../modules/trust-tasks/components/ConfirmWithSheet'
import { canConfirmWith } from '../modules/trust-tasks/confirmItsYou'
import { isConfirmItsYouEnabled } from '../modules/trust-tasks/module/confirmItsYouFlag'
import { LateStepHeldCard, WaitingSinceCard } from '../modules/vrc/components/LateStepCards'
import { useHeldStep, useTickingNow } from '../modules/vrc/hooks/useLateStep'
import { askPeerReady, lateStepStore, stopExchange } from '../modules/vrc/lateStep'
import { vrcFlowStore } from '../modules/vrc/witnessStatusStore'
import { useWitnessConnection } from '../modules/vrc/context/WitnessConnectionProvider'
import { Role } from '../types/chat'
import { markChatEventsSeen } from '../modules/chat/seen'
import { BasicMessageMetadata, basicMessageCustomMetadata } from '../types/metadata'
import { getActiveChatConnectionId, setActiveChatConnectionId } from '../utils/activeChatTracker'
import { testIdWithKey } from '../utils/testable'
import { sendCapabilityNoticeIfNeeded } from '../modules/chat/notice'
import { counterpartySpeaksChat } from '../modules/chat/capability'
import { useChatEvents } from '../modules/chat/chatEventsStore'
import { useConfirmChatItems } from '../modules/trust-tasks/screens/useConfirmChatItems'
import { useChatDraft } from '../modules/chat/useChatDraft'
import { timerOf } from '../modules/chat/timer'
import { registerOtaApplyBlocker } from '../utils/otaApply'
import { RootStackParams, ContactStackParams, Screens, Stacks, TabStacks } from '../types/navigators'
import {
  Alert,
  Animated,
  Easing,
  Platform,
  ScrollView,
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewToken,
} from 'react-native'

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

  // A step that arrived late waits for both people (lateStep.ts, IN-448): asked here, or offered again from the bar.
  const heldStep = useHeldStep(connectionId)
  const lateNow = useTickingNow(Boolean(heldStep && !heldStep.dismissed) || vrcWaitingOnPeer)
  const waitingSince = vrcWaitingOnPeer ? vrcFlowStore.getStatusSince(connectionId) : undefined
  const [lateBusy, setLateBusy] = useState(false)
  const onCheckReady = useCallback(async () => {
    if (!agent || lateBusy) return
    setLateBusy(true)
    try {
      await askPeerReady(agent, connectionId)
    } catch (e) {
      agent.config.logger.warn(`[VRC:LateStep] ready-check not sent: ${(e as Error).message}`)
    } finally {
      setLateBusy(false)
    }
  }, [agent, connectionId, lateBusy])
  const onStopExchange = useCallback(() => {
    if (!agent) return
    void stopExchange(agent, connectionId).catch((e: Error) =>
      agent.config.logger.warn(`[VRC:LateStep] stop not sent: ${e.message}`)
    )
  }, [agent, connectionId])

  // Check if this connection is a witness connection by matching connectionId
  const _isWitnessConnection = connectedWitness?.connectionId === connectionId

  // "Confirm with <name>" in the "+" sheet (Confirm it's you): offered only with its switch on (and no remote off), in a
  // chat that is not the witness's, once this phone is known to hold a relationship to ask over. Off, nothing is read.
  const confirmOn = isConfirmItsYouEnabled()
  const [canConfirm, setCanConfirm] = useState(false)
  const [confirmSheet, setConfirmSheet] = useState(false)
  useEffect(() => {
    if (!agent || !confirmOn || _isWitnessConnection) {
      setCanConfirm(false)
      return
    }
    let live = true
    void canConfirmWith(agent, connectionId).then((ok) => live && setCanConfirm(ok))
    return () => {
      live = false
    }
  }, [agent, confirmOn, connectionId, _isWitnessConnection])

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
  // The chat on screen now, none once the screen has gone. A deep link or a message wake can change the chat under
  // this screen while a send is out, and the person can leave it.
  const chatOnScreen = useRef<string | undefined>(connectionId)
  useEffect(() => {
    chatOnScreen.current = connectionId
    return () => {
      chatOnScreen.current = undefined
    }
  }, [connectionId])
  // Failed sends kept as drafts, one at a time: each reads what the last one wrote, so two can't lose one.
  const keepingNotSent = useRef<Promise<void>>(Promise.resolve())
  const onSend = useCallback(
    async (messages: IMessage[]) => {
      // gifted-chat has just reset the field, to a hand-over's text if one was still on: empty it either way.
      composer.sent()
      if (!agent) return
      const message = messages[0]
      const inReplyTo = message.replyMessage?._id
      // The field was emptied above, and a chat event that failed is stored nowhere (send.ts), so the words are only
      // here. They stay with the chat they were written for: never in another contact's field, where Send would give
      // them to that contact. With that chat gone from the screen, the notice says which chat and where the words are.
      const notSent = async (error: unknown) => {
        // The kind only: an agent's or transport's words can name the contact.
        agent.config?.logger?.warn(`[Chat] a message was not sent: ${failureCategory(error)}`)
        if (chatOnScreen.current === connectionId) {
          Toast.show({ type: ToastType.Error, text1: t('Chat.MessageNotSent') })
          composer.putBack(message.text)
          if (message.replyMessage) setReplyTarget((current) => current ?? (message.replyMessage as ReplyMessage))
          return
        }
        const keep = keepingNotSent.current.then(async () => {
          const kept = await loadChatDraft(agent, connectionId)
          await saveChatDraft(agent, connectionId, kept ? `${message.text}\n${kept}` : message.text)
        })
        keepingNotSent.current = keep.catch(() => undefined)
        try {
          await keep
          Toast.show({
            type: ToastType.Error,
            text1: t('Chat.MessageNotSentKept', { name: theirLabel, interpolation: { escapeValue: false } }),
            // About 20 words, and the person may be looking elsewhere. Missed, it costs a moment's confusion: the words
            // are in that chat's draft.
            visibilityTime: 8000,
          })
        } catch (keepError) {
          agent.config?.logger?.warn(`[Chat] a message not sent was not kept: ${failureCategory(keepError)}`)
          Toast.show({
            type: ToastType.Error,
            text1: t('Chat.MessageNotSentLost', { name: theirLabel, interpolation: { escapeValue: false } }),
            // Longer than the one above: missed, this loss is silent. This toast is the only record of it.
            visibilityTime: 15_000,
          })
        }
      }
      const send = () =>
        sendChatText(
          agent,
          connectionId,
          message.text,
          typeof inReplyTo === 'string' && inReplyTo ? { inReplyTo } : {}
        ).catch(notSent)
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
  // It shows in the chat the moment it is picked (media/pending.ts): being made ready, which can be stopped; being sent,
  // which can't; or not sent, with Try again and Delete. Its stored message appears only once it really went.
  const onPhoto = useCallback(
    async (source: PhotoSource) => {
      setShowActionSlider(false)
      if (!agent) return
      let id: string | undefined
      const outcome = await pickAndSendPhoto(agent, connectionId, source, {
        fallbackText: t('Chat.PhotoFallback'),
        confirmGif: confirmGifAsIs(t),
        hooks: {
          picked: (photo) => {
            id = addPendingPhoto(connectionId, photo)
          },
          // Stopping takes the bubble away: a photo no longer pending is not sent.
          goOn: () => !!id && !!pendingPhoto(connectionId, id),
          sending: () => id && updatePendingPhoto(connectionId, id, { stage: 'sending' }),
          failed: (retry) => id && updatePendingPhoto(connectionId, id, { stage: 'failed', retry }),
        },
      })
      // A photo that wasn't sent stays, saying so on its bubble; every other outcome takes the bubble away.
      if (id && outcome === 'not-sent') return
      if (id) removePendingPhoto(connectionId, id)
      showPhotoOutcome(outcome, t)
    },
    [agent, connectionId, t]
  )

  const pendingPhotos = usePendingPhotos(connectionId)
  // Confirm it's you requests, as cards among the messages (none while its switch, or a remote off, says no).
  const confirmCards = useConfirmChatItems(connectionId, theirLabel)
  const timeline = useMemo(
    () =>
      confirmCards.length
        ? [...chatMessages, ...confirmCards].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        : chatMessages,
    [chatMessages, confirmCards]
  )
  const messages = useMemo(() => {
    if (!pendingPhotos.length) return timeline
    const retry = async (p: PendingPhoto) => {
      if (!p.retry) return
      updatePendingPhoto(connectionId, p.id, { stage: 'sending' })
      if (await p.retry()) removePendingPhoto(connectionId, p.id)
      else updatePendingPhoto(connectionId, p.id, { stage: 'failed' })
    }
    // Newest first, as gifted-chat lists them: the photos on their way are the newest.
    const pending: ExtendedChatMessage[] = [...pendingPhotos].reverse().map((p) => ({
      _id: p.id,
      createdAt: new Date(p.createdAt),
      user: { _id: Role.me },
      text: '',
      image: p.uri,
      imageSize: { width: p.width, height: p.height },
      renderEvent: () => <></>,
      photoSending: {
        stage: p.stage,
        onStop: p.stage === 'preparing' ? () => removePendingPhoto(connectionId, p.id) : undefined,
        onRetry: p.stage === 'failed' ? () => void retry(p) : undefined,
        onDelete: p.stage === 'failed' ? () => removePendingPhoto(connectionId, p.id) : undefined,
      },
    }))
    return [...pending, ...timeline]
  }, [pendingPhotos, timeline, connectionId])

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
    const confirm =
      confirmOn && canConfirm
        ? [
            {
              text: t('ConfirmItsYou.Title', {
                name: theirLabel || t('Approver.UnnamedContact'),
                interpolation: { escapeValue: false },
              }),
              testID: ChatIds.confirmWith,
              onPress: () => {
                setShowActionSlider(false)
                setConfirmSheet(true)
              },
              icon: () => <Icon name="shield-check-outline" size={30} color={ColorPalette.brand.primary} />,
            },
          ]
        : []
    // The existing entries keep their order; the new one goes last.
    const all = [...photo, ...proof, ...confirm]
    return all.length > 0 ? all : undefined
  }, [
    _isWitnessConnection,
    store.preferences.useVerifierCapability,
    t,
    onPhoto,
    onSendRequest,
    Assets,
    ColorPalette,
    confirmOn,
    canConfirm,
    theirLabel,
  ])

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
          messages={messages}
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
        <ConfirmWithSheet
          connectionId={connectionId}
          name={theirLabel || t('Approver.UnnamedContact')}
          visible={confirmSheet && confirmOn}
          onClose={() => setConfirmSheet(false)}
        />
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

        {/* A remote step that arrived late: asked before anything is sent or signed (lateStep.ts) */}
        {heldStep && !heldStep.dismissed && (
          <View style={styles.flowOverlay} pointerEvents="auto">
            <ScrollView
              style={styles.flowOverlayScroll}
              contentContainerStyle={styles.flowOverlayScrollContent}
              bounces={false}
            >
              <View style={styles.flowOverlayContent}>
                <LateStepHeldCard
                  name={theirLabel}
                  held={heldStep}
                  now={lateNow}
                  onCheck={() => void onCheckReady()}
                  onNotNow={() => lateStepStore.dismiss(connectionId)}
                  onStop={() => lateStepStore.dismiss(connectionId, true)}
                  busy={lateBusy}
                  textColor="#333"
                />
              </View>
            </ScrollView>
          </View>
        )}
        {heldStep?.dismissed && (
          <TouchableOpacity
            style={[styles.lateStepBar, { backgroundColor: ColorPalette.brand.primary }]}
            onPress={() => lateStepStore.reopen(connectionId)}
            testID={testIdWithKey('LateStepFinishBar')}
            accessibilityRole="button"
            accessibilityLabel={`${t('LateStep.WaitingBar', { name: theirLabel })}. ${t('LateStep.Finish')}`}
          >
            <Text style={styles.lateStepBarText}>
              {t('LateStep.WaitingBar', { name: theirLabel, interpolation: { escapeValue: false } })} ·{' '}
              {t('LateStep.Finish')}
            </Text>
          </TouchableOpacity>
        )}

        {/* VRC exchange flow loading overlay (a held step's card takes its place until both people are here) */}
        {vrcFlowInProgress && !heldStep && (
          <View style={styles.flowOverlay} pointerEvents="auto">
            <ScrollView
              style={styles.flowOverlayScroll}
              contentContainerStyle={styles.flowOverlayScrollContent}
              bounces={false}
            >
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
                  <WaitingSinceCard
                    name={theirLabel}
                    since={waitingSince}
                    now={lateNow}
                    onWait={onDismissWaiting}
                    onStop={onStopExchange}
                    textColor="#333"
                  />
                ) : (
                  <>
                    <Text style={styles.flowOverlayText}>{vrcStatusText}</Text>
                    {isPeerWaitStatus(vrcFlowStore.getStatus(connectionId)) && (
                      <Text style={styles.flowOverlayNote} testID={testIdWithKey('VrcFlowKeepOpen')}>
                        {t('LateStep.KeepOpen', { name: theirLabel, interpolation: { escapeValue: false } })}
                      </Text>
                    )}
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
            </ScrollView>
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
  // At the largest text sizes a card is taller than the page: it scrolls, and starts at the top, instead of
  // spilling off both ends with its buttons out of reach.
  flowOverlayScroll: { alignSelf: 'stretch' },
  flowOverlayScrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 16 },
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
  flowOverlayNote: {
    marginTop: 8,
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
  },
  lateStepBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 900,
  },
  lateStepBarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
})

export default Chat
