/**
 * WitnessErrorDialog Component
 *
 * Bottom-sheet modal that appears when a VRC flow operation fails.
 * Gives the user control over how to proceed: Retry, Cancel, or Proceed Without Witness.
 *
 * Uses the same bottom-sheet pattern as BiometricConfirmationModal for visual consistency.
 */

import React from 'react'
import { StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'

import { hitSlop } from '../../../constants'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'

export type WitnessErrorType =
  | 'witness-timeout'
  | 'vp-submission-failed'
  | 'session-timeout'
  | 'counterparty-not-connected'
  | 'biometric-cancelled'
  | 'biometric-failed'
  | 'stale-witness'
  | 'network-error'
  | 'event-not-started'
  | 'event-ended'

export interface WitnessErrorDialogProps {
  visible: boolean
  errorType: WitnessErrorType
  errorMessage?: string
  witnessName?: string
  contactName?: string
  isRetrying?: boolean
  onRetry?: () => void
  onCancel: () => void
  onProceedWithout?: () => void
}

const iconMap: Record<WitnessErrorType, { name: string; tint: 'warning' | 'error' | 'muted' }> = {
  'witness-timeout':           { name: 'schedule',        tint: 'warning' },
  'vp-submission-failed':      { name: 'cloud-off',       tint: 'error' },
  'session-timeout':           { name: 'hourglass-empty', tint: 'warning' },
  'counterparty-not-connected':{ name: 'person-off',      tint: 'warning' },
  'biometric-cancelled':       { name: 'fingerprint',     tint: 'muted' },
  'biometric-failed':          { name: 'fingerprint',     tint: 'error' },
  'stale-witness':             { name: 'link-off',        tint: 'warning' },
  'network-error':             { name: 'wifi-off',        tint: 'error' },
  'event-not-started':         { name: 'event',           tint: 'warning' },
  'event-ended':               { name: 'event-busy',      tint: 'muted' },
}

const getErrorContent = (
  errorType: WitnessErrorType,
  witnessName?: string,
  contactName?: string,
  errorMessage?: string
): {
  title: string
  message: string
  infoMessage: string
  showProceedWithout: boolean
  showRetry: boolean
} => {
  switch (errorType) {
    case 'witness-timeout':
      return {
        title: 'Witness Not Responding',
        message: `The witness${witnessName ? ` "${witnessName}"` : ''} did not respond in time.`,
        infoMessage: 'The witness server may be offline or experiencing high load. You can retry or proceed without witness protection.',
        showProceedWithout: true,
        showRetry: true,
      }
    case 'vp-submission-failed':
      return {
        title: 'Submission Failed',
        message: `Failed to submit credentials to the witness${witnessName ? ` "${witnessName}"` : ''}.`,
        infoMessage: errorMessage || 'A network error occurred while communicating with the witness.',
        showProceedWithout: true,
        showRetry: true,
      }
    case 'session-timeout':
      return {
        title: 'Session Could Not Be Established',
        message: `Could not establish a witness session${witnessName ? ` with "${witnessName}"` : ''}.`,
        infoMessage: 'The witness may be busy or your connection may have been interrupted.',
        showProceedWithout: true,
        showRetry: true,
      }
    case 'counterparty-not-connected':
      return {
        title: 'Contact Not on Witness',
        message: `${contactName || 'Your contact'} does not appear to be connected to${witnessName ? ` "${witnessName}"` : ' the same witness'}.`,
        infoMessage: 'Both parties must be connected to the same witness for a witnessed exchange. You can retry, or proceed without witness verification.',
        showProceedWithout: true,
        showRetry: true,
      }
    case 'biometric-cancelled':
      return {
        title: 'Verification Cancelled',
        message: 'Biometric verification was cancelled.',
        infoMessage: 'The credential was not sent because biometric confirmation is required for hardware-backed signing.',
        showProceedWithout: false,
        showRetry: true,
      }
    case 'biometric-failed':
      return {
        title: 'Verification Failed',
        message: 'Biometric verification failed.',
        infoMessage: errorMessage || 'Please try again. Make sure your fingerprint or face is properly positioned.',
        showProceedWithout: false,
        showRetry: true,
      }
    case 'stale-witness':
      return {
        title: 'Witness Disconnected',
        message: `Your connection to${witnessName ? ` "${witnessName}"` : ' the witness'} has expired.`,
        infoMessage: 'The witness connection timed out or was interrupted. Please reconnect to the witness.',
        showProceedWithout: true,
        showRetry: false,
      }
    case 'event-not-started':
      return {
        title: 'Event Not Started Yet',
        message: errorMessage || `The event hasn't started yet.`,
        infoMessage: `Witnessed exchanges are only available during the event window. You can proceed without witness verification now, or wait until the event begins.`,
        showProceedWithout: true,
        showRetry: false,
      }
    case 'event-ended':
      return {
        title: 'Event Has Ended',
        message: errorMessage || `The witnessing event has ended.`,
        infoMessage: `The event window for witnessed exchanges has closed. You can still exchange credentials without witness verification.`,
        showProceedWithout: true,
        showRetry: false,
      }
    case 'network-error':
    default:
      return {
        title: 'Connection Error',
        message: 'A network error occurred during the exchange.',
        infoMessage: errorMessage || 'Please check your network connection and try again.',
        showProceedWithout: true,
        showRetry: true,
      }
  }
}

const WitnessErrorDialog: React.FC<WitnessErrorDialogProps> = ({
  visible,
  errorType,
  errorMessage,
  witnessName,
  contactName,
  isRetrying = false,
  onRetry,
  onCancel,
  onProceedWithout,
}) => {
  const { ColorPalette, TextTheme } = useTheme()
  const content = getErrorContent(errorType, witnessName, contactName, errorMessage)
  const iconInfo = iconMap[errorType] || iconMap['network-error']

  const tintColors: Record<string, string> = {
    warning: '#f59e0b',
    error: ColorPalette.notification.errorBorder || '#ef4444',
    muted: ColorPalette.grayscale.mediumGrey || '#6b7280',
  }
  const iconColor = tintColors[iconInfo.tint]
  const iconBgColor = `${iconColor}18`

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    safeAreaView: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      borderTopRightRadius: 20,
      borderTopLeftRadius: 20,
    },
    container: {
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    headerView: {
      alignItems: 'flex-end',
      paddingTop: 12,
      paddingRight: 12,
    },
    contentContainer: {
      alignItems: 'center',
      paddingTop: 8,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: iconBgColor,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    title: {
      ...TextTheme.headingThree,
      color: TextTheme.modalTitle?.color || TextTheme.headingThree.color,
      textAlign: 'center',
      marginBottom: 12,
    },
    message: {
      ...TextTheme.normal,
      color: TextTheme.modalNormal?.color || TextTheme.normal.color,
      textAlign: 'center',
      marginBottom: 16,
      paddingHorizontal: 16,
    },
    infoNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: ColorPalette.notification.info || '#E3F2FD',
      borderRadius: 8,
      padding: 12,
      marginBottom: 24,
    },
    infoNoteText: {
      ...TextTheme.normal,
      fontSize: 13,
      color: ColorPalette.notification.infoText || TextTheme.normal.color,
      flex: 1,
      marginLeft: 8,
    },
    buttonsContainer: {
      gap: 12,
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
    },
    loadingText: {
      ...TextTheme.normal,
      marginLeft: 8,
      color: TextTheme.normal.color,
    },
  })

  return (
    <SafeAreaModal transparent={true} visible={visible} animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeAreaView}>
          {/* Close button */}
          <View style={styles.headerView}>
            <TouchableOpacity
              accessibilityLabel="Close"
              accessibilityRole="button"
              testID={testIdWithKey('CloseWitnessErrorModal')}
              onPress={onCancel}
              hitSlop={hitSlop}
              disabled={isRetrying}
            >
              <Icon name="close" size={28} color={ColorPalette.brand.modalIcon || ColorPalette.grayscale.black} />
            </TouchableOpacity>
          </View>

          <View style={styles.container}>
            <View style={styles.contentContainer}>
              {/* Status icon */}
              <View style={styles.iconContainer}>
                <Icon name={iconInfo.name} size={40} color={iconColor} />
              </View>

              {/* Title */}
              <ThemedText style={styles.title}>{content.title}</ThemedText>

              {/* Message */}
              <ThemedText style={styles.message}>{content.message}</ThemedText>

              {/* Info note */}
              <View style={styles.infoNote}>
                <Icon name="info-outline" size={20} color={ColorPalette.notification.infoIcon || '#1976D2'} />
                <ThemedText style={styles.infoNoteText}>{content.infoMessage}</ThemedText>
              </View>
            </View>

            {/* Buttons */}
            <View style={styles.buttonsContainer}>
              {isRetrying ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={ColorPalette.brand.primary} />
                  <ThemedText style={styles.loadingText}>Retrying...</ThemedText>
                </View>
              ) : (
                <>
                  {content.showRetry && onRetry && (
                    <Button
                      title="Retry"
                      accessibilityLabel="Retry"
                      testID={testIdWithKey('WitnessErrorRetry')}
                      onPress={onRetry}
                      buttonType={ButtonType.Primary}
                    />
                  )}
                  <Button
                    title="Cancel"
                    accessibilityLabel="Cancel"
                    testID={testIdWithKey('WitnessErrorCancel')}
                    onPress={onCancel}
                    buttonType={ButtonType.Secondary}
                  />
                  {content.showProceedWithout && onProceedWithout && (
                    <Button
                      title="Proceed Without Witness"
                      accessibilityLabel="Proceed without witness"
                      testID={testIdWithKey('WitnessErrorProceedWithout')}
                      onPress={onProceedWithout}
                      buttonType={ButtonType.ModalCritical}
                    />
                  )}
                </>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default WitnessErrorDialog
