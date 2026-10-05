import { useAgent } from '@bifold/react-hooks'
import { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform } from 'react-native'
import { PERMISSIONS, Permission, RESULTS, Rationale, check, request } from 'react-native-permissions'
import Toast from 'react-native-toast-message'

import QRScanner from '../components/misc/QRScanner'
import CameraDisclosureModal from '../components/modals/CameraDisclosureModal'
import { ToastType } from '../components/toast/BaseToast'
import LoadingView from '../components/views/LoadingView'
import { TOKENS, useServices } from '../container-api'
import { useStore } from '../contexts/store'
import { agentAddressScan } from '../modules/trust-tasks/module/agentAddressScan'
import { deviceCodeScan } from '../modules/trust-tasks/module/deviceCodeScan'
import { KeyringLinkError, keyringLinkErrorText } from '../modules/trust-tasks/module/vtiLinks'
import { BifoldError, QrCodeScanError } from '../types/error'
import { ConnectStackParams } from '../types/navigators'
import { PermissionContract } from '../types/permissions'
import { connectFromScanOrDeepLink } from '../utils/helpers'
import { useToastAboveTabBar } from '../modules/trust-tasks/screens/aboveTabBar'

export type ScanProps = StackScreenProps<ConnectStackParams>

/**
 * What the scanner shows for a code that failed. A Keyring link that cannot be
 * used says why, in words, as the headline — "This link has expired", "This is
 * a mediator's code" — instead of "Invalid QR code" with the reason nowhere a
 * person could read it. Anything else keeps the generic headline.
 */
export function scanErrorOf(
  value: string,
  e: unknown,
  invalidQrCode: string,
  t?: (key: string) => string
): QrCodeScanError {
  if (e instanceof KeyringLinkError) {
    const text = keyringLinkErrorText(e, t)
    return new QrCodeScanError(text, value, text)
  }
  return new QrCodeScanError(invalidQrCode, value, (e as Error)?.message)
}

const Scan: React.FC<ScanProps> = ({ navigation, route }) => {
  const { agent } = useAgent()
  const { t } = useTranslation()
  // Bottom toasts sit clear of the tab bar (aboveTabBar).
  const toastBottomOffset = useToastAboveTabBar()
  const [store] = useStore()
  const [loading, setLoading] = useState<boolean>(true)
  const [showDisclosureModal, setShowDisclosureModal] = useState<boolean>(true)
  const [qrCodeScanError, setQrCodeScanError] = useState<QrCodeScanError | null>(null)
  const [{ enableImplicitInvitations, enableReuseConnections }, logger] = useServices([
    TOKENS.CONFIG,
    TOKENS.UTIL_LOGGER,
  ])
  let defaultToConnect = false
  let offerRelationshipCredential = false
  if (route?.params && route.params['defaultToConnect']) {
    defaultToConnect = route.params['defaultToConnect']
  }
  if (route?.params && route.params['offerRelationshipCredential']) {
    offerRelationshipCredential = route.params['offerRelationshipCredential']
  }

  const handleInvitation = useCallback(
    async (value: string): Promise<void> => {
      try {
        await connectFromScanOrDeepLink(
          value,
          agent,
          logger,
          navigation?.getParent(),
          false, // isDeepLink
          enableImplicitInvitations,
          enableReuseConnections,
          store.preferences.walletName
        )
      } catch (err: unknown) {
        // Ours, and already in words: let it through to be shown as it is.
        if (err instanceof KeyringLinkError) throw err
        const error = new BifoldError(
          t('Error.Title1031'),
          t('Error.Message1031'),
          (err as Error)?.message ?? err,
          1031
        )
        // throwing for QrCodeScanError
        throw error
      }
    },
    [agent, logger, navigation, enableImplicitInvitations, enableReuseConnections, store.preferences.walletName, t]
  )

  const handleCodeScan = useCallback(
    async (value: string) => {
      setQrCodeScanError(null)
      // "Scan its code" on the phone adding another one (#30): a device code
      // goes back to that screen instead of being routed as a link.
      const forDevice = deviceCodeScan.claim(value)
      if (forDevice?.taken) {
        navigation.goBack()
        return
      }
      if (forDevice) {
        setQrCodeScanError(new QrCodeScanError(t('Scan.NotADeviceCode'), value, t('Scan.NotADeviceCode')))
        return
      }
      // "Scan" on Create my agent's address step: an agent's address, or a
      // host's automatic-connection QR, goes back to that screen.
      // The scanner closes before the result is handed over: that screen may
      // navigate on from it, and a second goBack here would then leave it (229).
      const forAddress = agentAddressScan.claim(value, () => navigation.goBack())
      if (forAddress?.taken) return
      if (forAddress) {
        const said = t(forAddress.why === 'hostNotAllowed' ? 'Scan.HostNotAllowed' : 'Scan.NotAnAgentAddress')
        setQrCodeScanError(new QrCodeScanError(said, value, said))
        return
      }
      try {
        const uri = value
        await handleInvitation(uri)
      } catch (e: unknown) {
        setQrCodeScanError(scanErrorOf(value, e, t('Scan.InvalidQrCode'), (k) => t(k)))
      }
    },
    [handleInvitation, navigation, t]
  )

  const permissionFlow = useCallback(
    async (method: PermissionContract, permission: Permission, rationale?: Rationale): Promise<boolean> => {
      try {
        const permissionResult = await method(permission, rationale)
        if (permissionResult === RESULTS.GRANTED) {
          setShowDisclosureModal(false)
          return true
        }
      } catch (error: unknown) {
        Toast.show({
          type: ToastType.Error,
          text1: t('Global.Failure'),
          text2: (error as Error)?.message || t('Error.Unknown'),
          visibilityTime: 2000,
          position: 'bottom',
          bottomOffset: toastBottomOffset,
        })
      }

      return false
    },
    [t, toastBottomOffset]
  )

  const requestCameraUse = async (rationale?: Rationale): Promise<boolean> => {
    if (Platform.OS === 'android') {
      return await permissionFlow(request, PERMISSIONS.ANDROID.CAMERA, rationale)
    } else if (Platform.OS === 'ios') {
      return await permissionFlow(request, PERMISSIONS.IOS.CAMERA, rationale)
    }

    return false
  }

  useEffect(() => {
    const asyncEffect = async () => {
      if (Platform.OS === 'android') {
        await permissionFlow(check, PERMISSIONS.ANDROID.CAMERA)
      } else if (Platform.OS === 'ios') {
        await permissionFlow(check, PERMISSIONS.IOS.CAMERA)
      }
      setLoading(false)
    }

    asyncEffect()
  }, [permissionFlow])

  if (loading) {
    return <LoadingView />
  }

  if (showDisclosureModal) {
    return <CameraDisclosureModal requestCameraUse={requestCameraUse} />
  }

  // When defaultToConnect is true, show QR code view directly without tabs
  // When useConnectionInviterCapability is enabled, show tabs for switching between scan and generate
  const shouldShowTabs = store.preferences.useConnectionInviterCapability && !defaultToConnect

  return (
    <QRScanner
      showTabs={shouldShowTabs}
      defaultToConnect={defaultToConnect}
      offerRelationshipCredential={offerRelationshipCredential}
      handleCodeScan={handleCodeScan}
      error={qrCodeScanError}
      enableCameraOnError={true}
      navigation={navigation}
      route={route}
    />
  )
}

export default Scan
