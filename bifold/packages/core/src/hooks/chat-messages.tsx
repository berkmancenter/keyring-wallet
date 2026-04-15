import {
  BasicMessageRecord,
  ConnectionRecord,
  CredentialExchangeRecord,
  CredentialRole,
  CredentialState,
  ProofExchangeRecord,
  ProofState,
  CredentialEventTypes,
  W3cCredentialRecord,
} from '@credo-ts/core'
import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { useBasicMessagesByConnectionId, useAgent } from '@credo-ts/react-hooks'
import { isPresentationReceived } from '@bifold/verifier'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, View, TouchableOpacity, Text } from 'react-native'

import { ChatEvent } from '../components/chat/ChatEvent'
import { ExtendedChatMessage, CallbackType, MessageIconType } from '../components/chat/ChatMessage'
import { useTheme } from '../contexts/theme'
import { useCredentialsByConnectionId } from './credentials'
import { useProofsByConnectionId } from './proofs'
import { useConnectionDisplayName } from './connections'
import { OpenIDCredentialType } from '../modules/openid/types'
import { credentialDisplayRegistry } from '../modules/vrc/display/displayRegistry'
import { useOpenIDCredentials } from '../modules/openid/context/OpenIDCredentialRecordProvider'
import { witnessStatusStore, WitnessStatusMessage, vrcFlowStore, VrcFlowStatus } from '../modules/vrc/witnessStatusStore'
import { useStore } from '../contexts/store'
import { DispatchAction } from '../contexts/reducers/store'
import { Role } from '../types/chat'
import { RootStackParams, ContactStackParams, Screens, Stacks } from '../types/navigators'
import {
  getCredentialEventLabel,
  getCredentialEventRole,
  getMessageEventRole,
  getProofEventLabel,
  getProofEventRole,
} from '../utils/helpers'
import { ThemedText } from '../components/texts/ThemedText'
import { BIOMETRIC_STATUS_MESSAGE_PREFIX } from '../modules/vrc/vrc-biometric'
import { derivePseudonym } from '../utils/pseudonym'
import { testIdWithKey } from '../utils/testable'

/**
 * Transforms VRC biometric status messages into user-friendly text
 * Raw format: vrc:biometric-status:{status}:{timestamp}:{reason}
 * 
 * @param content The raw message content
 * @param t Translation function
 * @returns User-friendly message or null if not a biometric status message
 */
const transformBiometricStatusMessage = (
  content: string,
  t: (key: string) => string
): string | null => {
  if (!content.startsWith(BIOMETRIC_STATUS_MESSAGE_PREFIX)) {
    return null
  }

  // Parse: vrc:biometric-status:{status}:{timestamp}:{reason}
  const parts = content.substring(BIOMETRIC_STATUS_MESSAGE_PREFIX.length).split(':')
  const status = parts[0]

  switch (status) {
    case 'not-verified':
      return t('VrcBiometric.StatusNotVerified')
    case 'error':
      return t('VrcBiometric.StatusError')
    default:
      return t('VrcBiometric.StatusUnknown')
  }
}

/**
 * Hook to get witness credentials routed to this connection's chat.
 * VWCs arrive from the witness but display in the counterparty's chat via routing metadata.
 */
export const useRoutedWitnessCredentials = (connectionId: string): W3cCredentialRecord[] => {
  const { agent } = useAgent()
  const [routedCreds, setRoutedCreds] = useState<W3cCredentialRecord[]>([])
  
  useEffect(() => {
    if (!agent || !connectionId) return
    
    const loadRoutedCredentials = async () => {
      try {
        const allW3cRecords = await agent.w3cCredentials.getAllCredentialRecords()
        
        // Filter for credentials with routing metadata pointing to this connection
        const filtered = allW3cRecords.filter(record => {
          const routing = record.metadata.get('witnessCredentialRouting') as any
          return routing?.displayInConnectionId === connectionId
        })
        
        setRoutedCreds(filtered)
      } catch (error) {
        console.error('[VRC] Error loading routed witness credentials:', error)
      }
    }
    
    loadRoutedCredentials()
    
    // Listen for credential state changes to update
    const handleCredentialChange = () => loadRoutedCredentials()
    agent.events.on(CredentialEventTypes.CredentialStateChanged, handleCredentialChange)
    
    // Also listen for witness status updates (routing metadata is added after credential arrives)
    const handleWitnessStatusUpdate = ({ connectionId: statusConnectionId }: { connectionId: string }) => {
      // Reload when witness-complete status is emitted for this connection
      if (statusConnectionId === connectionId) {
        // Small delay to ensure metadata is persisted before we query
        setTimeout(loadRoutedCredentials, 500)
      }
    }
    witnessStatusStore.on('statusUpdate', handleWitnessStatusUpdate)
    
    return () => {
      agent.events.off(CredentialEventTypes.CredentialStateChanged, handleCredentialChange)
      witnessStatusStore.off('statusUpdate', handleWitnessStatusUpdate)
    }
  }, [agent, connectionId])
  
  return routedCreds
}

/**
 * Hook to get witness status messages for this connection's chat.
 * Provides real-time feedback during witnessed VRC exchange.
 */
export const useWitnessStatusMessages = (connectionId: string): WitnessStatusMessage[] => {
  const [messages, setMessages] = useState<WitnessStatusMessage[]>([])
  
  useEffect(() => {
    if (!connectionId) return
    
    const updateMessages = () => {
      const statuses = witnessStatusStore.getStatuses(connectionId)
      setMessages(statuses)
    }
    
    // Initial load
    updateMessages()
    
    // Subscribe to updates
    witnessStatusStore.on('statusUpdate', updateMessages)
    
    return () => {
      witnessStatusStore.off('statusUpdate', updateMessages)
    }
  }, [connectionId])
  
  return messages
}

/**
 * Hook to detect VRC exchange flow status for loading overlay.
 *
 * Returns:
 * - inProgress: true if overlay should be shown
 * - statusText: text to display in overlay
 * - timedOut: true if the flow timed out (overlay should show error state)
 * - onDismissTimeout: callback to dismiss the timeout error and clear the flow
 *
 * Flow: connect → did peer → witness exchange (if applicable) → offer received
 * Overlay clears when credential offer is received so user can accept.
 * Shows a timeout error with dismiss option if the flow stalls for 60s (non-witnessed)
 * or 120s (witnessed).
 */
export interface VrcFlowOverlayState {
  inProgress: boolean
  statusText: string
  timedOut: boolean
  /** Non-zero when a progress bar should be shown, value = animation duration in ms. */
  progressDurationMs: number
  /** True when the flow just completed — bar should snap to 100% before overlay clears. */
  progressComplete: boolean
  onDismissTimeout: () => void
}

export const FLOW_TIMEOUT_MS_NON_WITNESSED = 60000
export const FLOW_TIMEOUT_MS_WITNESSED = 120000
export const FLOW_HARD_TIMEOUT_MS = 180000

export const useVrcFlowInProgress = (connectionId: string): VrcFlowOverlayState => {
  const [inProgress, setInProgress] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [progressDurationMs, setProgressDurationMs] = useState(0)
  const [progressComplete, setProgressComplete] = useState(false)
  const progressStartedRef = useRef(false)
  const flowStartedAtRef = useRef<number | null>(null)
  const completionTimerRef = useRef<NodeJS.Timeout | null>(null)

  const onDismissTimeout = useCallback(() => {
    if (!connectionId) return
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current)
      completionTimerRef.current = null
    }
    setTimedOut(false)
    setInProgress(false)
    setStatusText('')
    setProgressDurationMs(0)
    setProgressComplete(false)
    progressStartedRef.current = false
    flowStartedAtRef.current = null
    vrcFlowStore.clearFlow(connectionId)
  }, [connectionId])
  
  useEffect(() => {
    if (!connectionId) {
      setInProgress(false)
      setStatusText('')
      setTimedOut(false)
      flowStartedAtRef.current = null
      return
    }
    
    let timeoutId: NodeJS.Timeout | null = null
    
    const checkStatus = () => {
      const flowStatus = vrcFlowStore.getStatus(connectionId)
      const isWitnessed = vrcFlowStore.isWitnessedFlow(connectionId)
      const hasReceivedOffer = vrcFlowStore.hasReceivedOfferFlag(connectionId)
      const isComplete = vrcFlowStore.isExchangeComplete(connectionId)
      
      // Determine if overlay should show
      // Clear overlay when:
      // - 'idle': No active flow
      // - 'offer-received': User has received an offer they can act on
      // - 'offer-sent' AND hasReceivedOffer: Bidirectional exchange complete
      //   (This handles the case where party receives first, sends second - e.g., QR displayer)
      // - isExchangeComplete: Both sent and received offers
      const shouldClearOverlay = 
        flowStatus === 'idle' || 
        flowStatus === 'offer-received' ||
        (flowStatus === 'offer-sent' && hasReceivedOffer) ||
        isComplete
      
      const shouldShowOverlay = !shouldClearOverlay

      if (shouldShowOverlay) {
        if (!flowStartedAtRef.current) {
          flowStartedAtRef.current = Date.now()
        }

        const elapsedMs = Date.now() - flowStartedAtRef.current
        if (elapsedMs >= FLOW_HARD_TIMEOUT_MS) {
          setInProgress(true)
          setTimedOut(true)
          setStatusText("The exchange took too long. You may need to reconnect and try again.")
          return
        }

        // Cancel any pending completion animation
        if (completionTimerRef.current) {
          clearTimeout(completionTimerRef.current)
          completionTimerRef.current = null
        }
        setProgressComplete(false)
        setInProgress(true)

        switch (flowStatus) {
          case 'connecting':
            setStatusText('Establishing connection...')
            break
          case 'witness-active':
            setStatusText(isWitnessed ? 'Witness verification in progress...' : 'Reporting in progress...')
            break
          case 'witness-fallback':
            setStatusText('Witness unavailable. Issuing credential...')
            break
          case 'biometric-fallback':
            setStatusText('Issuing credential without hardware attestation...')
            break
          case 'preparing-offer':
            setStatusText(isWitnessed ? 'Witness verified. Preparing offer...' : 'Preparing credential offer...')
            break
          case 'offer-sent':
            setStatusText('Waiting for counterparty...')
            break
          default:
            setStatusText('Exchange in progress...')
        }

        // Start the progress bar once per overlay session, tied to the safety timeout.
        if (!progressStartedRef.current) {
          progressStartedRef.current = true
          const timeoutMs = isWitnessed ? FLOW_TIMEOUT_MS_WITNESSED : FLOW_TIMEOUT_MS_NON_WITNESSED
          setProgressDurationMs(timeoutMs)
        }
      } else {
        // Flow completed — if bar was running, fill to 100% then clear
        if (progressStartedRef.current) {
          setProgressComplete(true)
          completionTimerRef.current = setTimeout(() => {
            completionTimerRef.current = null
            setInProgress(false)
            setStatusText('')
            setProgressDurationMs(0)
            setProgressComplete(false)
            setTimedOut(false)
            progressStartedRef.current = false
            flowStartedAtRef.current = null
          }, 500)
        } else {
          setInProgress(false)
          setStatusText('')
          setProgressDurationMs(0)
          setProgressComplete(false)
          setTimedOut(false)
          progressStartedRef.current = false
          flowStartedAtRef.current = null
        }
      }
      
      // Set up timeout to show error state if stuck.
      // Witnessed flows need more time (attestation + witness round-trip),
      // so use 120s for witnessed, 60s for non-witnessed.
      if (shouldShowOverlay) {
        if (timeoutId) clearTimeout(timeoutId)
        const timeoutMs = isWitnessed ? FLOW_TIMEOUT_MS_WITNESSED : FLOW_TIMEOUT_MS_NON_WITNESSED
        timeoutId = setTimeout(() => {
          const currentStatus = vrcFlowStore.getStatus(connectionId)
          const currentComplete = vrcFlowStore.isExchangeComplete(connectionId)
          const currentHasReceived = vrcFlowStore.hasReceivedOfferFlag(connectionId)
          const shouldStillBeActive = 
            currentStatus !== 'idle' && 
            currentStatus !== 'offer-received' &&
            !(currentStatus === 'offer-sent' && currentHasReceived) &&
            !currentComplete
          if (shouldStillBeActive) {
            console.warn(`[VRC Flow] Timeout after ${timeoutMs / 1000}s | Status: ${currentStatus} — showing timeout UI`)
            setTimedOut(true)
            setStatusText("The exchange didn't complete. You may need to try connecting again.")
          }
        }, timeoutMs)
      }
    }
    
    // Initial check
    checkStatus()
    
    // Subscribe to updates
    vrcFlowStore.on('flowUpdate', checkStatus)
    
    return () => {
      vrcFlowStore.off('flowUpdate', checkStatus)
      if (timeoutId) clearTimeout(timeoutId)
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
    }
  }, [connectionId])
  
  return { inProgress, statusText, timedOut, progressDurationMs, progressComplete, onDismissTimeout }
}

// Keep legacy hook for backwards compatibility
export const useWitnessFlowInProgress = (connectionId: string): boolean => {
  const { inProgress } = useVrcFlowInProgress(connectionId)
  return inProgress
}

/**
 * Helper function to get display title and subtitle for witness status messages
 * Returns full details (not truncated) for expanded view
 */
function getWitnessStatusDisplay(status: WitnessStatusMessage): { title: string; subtitle?: string } {
  switch (status.status) {
    case 'session-requested':
      return {
        title: 'Witness Session Requested',
        subtitle: `Witness: ${status.witnessName}`,
      }
    case 'session-joined':
      return {
        title: 'Session Joined',
        subtitle: status.sessionId 
          ? `Session ID: ${status.sessionId}` 
          : `Connected to witness: ${status.witnessName}`,
      }
    case 'vp-submitted':
      return {
        title: 'Credential Submitted',
        subtitle: 'Awaiting witness verification...',
      }
    case 'witnessed':
      return {
        title: 'Exchange Witnessed',
        subtitle: `Verified by: ${status.witnessName}`,
      }
    case 'witness-complete':
      return {
        title: 'Witness Attestation Received',
        subtitle: `From: ${status.witnessName}`,
      }
    case 'witness-skipped':
      return {
        title: 'Witness Verification Skipped',
        subtitle: status.errorMessage || 'Contact not connected to witness',
      }
    case 'error':
      return {
        title: 'Witness Flow Error',
        subtitle: status.errorMessage || 'An error occurred during witness verification',
      }
    default:
      return {
        title: 'Witness Status',
        subtitle: status.witnessName,
      }
  }
}

/**
 * Determines the callback to be called when the button below a given chat message is pressed, if it exists.
 *
 * eg. 'View offer' -> opens the credential offer screen
 *
 * @param {CredentialExchangeRecord | ProofExchangeRecord} record - The record to determine the callback type for.
 * @returns {CallbackType} The callback type for the given record.
 */
const callbackTypeForMessage = (record: CredentialExchangeRecord | ProofExchangeRecord) => {
  // For credentials in OfferReceived state, show "View offer" button to accept
  // For credentials in Done state, don't set a specific callback type (will show "Full Contact details")
  if (record instanceof CredentialExchangeRecord) {
    if (record.state === CredentialState.OfferReceived) {
      return CallbackType.CredentialOffer
    }
    // Credentials in Done state return undefined - will show "Full Contact details"
    return undefined
  }

  // All proof-related checks below - only for ProofExchangeRecord
  if (record instanceof ProofExchangeRecord) {
    if (
      (isPresentationReceived(record) && record.isVerified !== undefined) ||
      record.state === ProofState.RequestReceived ||
      (record.state === ProofState.Done && record.isVerified === undefined)
    ) {
      return CallbackType.ProofRequest
    }

    if (record.state === ProofState.PresentationSent || record.state === ProofState.Done) {
      return CallbackType.PresentationSent
    }
  }

  return undefined
}

/**
 * Custom hook for retrieving chat messages for a given connection. This hook includes some of
 * the JSX for rendering the chat messages, including the logic for handling links in messages.
 *
 * @param {ConnectionRecord} connection - The connection to retrieve chat messages for.
 * @returns {ExtendedChatMessage[]} The chat messages for the given connection.
 */
/**
 * Workaround for a stale-closure bug in @credo-ts/react-hooks BasicMessageProvider.
 * The subscription callback captures `state` from closure instead of using a functional
 * updater, so rapid-fire messages overwrite each other and get lost. This hook
 * supplements the subscription with periodic DB queries via the public API.
 */
const useReliableBasicMessages = (connectionId: string | undefined): BasicMessageRecord[] => {
  const subscriptionMessages = useBasicMessagesByConnectionId(connectionId ?? '')
  const { agent } = useAgent()
  const [dbMessages, setDbMessages] = useState<BasicMessageRecord[]>([])
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchFromDb = useCallback(async () => {
    if (!agent || !connectionId) return
    try {
      const records = await agent.basicMessages.findAllByQuery({ connectionId })
      setDbMessages(records)
    } catch {
      // Silently fail — subscription data is still available
    }
  }, [agent, connectionId])

  useEffect(() => {
    fetchFromDb()
  }, [fetchFromDb])

  // Re-fetch shortly after subscription updates to catch any gap
  useEffect(() => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(() => fetchFromDb(), 1000)
    return () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    }
  }, [subscriptionMessages.length, fetchFromDb])

  // Aggressive poll for the first 20s (every 3s), then stop
  useEffect(() => {
    let count = 0
    const interval = setInterval(() => {
      count++
      fetchFromDb()
      if (count >= 7) clearInterval(interval)
    }, 3000)
    return () => clearInterval(interval)
  }, [fetchFromDb])

  const merged = React.useMemo(() => {
    const byId = new Map<string, BasicMessageRecord>()
    for (const r of subscriptionMessages) byId.set(r.id, r)
    for (const r of dbMessages) {
      if (!byId.has(r.id)) byId.set(r.id, r)
    }
    return Array.from(byId.values())
  }, [subscriptionMessages, dbMessages])

  return merged
}

const areChatMessagesEqual = (a: ExtendedChatMessage[], b: ExtendedChatMessage[]): boolean => {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    const current = a[i]
    const next = b[i]

    if (
      current._id !== next._id ||
      current.text !== next.text ||
      current.iconType !== next.iconType ||
      current.messageOpensCallbackType !== next.messageOpensCallbackType ||
      current.user?._id !== next.user?._id ||
      current.createdAt?.getTime?.() !== next.createdAt?.getTime?.()
    ) {
      return false
    }
  }

  return true
}

export const useChatMessagesByConnection = (connection: ConnectionRecord): ExtendedChatMessage[] => {
  const [messages, setMessages] = useState<Array<ExtendedChatMessage>>([])
  const latestMessagesRef = useRef<Array<ExtendedChatMessage>>([])
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ChatTheme: theme, ColorPalette } = useTheme()
  const [store] = useStore()
  const reportingEnabled = store.witness?.enableReporting ?? true
  const navigation = useNavigation<StackNavigationProp<RootStackParams | ContactStackParams>>()
  const basicMessages = useReliableBasicMessages(connection?.id)
  const credentials = useCredentialsByConnectionId(connection?.id)
  const proofs = useProofsByConnectionId(connection?.id)
  const theirLabel = useConnectionDisplayName(connection?.id)
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()

  useEffect(() => {
    const transformedMessages: Array<ExtendedChatMessage> = (basicMessages.map((record: BasicMessageRecord) => {
      const role = getMessageEventRole(record)

      // Hide all JSON protocol messages (witness-announcement, session-challenge,
      // reporting-did-registration, etc.) from the chat UI — they are verbose protocol noise.
      try {
        const parsed = JSON.parse(record.content)
        if (parsed && typeof parsed === 'object' && parsed.type) {
          // Reporting Pseudonym registration — show as a styled event message
          if (parsed.type === 'reporting-did-registration' && typeof parsed.reportingDid === 'string') {
            const baseTextStyle = role === Role.me ? theme.rightText : theme.leftText
            const textStyle = { ...baseTextStyle, color: '#333333' }
            const dotColor = reportingEnabled ? ColorPalette.semantic.success : ColorPalette.grayscale.mediumGrey
            const statusLabel = reportingEnabled ? t('Chat.ReportingStatusOn') : t('Chat.ReportingStatusOff')
            const capturedDid: string = parsed.reportingDid
            const pseudonym = derivePseudonym(capturedDid)

            const renderStatusBadge = () => (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: dotColor,
                    marginRight: 6,
                  }}
                />
                <ThemedText style={[textStyle, { fontSize: 14 }]}>{statusLabel}</ThemedText>
              </View>
            )

            return {
              _id: record.id,
              text: `${t('Chat.ReportingPseudonymTitle')}|${statusLabel}`,
              // Collapsed: bold title + pseudonym + live status badge
              collapsedContent: () => (
                <View>
                  <ThemedText style={[textStyle, { fontWeight: 'bold' }]}>
                    {t('Chat.ReportingPseudonymTitle')}
                  </ThemedText>
                  <ThemedText style={[textStyle, { fontStyle: 'italic' }]}>
                    {pseudonym}
                  </ThemedText>
                  {renderStatusBadge()}
                </View>
              ),
              renderEvent: () => (
                <View>
                  <ThemedText style={[textStyle, { fontWeight: 'bold' }]}>
                    {t('Chat.ReportingPseudonymTitle')}
                  </ThemedText>
                  <ThemedText style={[textStyle, { fontStyle: 'italic' }]}>
                    {pseudonym}
                  </ThemedText>
                  <ThemedText style={textStyle}>
                    {t('Chat.ReportingPseudonymRegisteredSuffix', { name: theirLabel })}
                  </ThemedText>
                  {renderStatusBadge()}
                </View>
              ),
              createdAt: record.createdAt,
              type: record.type,
              user: { _id: role },
              iconType: MessageIconType.ReportingDID,
              relationshipDid: capturedDid,
            } as ExtendedChatMessage
          }

          // All other JSON protocol messages are hidden
          return null
        }
      } catch {
        // Not JSON — continue to regular message handling below
      }

      // Hide VRC relationship DID exchange messages — verbose protocol noise
      if (record.content.includes('vrc:relationshipDid:')) {
        return null
      }

      // Check if this is a VRC biometric status message and transform it
      const biometricMessage = transformBiometricStatusMessage(record.content, t)
      const displayContent = biometricMessage || record.content

      // Regular text message handling
      // eslint-disable-next-line
      const linkRegex = /(?:https?\:\/\/\w+(?:\.\w+)+\S*)|(?:[\w\d\.\_\-]+@\w+(?:\.\w+)+)/gim
      // eslint-disable-next-line
      const mailRegex = /^[\w\d\.\_\-]+@\w+(?:\.\w+)+$/gim
      const links = displayContent.match(linkRegex) ?? []
      const handleLinkPress = (link: string) => {
        if (link.match(mailRegex)) {
          link = 'mailto:' + link
        }
        Linking.openURL(link)
      }
      const textStyle = role === Role.me ? theme.rightText : theme.leftText
      const msgText = (
        <ThemedText style={textStyle}>
          {displayContent.split(linkRegex).map((split, i) => {
            if (i < links.length) {
              const link = links[i]
              return (
                <Fragment key={`${record.id}-${i}`}>
                  <ThemedText style={textStyle}>{split}</ThemedText>
                  <ThemedText
                    onPress={() => handleLinkPress(link)}
                    style={{ color: ColorPalette.brand.link, textDecorationLine: 'underline' }}
                    accessibilityRole={'link'}
                  >
                    {link}
                  </ThemedText>
                </Fragment>
              )
            }
            return (
              <ThemedText key={`${record.id}-${i}`} style={textStyle}>
                {split}
              </ThemedText>
            )
          })}
        </ThemedText>
      )

      return {
        _id: record.id,
        text: displayContent,
        renderEvent: () => msgText,
        createdAt: record.createdAt,
        type: record.type,
        user: { _id: role },
      }
    }) as Array<ExtendedChatMessage | null>).filter((msg): msg is ExtendedChatMessage => msg !== null)

    // Filter credentials: show OfferReceived (needs action) and Done (completed) states
    // Only show where user is HOLDER. Handles both AnonCreds and W3C/JSON-LD credentials.
    // Witness connection credentials get simplified display (full details in Contact Details).
    const actionableCredentials = credentials.filter(
      (record: CredentialExchangeRecord) => {
        // Base filter: only show actionable states where user is HOLDER
        const isActionableState = record.state === CredentialState.Done || record.state === CredentialState.OfferReceived
        const isHolder = record.role === CredentialRole.Holder
        
        if (!isActionableState || !isHolder) {
          return false
        }
        
        // All credentials pass through - witness connection credentials get special handling below
        return true
      }
    )

    transformedMessages.push(
      ...actionableCredentials.map((record: CredentialExchangeRecord) => {
        const role = getCredentialEventRole(record)
        const actionLabel = t(getCredentialEventLabel(record) as any)

        const isJsonLdCredential = record.credentials.some((cred) => cred.credentialRecordType === 'w3c')

        // Resolve the W3C credential record (if any) to check its type
        let resolvedW3cCred: any = undefined
        let isVrcCredential = false
        if (isJsonLdCredential) {
          const w3cCredRecord = record.credentials.find((cred) => cred.credentialRecordType === 'w3c')
          if (w3cCredRecord) {
            resolvedW3cCred = w3cCredentialRecords.find((cred) => cred.id === w3cCredRecord.credentialRecordId)
            if (resolvedW3cCred?.credential) {
              const types = Array.isArray(resolvedW3cCred.credential.type)
                ? resolvedW3cCred.credential.type
                : [resolvedW3cCred.credential.type]
              isVrcCredential = types.some(
                (t: string) =>
                  t.includes('DTGCredential') || t.includes('RelationshipCredential') || t.includes('RCardTemplate')
              )
            }
          }
        }

        let chatOfferTitleKey = 'Chat.CredentialOfferTitle'
        let chatReceivedTitleKey = 'Chat.CredentialReceivedTitle'

        if (isJsonLdCredential && resolvedW3cCred?.credential) {
          const terminology = credentialDisplayRegistry.getTerminology(resolvedW3cCred.credential as any)
          chatOfferTitleKey = terminology.chatOfferTitle
          chatReceivedTitleKey = terminology.chatReceivedTitle
        }

        let eventTitle: string
        let eventSubtitle: string | undefined

        if (record.state === CredentialState.OfferReceived) {
          eventTitle = theirLabel
          eventSubtitle = ` — ${t(chatOfferTitleKey as any)}`
        } else {
          eventTitle = t(chatReceivedTitleKey as any)
          eventSubtitle = ` ${t('Chat.CredentialFromSuffix', { name: theirLabel })}`
        }

        const handleViewDetails = () => {
          if (isVrcCredential && resolvedW3cCred?.credential) {
            // VRC credentials navigate to contact details
            const cred = resolvedW3cCred.credential as any
            const issuer = typeof cred.issuer === 'string' 
              ? { id: cred.issuer, name: undefined, email: undefined, organization: undefined }
              : { 
                  id: cred.issuer?.id, 
                  name: cred.issuer?.name,
                  email: cred.issuer?.email,
                  organization: cred.issuer?.organization,
                }
            
            if (issuer.id) {
              navigation.navigate(Stacks.ContactStack as any, {
                screen: Screens.ContactDetails,
                params: {
                  contact: {
                    issuer: {
                      id: issuer.id,
                      name: issuer.name || `Unknown ...${issuer.id.slice(-8)}`,
                      email: issuer.email,
                      organization: issuer.organization,
                    },
                  },
                },
              })
              return
            }
          } else if (isJsonLdCredential && resolvedW3cCred) {
            // W3C credential with a binding - but check if it's actually an AnonCreds
            // credential stored with a W3C binding (has AnonCreds metadata on the exchange record)
            const hasAnonCredsMetadata = !!record.metadata.get(AnonCredsCredentialMetadataKey)
            if (!hasAnonCredsMetadata && !isVrcCredential) {
              // Pure W3C/OpenID credential - navigate to OpenID details
              navigation.navigate(Screens.OpenIDCredentialDetails as any, {
                credentialId: resolvedW3cCred.id,
                type: OpenIDCredentialType.W3cCredential,
              })
              return
            }
          }
          // AnonCreds (including those with W3C bindings) or fallback
          navigation.navigate(Stacks.ContactStack as any, {
            screen: Screens.CredentialDetails,
            params: { credentialId: record.id },
          })
        }

        return {
          _id: record.id,
          text: record.state === CredentialState.OfferReceived
            ? `${theirLabel} — ${t(chatOfferTitleKey as any)}`
            : `${t(chatReceivedTitleKey as any)} ${t('Chat.CredentialFromSuffix', { name: theirLabel })}`,
          renderEvent: () => (
            <View>
              <ChatEvent
                role={Role.them}
                prefix=""
                title={eventTitle}
                subtitle={eventSubtitle}
              />
              {record.state === CredentialState.Done && (
                <TouchableOpacity onPress={handleViewDetails} style={{ marginTop: 8 }}>
                  <Text style={{ color: 'black', fontSize: 14, textDecorationLine: 'underline' }}>
                    {isVrcCredential ? t('Chat.FullContactDetails') : t('Chat.Details')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ),
          createdAt: record.createdAt,
          type: record.type,
          user: { _id: Role.them },
          iconType: MessageIconType.Credential,
          messageOpensCallbackType: callbackTypeForMessage(record),
          // Only set onDetails for OfferReceived — the Done state link is now inside renderEvent
          onDetails: record.state === CredentialState.OfferReceived ? () => {
            if (navigation.getParent()) {
              navigation.getParent()?.navigate(Stacks.ConnectionStack, {
                screen: Screens.Connection,
                params: { credentialId: record.id },
              })
            } else {
              navigation.navigate(Stacks.ConnectionStack as any, {
                screen: Screens.Connection,
                params: { credentialId: record.id },
              })
            }
          } : undefined,
          onDecline: record.state === CredentialState.OfferReceived ? async () => {
            try {
              if (agent) {
                const connectionId = record.connectionId ?? ''
                const connection = await agent.connections.findById(connectionId)
                await agent.credentials.declineOffer(record.id)
                if (connection) {
                  await agent.credentials.sendProblemReport({
                    credentialRecordId: record.id,
                    description: t('CredentialOffer.Declined'),
                  })
                }
              }
            } catch (err: unknown) {
              // eslint-disable-next-line no-console
              console.warn('Failed to decline credential offer:', err)
            }
          } : undefined,
        }
      })
    )

    transformedMessages.push(
      ...proofs.map((record: ProofExchangeRecord) => {
        const role = getProofEventRole(record)
        const userLabel = role === Role.me ? t('Chat.UserYou') : theirLabel
        const actionLabel = t(getProofEventLabel(record) as any)

        return {
          _id: record.id,
          text: actionLabel,
          renderEvent: () => <ChatEvent role={Role.them} userLabel={userLabel} actionLabel={actionLabel} />,
          createdAt: record.createdAt,
          type: record.type,
          user: { _id: Role.them },
          iconType: MessageIconType.Proof,
          messageOpensCallbackType: callbackTypeForMessage(record),
          onDetails: () => {
            const toProofDetails = () => {
              navigation.navigate(Stacks.ContactStack as any, {
                screen: Screens.ProofDetails,
                params: {
                  recordId: record.id,
                  isHistory: true,
                  senderReview:
                    record.state === ProofState.PresentationSent ||
                    (record.state === ProofState.Done && record.isVerified === undefined),
                },
              })
            }
            const navMap: { [key in ProofState]?: () => void } = {
              [ProofState.Done]: toProofDetails,
              [ProofState.PresentationSent]: toProofDetails,
              [ProofState.PresentationReceived]: toProofDetails,
              [ProofState.RequestReceived]: () => {
                // if we are in the contact stack, use the parent navigator
                if (navigation.getParent()) {
                  navigation.getParent()?.navigate(Stacks.ConnectionStack, {
                    screen: Screens.Connection,
                    params: { proofId: record.id },
                  })
                } else {
                  // if we are in the root stack, use the current navigator
                  navigation.navigate(Stacks.ConnectionStack as any, {
                    screen: Screens.Connection,
                    params: { proofId: record.id },
                  })
                }
              },
            }
            const nav = navMap[record.state]
            if (nav) {
              nav()
            }
          },
        }
      })
    )

    const connectedMessage = connection
      ? {
          _id: 'connected',
          text: `You connected with ${theirLabel} and can now message securely`,
          renderEvent: () => (
            <ChatEvent
              role={Role.them}
              prefix="You connected with "
              title={theirLabel}
              subtitle=" and can now message securely"
            />
          ),
          createdAt: connection.createdAt,
          user: { _id: Role.them },
          iconType: MessageIconType.Connection,
        }
      : undefined

    const finalMessages = transformedMessages.sort((a: any, b: any) => b.createdAt - a.createdAt)

    // Witness chat: only show text messages, connected card, and reporting pseudonym card.
    // Credential/proof event bubbles are redundant noise in the witness chat.
    // Regular chats: show everything including credential/proof events.
    const isWitnessConnection = store.witness?.activeWitnessConnectionId === connection?.id
    const displayMessages = isWitnessConnection
      ? finalMessages.filter((msg: ExtendedChatMessage) =>
          msg.iconType !== MessageIconType.Credential && msg.iconType !== MessageIconType.Proof
        )
      : finalMessages

    const result = connectedMessage ? [...displayMessages, connectedMessage] : displayMessages
    if (!areChatMessagesEqual(latestMessagesRef.current, result)) {
      latestMessagesRef.current = result
      setMessages(result)
    }
  }, [
    ColorPalette,
    agent,
    basicMessages,
    theme,
    credentials,
    t,
    navigation,
    proofs,
    theirLabel,
    connection,
    w3cCredentialRecords,
    store,
    reportingEnabled,
  ])

  return messages
}
