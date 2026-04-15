/**
 * Biometric Confirmation Modal
 *
 * Bottom sheet modal for VRC biometric confirmation.
 */

import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'

import { hitSlop } from '../../constants'
import { useTheme } from '../../contexts/theme'
import { useBiometricConfirmation } from '../../contexts/biometric-confirmation'
import { loadWalletKey } from '../../services/keychain'
import { testIdWithKey } from '../../utils/testable'
import Button, { ButtonType } from '../buttons/Button'
import { ThemedText } from '../texts/ThemedText'
import SafeAreaModal from './SafeAreaModal'

const BiometricConfirmationModal: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { isModalVisible, pendingRequest, onConfirm, onCancel, onError } = useBiometricConfirmation()
  const [isAuthenticating, setIsAuthenticating] = useState(false)

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
      backgroundColor: ColorPalette.brand.primaryLight || ColorPalette.brand.primary,
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
    counterpartyName: {
      ...TextTheme.headingFour,
      color: ColorPalette.brand.primary,
      textAlign: 'center',
      marginBottom: 16,
    },
    description: {
      ...TextTheme.normal,
      color: TextTheme.modalNormal?.color || TextTheme.normal.color,
      textAlign: 'center',
      marginBottom: 24,
      paddingHorizontal: 16,
    },
    securityNote: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: ColorPalette.notification.info || '#E3F2FD',
      borderRadius: 8,
      padding: 12,
      marginBottom: 24,
    },
    securityNoteText: {
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
    },
    loadingText: {
      ...TextTheme.normal,
      marginLeft: 8,
      color: TextTheme.normal.color,
    },
  })

  const handleConfirmPress = useCallback(async () => {
    if (!pendingRequest) return

    // If skipNativeBiometric is true, hardware signing will trigger its own biometric prompt
    if (pendingRequest.skipNativeBiometric) {
      onConfirm()
      return
    }

    setIsAuthenticating(true)

    try {
      const result = await loadWalletKey(
        t('Biometry.ConfirmRelationship') || 'Confirm Relationship',
        t('Biometry.SignCredentialWith', { name: pendingRequest.counterpartyName }) ||
          `Sign credential with ${pendingRequest.counterpartyName}?`
      )

      if (result) {
        onConfirm()
      } else {
        onError('Biometric authentication was cancelled or failed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      onError(errorMessage)
    } finally {
      setIsAuthenticating(false)
    }
  }, [pendingRequest, t, onConfirm, onError])

  const handleCancelPress = useCallback(() => {
    onCancel()
  }, [onCancel])

  if (!isModalVisible || !pendingRequest) {
    return null
  }

  return (
    <SafeAreaModal transparent={true} visible={isModalVisible} animationType="slide">
      <View style={styles.overlay}>
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeAreaView}>
          {/* Close button */}
          <View style={styles.headerView}>
            <TouchableOpacity
              accessibilityLabel={t('Global.Close')}
              accessibilityRole={'button'}
              testID={testIdWithKey('CloseBiometricModal')}
              onPress={handleCancelPress}
              hitSlop={hitSlop}
              disabled={isAuthenticating}
            >
              <Icon name={'close'} size={28} color={ColorPalette.brand.modalIcon || ColorPalette.grayscale.black} />
            </TouchableOpacity>
          </View>

          <View style={styles.container}>
            <View style={styles.contentContainer}>
              {/* Lock icon */}
              <View style={styles.iconContainer}>
                <Icon name="fingerprint" size={40} color={ColorPalette.brand.primary} />
              </View>

              {/* Title */}
              <ThemedText style={styles.title}>{t('Biometry.ConfirmRelationship') || 'Confirm Relationship'}</ThemedText>

              {/* Counterparty name */}
              <ThemedText style={styles.counterpartyName}>{pendingRequest.counterpartyName}</ThemedText>

              {/* Description */}
              <ThemedText style={styles.description}>
                {t('Biometry.VrcConfirmationDescription') ||
                  "You're about to sign a credential establishing a verified relationship with this contact. This proves you authorized this connection."}
              </ThemedText>

              {/* Security note */}
              <View style={styles.securityNote}>
                <Icon name="security" size={20} color={ColorPalette.notification.infoIcon || '#1976D2'} />
                <ThemedText style={styles.securityNoteText}>
                  {t('Biometry.SecurityNote') ||
                    'Your biometric data never leaves your device. Only you can authorize this signature.'}
                </ThemedText>
              </View>
            </View>

            {/* Buttons */}
            <View style={styles.buttonsContainer}>
              {isAuthenticating ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={ColorPalette.brand.primary} />
                  <ThemedText style={styles.loadingText}>
                    {t('Biometry.Authenticating') || 'Authenticating...'}
                  </ThemedText>
                </View>
              ) : (
                <>
                  <Button
                    title={t('Biometry.ConfirmWithBiometrics') || 'Confirm with Biometrics'}
                    accessibilityLabel={t('Biometry.ConfirmWithBiometrics') || 'Confirm with Biometrics'}
                    testID={testIdWithKey('ConfirmBiometric')}
                    onPress={handleConfirmPress}
                    buttonType={ButtonType.Primary}
                  />
                  <Button
                    title={t('Global.Cancel')}
                    accessibilityLabel={t('Global.Cancel')}
                    testID={testIdWithKey('CancelBiometric')}
                    onPress={handleCancelPress}
                    buttonType={ButtonType.Secondary}
                  />
                </>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  )
}

export default BiometricConfirmationModal
