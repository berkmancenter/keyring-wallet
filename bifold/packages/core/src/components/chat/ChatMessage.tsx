import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { View, Text } from 'react-native'
// gesture-handler touchables: RN's own touchables miss taps inside GiftedChat's
// inverted list + GestureHandlerRootView on Android with the new architecture
import { TouchableOpacity } from 'react-native-gesture-handler'
import { Bubble, IMessage, MessageImage, MessageImageProps, MessageProps } from 'react-native-gifted-chat'
import moment from 'moment'

import { useTheme } from '../../contexts/theme'
import { Role } from '../../types/chat'
import { ModalUsage } from '../../types/remove'
import { ThemedText } from '../texts/ThemedText'
import CommonRemoveModal from '../modals/CommonRemoveModal'
import type { ChatReaction } from '../../modules/chat/fold'
import type { ChatEventRecord } from '../../modules/chat/records/ChatEventRecord'
import { testIdWithKey } from '../../utils/testable'
import { ChatIds } from './Chat.ids'

// Date separator color as per design
const DATE_SEPARATOR_COLOR = '#888888'

export enum CallbackType {
  CredentialOffer = 'CredentialOffer',
  ProofRequest = 'ProofRequest',
  PresentationSent = 'PresentationSent',
}

// Icon types for chat messages
export enum MessageIconType {
  Connection = 'Connection', // "You connected with" - chat bubble icon
  RelationshipDID = 'RelationshipDID', // DID exchange messages - circle dots icon
  Credential = 'Credential', // Credential received/offered - shield icon
  Proof = 'Proof', // Proof request/presentation - shield icon
  WitnessStatus = 'WitnessStatus', // Witness status messages - search data icon
  ReportingDID = 'ReportingDID', // Reporting DID registration - broadcast/signal icon
}

export interface ChatMessageProps {
  messageProps: MessageProps<ExtendedChatMessage>
}

export interface ExtendedChatMessage extends IMessage {
  renderEvent: () => React.JSX.Element
  createdAt: Date
  messageOpensCallbackType?: CallbackType
  onDetails?: () => void
  onDecline?: () => void
  iconType?: MessageIconType // Icon to display for this message
  relationshipDid?: string // The actual DID for RelationshipDID messages
  // Collapsible witness message support
  collapsedContent?: () => React.JSX.Element // Content shown when collapsed
  expandedContent?: () => React.JSX.Element // Additional content shown when expanded
  // A chat event (keyring/chat/1.0), rather than a BasicMessage: only these can be reacted or replied to.
  chatEventId?: string
  /** Its current reactions, folded in (at most one per person). */
  reactions?: ChatReaction[]
  /**
   * The event it replies to, and what of it is shown: its text; that it disappeared on its timer; that it is not on
   * this phone; or nothing yet, while which originals disappeared is being read.
   */
  inReplyTo?: string
  replyTo?: { text: string; author?: string } | { expired: true } | { unavailable: true } | { unread: true }
  /** A photo's size as its header gave it, so its bubble keeps the photo's shape (`image` is its local file URI). */
  imageSize?: { width: number; height: number }
  /** The text is a label this phone gave it (a photo's), not words anyone wrote: there is nothing to copy. */
  textIsLabel?: boolean
  /** A disappearing message's timer, in seconds, as it was sent: the chat list shows no text of it. */
  expiresIn?: number
  /** A line about the chat itself (a timer set), not a bubble: never unread, never the chat list's preview. */
  kind?: 'system'
  /** A system line's event, for whoever words it. */
  chatEvent?: ChatEventRecord
  /** A plain BasicMessage's record id, so Delete for me can remove it. Cards never carry one. */
  basicMessageId?: string
}

/**
 * The reactions under a message: each emoji once, with a count when both people chose it. The phone's own is
 * marked. Only reactions that are stored show here; nothing is drawn before it is sent.
 */
export const MessageReactions: React.FC<{ reactions: ChatReaction[]; isMe: boolean }> = ({ reactions, isMe }) => {
  const { t } = useTranslation()
  const counts = new Map<string, { count: number; mine: boolean }>()
  for (const reaction of reactions) {
    const entry = counts.get(reaction.emoji) ?? { count: 0, mine: false }
    counts.set(reaction.emoji, { count: entry.count + 1, mine: entry.mine || reaction.author === 'sent' })
  }
  const label = [...counts.entries()]
    .map(([emoji, { count, mine }]) =>
      mine ? t('Chat.ReactionYou', { emoji, count }) : t('Chat.ReactionThem', { emoji, count })
    )
    .join(', ')
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: -6, gap: 4 }}
      accessible
      accessibilityLabel={label}
      testID={testIdWithKey(ChatIds.reactions)}
    >
      {[...counts.entries()].map(([emoji, { count, mine }]) => (
        <View
          key={emoji}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: mine ? '#E8E0EC' : '#FFFFFF',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(170, 170, 170, 0.4)',
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}
        >
          <Text style={{ fontSize: 14 }}>{emoji}</Text>
          {count > 1 && <Text style={{ fontSize: 12, color: '#555555', marginLeft: 2 }}>{count}</Text>}
        </View>
      ))}
    </View>
  )
}

const MessageTime: React.FC<{ message: ExtendedChatMessage }> = ({ message }) => {
  const { ChatTheme: theme } = useTheme()

  // Show only time (e.g., "9:22 AM") - date is shown in day separator
  const timeOnly = moment(message.createdAt).format('h:mm A')

  return (
    <ThemedText style={message.user._id === Role.me ? theme.timeStyleRight : theme.timeStyleLeft}>
      {timeOnly}
    </ThemedText>
  )
}

const EVENT_CIRCLE_COLOR = '#F1D2D6'
const EVENT_ICON_COLOR = '#622C62'
const EVENT_CARD_BG = '#FFFFFF'
const EVENT_CARD_BORDER = 'rgba(170, 170, 170, 0.4)'

const MessageIcon: React.FC<{ iconType: MessageIconType; isMe: boolean }> = ({ iconType }) => {
  const { Assets } = useTheme()

  const getIcon = () => {
    switch (iconType) {
      case MessageIconType.Connection:
        return <Assets.svg.iconMessageChatBubbleBlack width={20} height={20} fill={EVENT_ICON_COLOR} />
      case MessageIconType.Credential:
      case MessageIconType.Proof:
        return <Assets.svg.iconCircleDotsBlack width={20} height={20} fill={EVENT_ICON_COLOR} />
      case MessageIconType.ReportingDID:
      case MessageIconType.WitnessStatus:
      case MessageIconType.RelationshipDID:
        return <Assets.svg.iconCircleDotsBlack width={20} height={20} fill={EVENT_ICON_COLOR} />
      default:
        return null
    }
  }

  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: EVENT_CIRCLE_COLOR,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
        flexShrink: 0,
      }}
    >
      {getIcon()}
    </View>
  )
}

const EventCard: React.FC<{ message: ExtendedChatMessage }> = ({ message }) => {
  return (
    <View
      style={{
        backgroundColor: EVENT_CARD_BG,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: EVENT_CARD_BORDER,
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginHorizontal: 12,
        marginVertical: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 2,
        minHeight: 62,
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <MessageIcon iconType={message.iconType!} isMe={false} />
        <View style={{ flex: 1 }}>{message.renderEvent()}</View>
      </View>
    </View>
  )
}

const CredentialOfferActions: React.FC<{
  message: ExtendedChatMessage
}> = ({ message }) => {
  const { t } = useTranslation()
  const [declineModalVisible, setDeclineModalVisible] = useState(false)

  const handleDeclineSubmit = useCallback(async () => {
    setDeclineModalVisible(false)
    if (message.onDecline) {
      message.onDecline()
    }
  }, [message])

  if (!message.onDetails) {
    return null
  }

  if (message.messageOpensCallbackType === CallbackType.CredentialOffer) {
    return (
      <View
        style={{
          marginTop: 14,
          marginBottom: 16,
          marginHorizontal: 12,
          paddingVertical: 4,
        }}
      >
        <Text style={{ color: '#333', fontSize: 14, marginBottom: 14 }}>Would you like to accept it?</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            onPress={message.onDetails}
            style={{
              minWidth: 56,
              minHeight: 36,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 18,
              backgroundColor: '#FFFFFF',
              borderRadius: 4,
              borderWidth: 0.5,
              borderColor: 'rgba(0,0,0,0.5)',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#222' }}>YES</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDeclineModalVisible(true)}
            style={{
              minWidth: 56,
              minHeight: 36,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 18,
              backgroundColor: 'rgba(0,0,0,0.1)',
              borderRadius: 4,
              borderWidth: 0.5,
              borderColor: 'rgba(0,0,0,0.1)',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#222' }}>NO</Text>
          </TouchableOpacity>
        </View>
        <CommonRemoveModal
          usage={ModalUsage.CredentialOfferDecline}
          visible={declineModalVisible}
          onSubmit={handleDeclineSubmit}
          onCancel={() => setDeclineModalVisible(false)}
        />
      </View>
    )
  }

  const getLinkText = () => {
    if (message.messageOpensCallbackType === CallbackType.ProofRequest) {
      return t('Chat.ViewRequest')
    }
    if (message.messageOpensCallbackType === CallbackType.PresentationSent) {
      return t('Chat.OpenPresentation')
    }
    return t('Chat.FullContactDetails')
  }

  return (
    <View style={{ marginTop: 8, marginHorizontal: 12 }}>
      <TouchableOpacity onPress={message.onDetails}>
        <Text
          style={{
            color: 'black',
            fontSize: 14,
            textDecorationLine: 'underline',
          }}
        >
          {getLinkText()}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

/** What a reply's quote says of its original. */
const quoteOf = (replyTo: NonNullable<ExtendedChatMessage['replyTo']>, t: TFunction): string => {
  if ('text' in replyTo) return replyTo.text
  if ('expired' in replyTo) return t('Chat.ReplyExpired')
  if ('unavailable' in replyTo) return t('Chat.ReplyUnavailable')
  return ''
}

/**
 * What gifted-chat's MessageReply shows above a quote: the original's author, or, when the original is not on this
 * phone, why (there is no author to name). MessageReply prints `user.name`, or "Unknown" without one, and its own
 * English "You" whenever the quoted author's id equals the replying message's, so the id here never equals a real
 * author's.
 */
const quotedAuthor = (replyTo: NonNullable<ExtendedChatMessage['replyTo']>, t: TFunction) =>
  'text' in replyTo
    ? { _id: `quote:${replyTo.author ?? ''}`, name: replyTo.author }
    : { _id: 'quote:', name: quoteOf(replyTo, t) }

/** The largest a photo is drawn in its bubble; tapping it opens it full screen with pinch-zoom (gifted-chat's own). */
const IMAGE_MAX = { width: 220, height: 280 }

export const bubbleImageSize = (size?: { width: number; height: number }): { width: number; height: number } => {
  if (!size || size.width <= 0 || size.height <= 0) return { width: IMAGE_MAX.width, height: IMAGE_MAX.width }
  const scale = Math.min(IMAGE_MAX.width / size.width, IMAGE_MAX.height / size.height, 1)
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
}

const ChatImage: React.FC<MessageImageProps<IMessage> & { label: string }> = ({ label, ...props }) => (
  <MessageImage
    {...props}
    imageStyle={{
      ...bubbleImageSize((props.currentMessage as ExtendedChatMessage).imageSize),
      borderRadius: 8,
      margin: 0,
    }}
    imageProps={{ testID: testIdWithKey(ChatIds.image), accessibilityLabel: label }}
  />
)

export const ChatMessage: React.FC<ChatMessageProps> = ({ messageProps }) => {
  const { ChatTheme: theme } = useTheme()
  const { t } = useTranslation()
  const message = useMemo(() => messageProps.currentMessage as ExtendedChatMessage, [messageProps])

  if (!message) {
    return null
  }

  const isMe = message.user?._id === Role.me

  // A line about the chat itself (a timer change): centered words, no bubble.
  if (message.kind === 'system') {
    return (
      <View>
        <View style={{ alignItems: 'center', marginVertical: 8, paddingHorizontal: 32 }}>
          <Text style={{ color: DATE_SEPARATOR_COLOR, fontSize: 14, textAlign: 'center' }}>{message.text}</Text>
        </View>
      </View>
    )
  }

  // Event messages (connection, credential, proof) render as centered cards
  if (message.iconType) {
    return (
      <View>
        <EventCard message={message} />
        {(message.iconType === MessageIconType.Credential || message.iconType === MessageIconType.Proof) && (
          <CredentialOfferActions message={message} />
        )}
      </View>
    )
  }

  // Regular chat messages render as left/right bubbles
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
        <View style={{ ...theme.containerStyle }}>
          <Bubble
            {...messageProps}
            // A reply shows what it answers, through gifted-chat's own MessageReply: the original's text, or that it
            // expired, or that it is not on this phone.
            // 'unread' is a reply whose original is still being read: nothing to quote yet, so no quote (an empty one
            // would read "Unknown").
            currentMessage={
              message.replyTo && !('unread' in message.replyTo)
                ? {
                    ...message,
                    replyMessage: {
                      _id: message.inReplyTo ?? '',
                      text: 'text' in message.replyTo ? message.replyTo.text : '',
                      user: quotedAuthor(message.replyTo, t),
                    },
                  }
                : message
            }
            isUsernameVisible={false}
            renderMessageText={() => message.renderEvent()}
            renderMessageImage={(props) => <ChatImage {...props} label={t('Chat.Photo')} />}
            containerStyle={{
              left: { margin: 0 },
              right: { margin: 0 },
            }}
            wrapperStyle={{
              left: { ...theme.leftBubble, minHeight: 0, marginLeft: 0 },
              right: { ...theme.rightBubble, minHeight: 0, marginRight: 0 },
            }}
            bottomContainerStyle={{
              left: { marginBottom: 0, paddingBottom: 0 },
              right: { marginBottom: 0, paddingBottom: 0 },
            }}
            textStyle={{
              left: { ...theme.leftText },
              right: { ...theme.rightText },
            }}
            renderTime={() => <MessageTime message={message} />}
            renderCustomView={() => null}
          />
          {message.reactions && message.reactions.length > 0 && (
            <MessageReactions reactions={message.reactions} isMe={isMe} />
          )}
        </View>
      </View>
    </View>
  )
}
