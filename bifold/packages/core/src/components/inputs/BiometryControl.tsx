import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  AppState,
  DeviceEventEmitter,
} from 'react-native'
import { check, PERMISSIONS, PermissionStatus, request, RESULTS } from 'react-native-permissions'
import Keychain, { getSupportedBiometryType, BIOMETRY_TYPE } from 'react-native-keychain'
import { SafeAreaView } from 'react-native-safe-area-context'

import ToggleButton from '../buttons/ToggleButton'
import DismissiblePopupModal from '../modals/DismissiblePopupModal'
import { ThemedText } from '../texts/ThemedText'
import { useAuth } from '../../contexts/auth'
import { useTheme } from '../../contexts/theme'
import { testIdWithKey } from '../../utils/testable'
import { BifoldError } from '../../types/error'
import { EventTypes } from '../../constants'
import { confirmBiometricKeychainAccess } from '../../services/keychain'

const BIOMETRY_PERMISSION = PERMISSIONS.IOS.FACE_ID

/**
 * Whether the phone has Face ID but Keyring is not allowed to use it. react-native-permissions reads BLOCKED exactly
 * then: the device reports Face ID as its biometry, and evaluating it fails with "biometry not available" (the app's
 * permission is off). A phone with no Face ID, or none enrolled, reads UNAVAILABLE. iOS only: Android has no
 * per-app biometrics permission. Read only when biometrics read as unavailable, to explain why.
 */
export const readFaceIdNotAllowed = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios') return false
  try {
    return (await check(BIOMETRY_PERMISSION)) === RESULTS.BLOCKED
  } catch {
    return false
  }
}

export interface BiometryControlProps {
  biometryEnabled: boolean
  onBiometryToggle: (newValue: boolean) => void
  /** Onboarding: say, under the switch, that turning it on is recommended and why. */
  recommend?: boolean
  children?: React.ReactNode
}

const BiometryControl: React.FC<BiometryControlProps> = ({
  biometryEnabled,
  onBiometryToggle,
  recommend,
  children,
}) => {
  const { t } = useTranslation()
  const { isBiometricsActive } = useAuth()
  const [biometryAvailable, setBiometryAvailable] = useState(false)
  // The phone has Face ID, but Keyring is not allowed to use it (iOS Settings › Keyring › Face ID is off). Without
  // this the screen said biometrics were not set up on the device, which sent people to the wrong setting (IN-550).
  const [faceIdNotAllowed, setFaceIdNotAllowed] = useState(false)
  // action: the popup's button. The "allow Face ID" popups are iOS-only and name iOS's Settings app; the "set up
  // biometrics" one is reached on Android too, so it keeps the platform-neutral label.
  const [settingsPopupConfig, setSettingsPopupConfig] = useState<null | {
    title: string
    description: string
    action: string
  }>(null)
  const [notConfirmedPopup, setNotConfirmedPopup] = useState(false)
  // While Face ID is being confirmed the switch is dimmed and ignores taps: it
  // shows the check is running, and a second tap would start a second probe on
  // the same keychain item and fail the first.
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const { ColorPalette, Assets, Spacing } = useTheme()

  const styles = StyleSheet.create({
    container: {
      flexGrow: 1,
      padding: Spacing.md,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    image: {
      minWidth: 200,
      minHeight: 200,
      marginBottom: 66,
    },
    biometryAvailableRowGap: {
      rowGap: Spacing.md,
    },
    settingsLink: {
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
  })

  useEffect(() => {
    isBiometricsActive()
      .then(async (res) => {
        setBiometryAvailable(res)
        setFaceIdNotAllowed(res ? false : await readFaceIdNotAllowed())
      })
      .catch((err) => {
        const error = new BifoldError(
          t('Error.Title1050'),
          t('Error.Message1050'),
          (err as Error)?.message ?? err,
          1050
        )
        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
      })
  }, [isBiometricsActive, t])

  useEffect(() => {
    const checkBiometrics = async () => {
      try {
        const active = await Keychain.getSupportedBiometryType()
        setBiometryAvailable(Boolean(active))
        setFaceIdNotAllowed(active ? false : await readFaceIdNotAllowed())
      } catch (err) {
        const error = new BifoldError(
          t('Error.Title1050'),
          t('Error.Message1050'),
          (err as Error)?.message ?? err,
          1050
        )
        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
      }
    }

    const appStateListener = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        await checkBiometrics()
      }
    })

    return () => {
      appStateListener.remove()
    }
  }, [isBiometricsActive, setBiometryAvailable, t])

  const onOpenSettingsTouched = async () => {
    await Linking.openSettings()
    onOpenSettingsDismissed()
  }

  const onOpenSettingsDismissed = () => {
    setSettingsPopupConfig(null)
  }

  const onRequestSystemBiometrics = useCallback(
    async (newToggleValue: boolean) => {
      const permissionResult: PermissionStatus = await request(BIOMETRY_PERMISSION)
      switch (permissionResult) {
        case RESULTS.GRANTED:
        case RESULTS.LIMITED:
          // Granted
          onBiometryToggle(newToggleValue)
          break
        default:
          break
      }
    },
    [onBiometryToggle]
  )

  const onCheckSystemBiometrics = useCallback(async (): Promise<PermissionStatus> => {
    if (Platform.OS === 'android') {
      // Android doesn't need to prompt biometric permission
      // for an app to use it.
      return biometryAvailable ? RESULTS.GRANTED : RESULTS.UNAVAILABLE
    } else if (Platform.OS === 'ios') {
      return await check(BIOMETRY_PERMISSION)
    }

    return RESULTS.UNAVAILABLE
  }, [biometryAvailable])

  const toggleSwitch = useCallback(async () => {
    const newValue = !biometryEnabled

    if (!newValue) {
      // Turning off doesn't require OS biometrics enabled
      onBiometryToggle(newValue)
      return
    }

    // If the user is turning it on, they need
    // to first authenticate the OS biometrics before this action is accepted
    const permissionResult: PermissionStatus = await onCheckSystemBiometrics()
    const supported_type = await getSupportedBiometryType()

    switch (permissionResult) {
      case RESULTS.GRANTED:
      case RESULTS.LIMITED:
        // Already granted
        onBiometryToggle(newValue)
        break
      case RESULTS.UNAVAILABLE:
        // Permission is unavailable/ not supported on this device
        if (Platform.OS === 'ios' && supported_type === BIOMETRY_TYPE.TOUCH_ID) {
          // if available, access to touch id can be granted without a request
          onBiometryToggle(newValue)
        } else {
          // Not in iOS or no touch id available for iOS, send user to settings
          // to enable biometrics
          setSettingsPopupConfig({
            title: t('Biometry.SetupBiometricsTitle'),
            description: t('Biometry.SetupBiometricsDesc'),
            action: t('Biometry.OpenSettings'),
          })
        }
        break
      case RESULTS.BLOCKED:
        // Previously denied
        setSettingsPopupConfig({
          title: t('Biometry.AllowBiometricsTitle'),
          description: t('Biometry.AllowBiometricsDesc'),
          action: t('Biometry.OpenSettingsIos'),
        })
        break
      case RESULTS.DENIED:
        // On iOS, react-native-permissions reports DENIED for Face ID when the
        // OS says Face ID is usable but the library's own "already requested"
        // flag is missing. A reinstall wipes that flag while iOS keeps the
        // app's Face ID grant, and then request() never resolves: it waits for
        // the app to become active again after an alert that iOS never shows.
        // So instead of request(), read back a throwaway Face ID-protected
        // keychain item: iOS asks for permission if it never has, then scans.
        // Turn on only if Face ID really opened it, so the wallet key is never
        // stored behind Face ID that cannot open it.
        if (Platform.OS === 'ios' && supported_type === BIOMETRY_TYPE.FACE_ID) {
          if (confirmingRef.current) {
            break
          }
          confirmingRef.current = true
          setConfirming(true)
          let opened = false
          try {
            opened = await confirmBiometricKeychainAccess(
              t('Biometry.UnlockPromptTitle'),
              t('Biometry.UnlockPromptDescription')
            )
          } finally {
            confirmingRef.current = false
            setConfirming(false)
          }
          if (opened) {
            onBiometryToggle(newValue)
          } else if ((await check(BIOMETRY_PERMISSION)) === RESULTS.BLOCKED) {
            // Declined just now: say where to allow it, as for an earlier decline.
            setSettingsPopupConfig({
              title: t('Biometry.AllowBiometricsTitle'),
              description: t('Biometry.AllowBiometricsDesc'),
              action: t('Biometry.OpenSettingsIos'),
            })
          } else {
            // Cancelled, a failed scan, locked out, or no answer: still off, say so.
            setNotConfirmedPopup(true)
          }
        } else {
          await onRequestSystemBiometrics(newValue)
        }
        break
      default:
        break
    }
  }, [onRequestSystemBiometrics, onCheckSystemBiometrics, biometryEnabled, t, onBiometryToggle])

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['left', 'right', 'bottom']}>
      {notConfirmedPopup && (
        <DismissiblePopupModal
          title={t('Biometry.NotConfirmedTitle')}
          description={t('Biometry.NotConfirmedDesc')}
          onDismissPressed={() => setNotConfirmedPopup(false)}
        />
      )}
      {settingsPopupConfig && (
        <DismissiblePopupModal
          title={settingsPopupConfig.title}
          description={settingsPopupConfig.description}
          onCallToActionLabel={settingsPopupConfig.action}
          onCallToActionPressed={onOpenSettingsTouched}
          onDismissPressed={onOpenSettingsDismissed}
        />
      )}
      <ScrollView style={styles.container}>
        <View style={{ alignItems: 'center' }}>
          <Assets.svg.biometrics style={styles.image} />
        </View>
        {biometryAvailable ? (
          <View style={styles.biometryAvailableRowGap}>
            <ThemedText>{t('Biometry.EnabledText1')}</ThemedText>
            <ThemedText>
              {t('Biometry.EnabledText2')}
              <ThemedText variant="bold"> {t('Biometry.Warning')}</ThemedText>
            </ThemedText>
          </View>
        ) : faceIdNotAllowed ? (
          <View style={styles.biometryAvailableRowGap} testID={testIdWithKey('BiometryNotAllowed')}>
            <ThemedText>{t('Biometry.NotAllowedText1')}</ThemedText>
            <ThemedText>{t('Biometry.NotAllowedText2')}</ThemedText>
            <Pressable
              onPress={() => Linking.openSettings()}
              accessibilityRole="link"
              testID={testIdWithKey('BiometryOpenSettings')}
              style={styles.settingsLink}
            >
              <ThemedText style={{ color: ColorPalette.brand.link }}>{t('Biometry.OpenSettingsIos')}</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.biometryAvailableRowGap}>
            <ThemedText>{t('Biometry.NotEnabledText1')}</ThemedText>
            <ThemedText>{t('Biometry.NotEnabledText2')}</ThemedText>
          </View>
        )}
        <View style={{ flexDirection: 'row', marginVertical: 20 }}>
          <View style={{ flexShrink: 1, marginRight: 10, justifyContent: 'center' }}>
            <ThemedText variant="bold">{t('Biometry.UseToUnlock')}</ThemedText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* The dimmed switch alone read as "off" while Face ID was checking: say it is working, and tell screen
                readers so. */}
            {confirming ? (
              <ActivityIndicator
                color={ColorPalette.brand.primary}
                style={{ marginRight: Spacing.sm }}
                accessible
                accessibilityLabel={t('Biometry.Confirming')}
                accessibilityLiveRegion="polite"
                testID={testIdWithKey('BiometryConfirming')}
              />
            ) : null}
            <ToggleButton
              testID={testIdWithKey('ToggleBiometrics')}
              isEnabled={biometryEnabled}
              isAvailable={true}
              toggleAction={toggleSwitch}
              disabled={confirming}
              enabledIcon="check"
              disabledIcon="close"
            />
          </View>
        </View>
        {recommend && biometryAvailable ? (
          <ThemedText
            style={{ color: ColorPalette.grayscale.mediumGrey }}
            testID={testIdWithKey('BiometryRecommended')}
          >
            {t('Biometry.Recommended')}
          </ThemedText>
        ) : null}
      </ScrollView>
      {children}
    </SafeAreaView>
  )
}

export default BiometryControl
