import SetupCard, { ICON_SIZE, ICON_FILL } from '@/components/SetupCard'
import {
  useTheme,
  testIdWithKey,
  ThemedText,
  Button,
  ButtonType,
  useAuth,
  useStore,
  DispatchAction,
  useAnimatedComponents,
  confirmBiometricKeychainAccess,
} from '@bifold/core'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Linking, Platform, Switch, View } from 'react-native'
import { check, PERMISSIONS, PermissionStatus, request, RESULTS } from 'react-native-permissions'
import { getSupportedBiometryType, BIOMETRY_TYPE } from 'react-native-keychain'

import FingerprintIcon from '../assets/img/setup-fingerprint.svg'

const BIOMETRY_PERMISSION = PERMISSIONS.IOS.FACE_ID

const strokeProps = {
  stroke: ICON_FILL,
  strokeWidth: 0.8 * (512 / ICON_SIZE),
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
}

const Biometry: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const { commitWalletToKeychain, isBiometricsActive } = useAuth()
  const [biometryEnabled, setBiometryEnabled] = useState(store.preferences.useBiometry)
  const [biometryAvailable, setBiometryAvailable] = useState(false)
  const [continueEnabled, setContinueEnabled] = useState(true)
  // While Face ID is being confirmed the switch is disabled: it shows the check
  // is running, and a second tap would start a second probe and fail the first.
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const { ButtonLoading } = useAnimatedComponents()
  const { Spacing } = useTheme()

  useEffect(() => {
    isBiometricsActive().then((result: boolean) => {
      setBiometryAvailable(result)
    })
  }, [isBiometricsActive])

  const continueTouched = useCallback(async () => {
    setContinueEnabled(false)
    await commitWalletToKeychain(biometryEnabled)
    dispatch({
      type: DispatchAction.USE_BIOMETRY,
      payload: [biometryEnabled],
    })
  }, [biometryEnabled, commitWalletToKeychain, dispatch])

  const showSettingsAlert = useCallback(
    (title: string, description: string) => {
      Alert.alert(title, description, [
        { text: t('Global.Cancel'), style: 'cancel' },
        { text: t('Biometry.OpenSettings'), onPress: () => Linking.openSettings() },
      ])
    },
    [t]
  )

  const onRequestSystemBiometrics = useCallback(async (newToggleValue: boolean) => {
    const permissionResult: PermissionStatus = await request(BIOMETRY_PERMISSION)
    if (permissionResult === RESULTS.GRANTED || permissionResult === RESULTS.LIMITED) {
      setBiometryEnabled(newToggleValue)
    }
  }, [])

  const onCheckSystemBiometrics = useCallback(async (): Promise<PermissionStatus> => {
    if (Platform.OS === 'android') {
      return biometryAvailable ? RESULTS.GRANTED : RESULTS.UNAVAILABLE
    } else if (Platform.OS === 'ios') {
      return await check(BIOMETRY_PERMISSION)
    }
    return RESULTS.UNAVAILABLE
  }, [biometryAvailable])

  const toggleSwitch = useCallback(async () => {
    const newValue = !biometryEnabled

    if (!newValue) {
      setBiometryEnabled(newValue)
      return
    }

    const permissionResult: PermissionStatus = await onCheckSystemBiometrics()
    const supported_type = await getSupportedBiometryType()

    switch (permissionResult) {
      case RESULTS.GRANTED:
      case RESULTS.LIMITED:
        setBiometryEnabled(newValue)
        break
      case RESULTS.UNAVAILABLE:
        if (Platform.OS === 'ios' && supported_type === BIOMETRY_TYPE.TOUCH_ID) {
          setBiometryEnabled(newValue)
        } else {
          showSettingsAlert(t('Biometry.SetupBiometricsTitle'), t('Biometry.SetupBiometricsDesc'))
        }
        break
      case RESULTS.BLOCKED:
        showSettingsAlert(t('Biometry.AllowBiometricsTitle'), t('Biometry.AllowBiometricsDesc'))
        break
      case RESULTS.DENIED:
        // On iOS, react-native-permissions reports DENIED for Face ID when the
        // OS says Face ID is usable but the library's own "already requested"
        // flag is missing. A reinstall wipes that flag while iOS keeps the
        // app's Face ID grant, and then request() never resolves: it waits for
        // the app to become active again after an alert that iOS never shows.
        // So instead of request(), read back a throwaway Face ID-protected
        // keychain item: iOS asks for permission if it never has, then scans.
        // Turn on only if Face ID really opened it, so Continue never stores
        // the wallet key behind Face ID that cannot open it.
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
            setBiometryEnabled(newValue)
          } else if ((await check(BIOMETRY_PERMISSION)) === RESULTS.BLOCKED) {
            // Declined just now: say where to allow it, as for an earlier decline.
            showSettingsAlert(t('Biometry.AllowBiometricsTitle'), t('Biometry.AllowBiometricsDesc'))
          } else {
            // Cancelled, a failed scan, locked out, or no answer: still off, say so.
            Alert.alert(t('Biometry.NotConfirmedTitle'), t('Biometry.NotConfirmedDesc'))
          }
        } else {
          await onRequestSystemBiometrics(newValue)
        }
        break
      default:
        break
    }
  }, [onRequestSystemBiometrics, onCheckSystemBiometrics, biometryEnabled, t, showSettingsAlert])

  return (
    <SetupCard
      icon={<FingerprintIcon width={ICON_SIZE} height={ICON_SIZE} fill={ICON_FILL} {...strokeProps} />}
      footer={
        <Button
          title={t('Global.Continue')}
          accessibilityLabel={'Continue'}
          testID={testIdWithKey('Continue')}
          onPress={continueTouched}
          buttonType={ButtonType.Primary}
          disabled={!continueEnabled}
        >
          {!continueEnabled && <ButtonLoading />}
        </Button>
      }
    >
      <ThemedText style={{ fontSize: 22, fontWeight: '600', textAlign: 'center', marginBottom: Spacing.md }}>
        {biometryAvailable ? t('Biometry.EnabledText1') : t('Biometry.NotEnabledText1')}
      </ThemedText>
      {biometryAvailable ? (
        <ThemedText style={{ textAlign: 'center', marginBottom: Spacing.md }}>{t('Biometry.EnabledText2')}</ThemedText>
      ) : (
        <ThemedText style={{ textAlign: 'center', marginBottom: Spacing.md }}>
          {t('Biometry.NotEnabledText2')}
        </ThemedText>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.md }}>
        <ThemedText variant="bold" style={{ marginRight: 12 }}>
          {t('Biometry.UseToUnlock')}
        </ThemedText>
        <Switch
          testID={testIdWithKey('ToggleBiometrics')}
          value={biometryEnabled}
          onValueChange={toggleSwitch}
          disabled={confirming}
          trackColor={{ false: '#D9D9D9', true: '#A349A4' }}
          thumbColor="#FFFFFF"
        />
      </View>
    </SetupCard>
  )
}

export default Biometry
