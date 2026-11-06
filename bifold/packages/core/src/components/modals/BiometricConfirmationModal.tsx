/**
 * Biometric Confirmation Modal
 *
 * Bottom sheet modal for VRC biometric confirmation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'

import { hitSlop } from '../../constants'
import { TOKENS, useServices } from '../../container-api'
import { useAuth } from '../../contexts/auth'
import { useTheme } from '../../contexts/theme'
import { useBiometricConfirmation } from '../../contexts/biometric-confirmation'
import { PINEntryUsage } from '../../screens/PINVerify'
import { loadWalletKey } from '../../services/keychain'
import { testIdWithKey } from '../../utils/testable'
import Button, { ButtonType } from '../buttons/Button'
import { ThemedText } from '../texts/ThemedText'
import SafeAreaModal from './SafeAreaModal'
import VerifyPINModal from './VerifyPINModal'

const LOG_PREFIX = '[VRC:Biometric]'

const BiometricConfirmationModal: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { isModalVisible, pendingRequest, onConfirm, onCancel, onError } = useBiometricConfirmation()
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const insets = useSafeAreaInsets()
  // Outside an AuthProvider (a test, a host that mounts none) there is no PIN to check.
  const walletSecret = useAuth()?.walletSecret
  const [logger] = useServices([TOKENS.UTIL_LOGGER])
  // The biometric key was not there: the sheet stays and offers the Keyring PIN.
  const [pinAfterMissingKey, setPinAfterMissingKey] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [pinUnavailable, setPinUnavailable] = useState(false)

  // Each request starts on its own sheet.
  useEffect(() => {
    setPinAfterMissingKey(false)
    setPinOpen(false)
    setPinUnavailable(false)
  }, [pendingRequest])

  const isPasscodeMode = pendingRequest?.authMode === 'passcode'
  const isHardwareSigningFlow = pendingRequest?.skipNativeBiometric === true
  // With Biometric Unlock off in Keyring the app has removed the key Face ID or
  // a fingerprint would open, so the person confirms with the Keyring PIN (IN-452).
  const isKeyringPinMode =
    !isHardwareSigningFlow &&
    (pendingRequest?.authMode === 'keyringPin' ||
      pendingRequest?.authMode === 'keyringPinNoBiometrics' ||
      pinAfterMissingKey)

  const noBiometrics = pendingRequest?.authMode === 'keyringPinNoBiometrics'

  const modalCopy = useMemo(() => {
    if (isKeyringPinMode) {
      return {
        // On a phone with no biometrics, "Biometric Unlock is off" would point at a switch that
        // cannot be turned on: the words say what the phone lacks instead.
        securityNote: pinUnavailable
          ? t(noBiometrics ? 'Biometry.ConfirmPinUnavailableNoBiometrics' : 'Biometry.ConfirmPinUnavailable')
          : pinAfterMissingKey
            ? t('Biometry.ConfirmPinAfterMissingKey')
            : t(noBiometrics ? 'Biometry.ConfirmPinNoBiometricsNote' : 'Biometry.ConfirmPinNote'),
        confirmLabel: t('Biometry.ConfirmWithKeyringPIN'),
      }
    }
    if (isPasscodeMode) {
      const securityNote =
        Platform.OS === 'ios'
          ? 'Biometrics are off in this app. Face ID or your device passcode may appear — tap Enter Passcode if needed. The signing key stays in secure hardware.'
          : 'Your device passcode will authorize this signature. The signing key stays in secure hardware.'

      return {
        securityNote,
        confirmLabel: isHardwareSigningFlow ? 'Continue' : 'Confirm with Device Passcode',
      }
    }

    return {
      securityNote: String(
        t('Biometry.SecurityNote') ||
          'Your biometric data never leaves your device. Only you can authorize this signature.'
      ),
      confirmLabel: String(t('Biometry.ConfirmWithBiometrics') || 'Confirm with Biometrics'),
    }
  }, [isHardwareSigningFlow, isKeyringPinMode, isPasscodeMode, noBiometrics, pinAfterMissingKey, pinUnavailable, t])

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

  // The PIN is checked against the wallet secret the unlocked app holds; without
  // it, a PIN could not be told right from wrong, so the sheet says so instead.
  const openPin = useCallback(() => {
    if (!walletSecret) {
      logger.info(`${LOG_PREFIX} confirm: the Keyring PIN cannot be checked here`)
      setPinUnavailable(true)
      return
    }
    setPinOpen(true)
  }, [logger, walletSecret])

  const onPinChecked = useCallback(
    (verified?: unknown) => {
      // PINVerify reports false when its wrong-PIN notice is closed: the entry stays open.
      if (verified !== true) return
      setPinOpen(false)
      logger.info(`${LOG_PREFIX} confirm: confirmed with the Keyring PIN`)
      onConfirm()
    },
    [logger, onConfirm]
  )

  const handleConfirmPress = useCallback(async () => {
    if (!pendingRequest) return

    // If skipNativeBiometric is true, hardware signing will trigger its own biometric/passcode prompt
    if (pendingRequest.skipNativeBiometric) {
      onConfirm()
      return
    }

    if (isKeyringPinMode) {
      openPin()
      return
    }

    setIsAuthenticating(true)

    try {
      // The system prompt says what the caller says is being signed, like the
      // sheet above it; "Confirm Relationship" was wrong for a vetting or a join.
      const result = await loadWalletKey(
        pendingRequest.copy?.title ?? (t('Biometry.ConfirmRelationship') || 'Confirm Relationship'),
        pendingRequest.copy?.description ??
          (t('Biometry.SignCredentialWith', { name: pendingRequest.counterpartyName }) ||
            `Sign credential with ${pendingRequest.counterpartyName}?`)
      )

      if (result) {
        onConfirm()
      } else if (walletSecret) {
        // The keychain answers "nothing here" only when the biometric copy of the
        // key is gone (it rejects on a cancel or a failed scan): no prompt was
        // shown, so closing would look like nothing happened. Offer the PIN.
        logger.info(`${LOG_PREFIX} confirm: the biometric key is not there, offering the Keyring PIN`)
        setPinAfterMissingKey(true)
      } else {
        logger.info(`${LOG_PREFIX} confirm: the biometric key is not there and the PIN cannot be checked`)
        onError('Authentication was cancelled or failed')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      onError(errorMessage)
    } finally {
      setIsAuthenticating(false)
    }
  }, [pendingRequest, t, onConfirm, onError, isKeyringPinMode, openPin, walletSecret, logger])

  const handleCancelPress = useCallback(() => {
    onCancel()
  }, [onCancel])

  if (!isModalVisible || !pendingRequest) {
    return null
  }

  return (
    <SafeAreaModal transparent={true} visible={isModalVisible} animationType="slide">
      {/* At a large text size the sheet is taller than the screen: it stops below the status bar and
          scrolls, so the title is never pushed off the top, and the buttons are reached past the words. */}
      <View style={[styles.overlay, { paddingTop: insets.top }]}>
        <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safeAreaView, { maxHeight: '100%' }]}>
          <ScrollView bounces={false} testID={testIdWithKey('BiometricConfirmationScroll')}>
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
                {/* Auth icon */}
                <View style={styles.iconContainer}>
                  <Icon
                    name={isPasscodeMode || isKeyringPinMode ? 'lock' : 'fingerprint'}
                    size={40}
                    color={ColorPalette.brand.primary}
                  />
                </View>

                <ThemedText style={styles.title}>
                  {pendingRequest.copy?.title ?? String(t('Biometry.ConfirmRelationship') || 'Confirm Relationship')}
                </ThemedText>

                {/* A name, when there is one: a stand-in like "your vetter" read as
                  one on the sheet (219), so a caller with no name passes none. */}
                {pendingRequest.counterpartyName ? (
                  <ThemedText style={styles.counterpartyName}>{pendingRequest.counterpartyName}</ThemedText>
                ) : null}

                <ThemedText style={styles.description}>
                  {pendingRequest.copy?.description ??
                    String(
                      t('Biometry.VrcConfirmationDescription') ||
                        "You're about to sign a credential establishing a verified relationship with this contact. This proves you authorized this connection."
                    )}
                </ThemedText>

                <View style={styles.securityNote}>
                  <Icon name="security" size={20} color={ColorPalette.notification.infoIcon || '#1976D2'} />
                  <ThemedText style={styles.securityNoteText}>{modalCopy.securityNote}</ThemedText>
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
                    {pinUnavailable ? null : (
                      <Button
                        title={modalCopy.confirmLabel}
                        accessibilityLabel={modalCopy.confirmLabel}
                        testID={testIdWithKey('ConfirmBiometric')}
                        onPress={handleConfirmPress}
                        buttonType={ButtonType.Primary}
                      />
                    )}
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
          </ScrollView>
        </SafeAreaView>
      </View>
      {/* Inside the sheet's own modal: iOS will not present a second modal while this one is up. */}
      <VerifyPINModal
        title={pendingRequest.copy?.title ?? String(t('Biometry.ConfirmRelationship') || 'Confirm Relationship')}
        visible={pinOpen}
        PINVerifyModalUsage={PINEntryUsage.ConfirmAction}
        onAuthenticationComplete={onPinChecked}
        onBackPressed={() => setPinOpen(false)}
        onCancelAuth={() => setPinOpen(false)}
      />
    </SafeAreaModal>
  )
}

export default BiometricConfirmationModal
