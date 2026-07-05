import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TouchableOpacity, View, Text } from 'react-native'
import { Bubble, IMessage, Message } from 'react-native-gifted-chat'
import moment from 'moment'

import { useTheme } from '../../contexts/theme'
import { Role } from '../../types/chat'
import { ModalUsage } from '../../types/remove'
import { ThemedText } from '../texts/ThemedText'
import CommonRemoveModal from '../modals/CommonRemoveModal'

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
  messageProps: React.ComponentProps<typeof Message>
}

export interface ExtendedChatMessage extends IMessage {
  renderEvent: () => JSX.Element
  createdAt: Date
  messageOpensCallbackType?: CallbackType
  onDetails?: () => void
  onDecline?: () => void
  iconType?: MessageIconType // Icon to display for this message
  relationshipDid?: string // The actual DID for RelationshipDID messages
  // Collapsible witness message support
  collapsedContent?: () => JSX.Element // Content shown when collapsed
  expandedContent?: () => JSX.Element // Additional content shown when expanded
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
    <View style={{
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: EVENT_CIRCLE_COLOR,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 10,
      flexShrink: 0,
    }}>
      {getIcon()}
    </View>
  )
}

// Check if we should show day separator (different day from previous message)
const shouldShowDaySeparator = (currentMessage: ExtendedChatMessage, previousMessage?: IMessage): boolean => {
  if (!previousMessage) {
    // Always show day separator for the first message (oldest message at bottom with inverted list)
    return true
  }
  
  const currentDate = moment(currentMessage.createdAt).startOf('day')
  const previousDate = moment(previousMessage.createdAt).startOf('day')
  
  return !currentDate.isSame(previousDate)
}

// Format date for day separator
const formatDaySeparator = (date: Date): string => {
  return moment(date).format('MMMM D, YYYY h:mm A')
}

const EventCard: React.FC<{ message: ExtendedChatMessage }> = ({ message }) => {
  return (
    <View style={{
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
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <MessageIcon iconType={message.iconType!} isMe={false} />
        <View style={{ flex: 1 }}>
          {message.renderEvent()}
        </View>
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
  }, [message.onDecline])
  
  if (!message.onDetails) {
    return null
  }

  if (message.messageOpensCallbackType === CallbackType.CredentialOffer) {
    return (
      <View style={{
        marginTop: 14,
        marginBottom: 16,
        marginHorizontal: 12,
        paddingVertical: 4,
      }}>
        <Text style={{ color: '#333', fontSize: 14, marginBottom: 14 }}>
          Would you like to accept it?
        </Text>
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
        <Text style={{ 
          color: 'black', 
          fontSize: 14,
          textDecorationLine: 'underline',
        }}>
          {getLinkText()}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ messageProps }) => {
  const { ChatTheme: theme } = useTheme()
  const message = useMemo(() => messageProps.currentMessage as ExtendedChatMessage, [messageProps])
  const previousMessage = messageProps.previousMessage as ExtendedChatMessage | undefined
  if (!message) {
    return null
  }

  const showDaySeparator = useMemo(
    () => shouldShowDaySeparator(message, previousMessage),
    [message, previousMessage]
  )

  const isMe = message.user?._id === Role.me

  const daySeparator = showDaySeparator ? (
    <View style={{ alignItems: 'center', marginVertical: 16 }}>
      <Text style={{ color: DATE_SEPARATOR_COLOR, fontSize: 14, fontWeight: '500' }}>
        {formatDaySeparator(message.createdAt)}
      </Text>
    </View>
  ) : null

  // Event messages (connection, credential, proof) render as centered cards
  if (message.iconType) {
    return (
      <View>
        {daySeparator}
        <EventCard message={message} />
        {(message.iconType === MessageIconType.Credential || 
          message.iconType === MessageIconType.Proof
        ) && (
          <CredentialOfferActions message={message} />
        )}
      </View>
    )
  }

  // Regular chat messages render as left/right bubbles
  return (
    <View>
      {daySeparator}
      <View style={{ flexDirection: 'row', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
        <View style={{ ...theme.containerStyle }}>
          <Bubble
            {...messageProps}
            key={messageProps.key}
            renderUsernameOnMessage={false}
            renderMessageText={() => message.renderEvent()}
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
        </View>
      </View>
    </View>
  )
}
