import { DidCommBasicMessageRepository, DidCommConnectionRecord } from '@credo-ts/didcomm'
import { useAgent, useBasicMessagesByConnectionId, useConnectionById } from '@bifold/react-hooks'
import { useIsFocused, useNavigation } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import { StackNavigationProp, StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GiftedChat, IMessage, MessageProps } from 'react-native-gifted-chat'
import { SafeAreaView } from 'react-native-safe-area-context'

import InfoIcon from '../modules/vrc/components/InfoIcon'
// Temporarily removed for cleaner witness chat UI
// import { WitnessChatBanner } from '../modules/vrc/components/WitnessChatBanner'
import { renderComposer, renderInputToolbar, renderSend } from '../components/chat'
import ActionSlider from '../components/chat/ActionSlider'
import { renderActions } from '../components/chat/ChatActions'
import { ChatMessage, ExtendedChatMessage } from '../components/chat/ChatMessage'
import { useNetwork } from '../contexts/network'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { useChatMessagesByConnection, useVrcFlowInProgress, PROGRESS_MILESTONES } from '../hooks/chat-messages'
import { useConnectionDisplayName } from '../hooks/connections'
import { useWitnessConnection } from '../modules/vrc/context/WitnessConnectionProvider'
import { Role } from '../types/chat'
import { BasicMessageMetadata, basicMessageCustomMetadata } from '../types/metadata'
import { setActiveChatConnectionId } from '../utils/activeChatTracker'
import { RootStackParams, ContactStackParams, Screens, Stacks, TabStacks } from '../types/navigators'
import { Animated, Easing, View, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

const PROGRESS_BAR_WIDTH = 200

const FlowProgressBar: React.FC<{ fraction: number; color: string; complete?: boolean }> = ({ fraction, color, complete }) => {
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
  const { inProgress: vrcFlowInProgress, statusText: vrcStatusText, timedOut: vrcTimedOut, progressFraction, progressComplete, confirmed: vrcConfirmed, onDismissTimeout, onDismissConfirmation } = useVrcFlowInProgress(connectionId)

  // Check if this connection is a witness connection by matching connectionId
  const _isWitnessConnection = connectedWitness?.connectionId === connectionId

  useEffect(() => {
    assertNetworkConnected()
  }, [assertNetworkConnected])

  useEffect(() => {
    setActiveChatConnectionId(connectionId)
    return () => setActiveChatConnectionId(undefined)
  }, [connectionId])

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
  }, [basicMessages, agent])

  const onSend = useCallback(
    async (messages: IMessage[]) => {
      await agent?.modules.didcomm.basicMessages.sendMessage(connectionId, messages[0].text)
    },
    [agent, connectionId]
  )

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
       * KeyboardAvoidingView from react-native-keyboard-controller, NOT from
       * react-native. Two bugs bracket this choice, both seen on device
       * 2026-08-26: RN's version with iOS's default `behavior={undefined}` is
       * inert, so the keyboard covered the composer and the message could not
       * be sent; setting `behavior="padding"` fixed that but then raced the
       * app-wide KeyboardProvider (mounted in app/App.tsx) — padding changed
       * the layout, UIKit recomputed the keyboard frame, which re-rendered and
       * recomputed the padding, ~133 UIKeyboardAutomatic frame events in a
       * single second, and the composer lost keystrokes to the churn.
       * The library's version reads the same animated keyboard values the
       * provider already owns instead of racing UIKit, so there is exactly one
       * source of truth for the offset.
       */}
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: '#F5F5F5' }}
        behavior={'padding'}
        keyboardVerticalOffset={headerHeight}
      >
        <GiftedChat<ExtendedChatMessage>
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
          user={{
            _id: Role.me,
          }}
          renderActions={(props) => renderActions(props, theme, actions)}
          onPressActionButton={actions ? () => setShowActionSlider(true) : undefined}
          listProps={{
            keyboardShouldPersistTaps: 'handled',
            style: { backgroundColor: '#F5F5F5' },
          }}
        />
        {showActionSlider && <ActionSlider onDismiss={onDismiss} actions={actions} />}
        
        {/* VRC exchange flow loading overlay */}
        {vrcFlowInProgress && (
          <View style={styles.flowOverlay} pointerEvents="auto">
            <View style={styles.flowOverlayContent}>
              {vrcConfirmed ? (
                <>
                  <Text style={styles.flowOverlayConfirmIcon}>✓</Text>
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
              ) : (
                <>
                  <Text style={styles.flowOverlayText}>{vrcStatusText}</Text>
                  {progressFraction > 0 && (
                    <FlowProgressBar fraction={progressFraction} color={ColorPalette.brand.primary} complete={progressComplete} />
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
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
  flowOverlayConfirmIcon: {
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
