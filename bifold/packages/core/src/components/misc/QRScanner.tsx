import { useAgent } from '@bifold/react-hooks'
import { DidCommDidExchangeState } from '@credo-ts/didcomm'
import { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { hitSlop } from '../../constants'
import { useStore } from '../../contexts/store'
import { useTheme } from '../../contexts/theme'
import { useConnectionByOutOfBandId } from '../../hooks/connections'
import { GenericRecordsIdentityStore, type VtiPersona } from '../../modules/trust-tasks/module/VtiIdentityStore'
import { communityTarget } from '../../modules/trust-tasks/module/vtiCommunityLink'
import { communityLabelOf } from '../../modules/trust-tasks/screens/communityName'
import { useRCardCredential } from '../../modules/vrc/hooks/useRCardCredential'
import { formInputFromTemplate } from '../../modules/vrc/types/rcard'
import { QrCodeScanError } from '../../types/error'
import { ConnectStackParams, Screens, Stacks } from '../../types/navigators'
import { createConnectionInvitation, createRelationshipInvitation } from '../../utils/helpers'
import { testIdWithKey } from '../../utils/testable'
import LoadingIndicator from '../animated/LoadingIndicator'
import IconButton, { ButtonLocation } from '../buttons/IconButton'
import DismissiblePopupModal from '../modals/DismissiblePopupModal'
import SafeAreaModal from '../modals/SafeAreaModal'
import InfoBox, { InfoBoxType } from './InfoBox'
import { TOKENS, useServices } from '../../container-api'
import { ThemedText } from '../texts/ThemedText'
import QRRenderer from './QRRenderer'
import QRScannerTorch from './QRScannerTorch'
import ScanCamera from './ScanCamera'
import ScanTab from './ScanTab'
import SVGOverlay, { MaskType } from './SVGOverlay'

type ConnectProps = StackScreenProps<ConnectStackParams>
interface Props extends ConnectProps {
  showTabs?: boolean
  defaultToConnect: boolean
  offerRelationshipCredential?: boolean
  handleCodeScan: (value: string) => Promise<void>
  error?: QrCodeScanError | null
  enableCameraOnError?: boolean
}

const QRScanner: React.FC<Props> = ({
  showTabs = false,
  defaultToConnect,
  offerRelationshipCredential = false,
  handleCodeScan,
  error,
  enableCameraOnError,
  navigation,
}) => {
  const { agent } = useAgent()
  const { width } = useWindowDimensions()
  const { t } = useTranslation()
  const { ColorPalette, TabTheme } = useTheme()
  const [store] = useStore()
  const [{ showScanHelp, showScanButton, showScanErrorButton = true }] = useServices([TOKENS.CONFIG])
  const [firstTabActive, setFirstTabActive] = useState(!defaultToConnect && !showTabs)
  const [invitation, setInvitation] = useState<string | undefined>(undefined)
  const [recordId, setRecordId] = useState<string | undefined>(undefined)
  const record = useConnectionByOutOfBandId(recordId || '')
  const [torchActive, setTorchActive] = useState(false)
  const [showInfoBox, setShowInfoBox] = useState(false)
  const [showErrorDetailsModal, setShowErrorDetailsModal] = useState(false)
  const [showingQRCodeView, _setShowingQRCodeView] = useState(defaultToConnect && !showTabs)
  const [showProfilePicker, setShowProfilePicker] = useState(false)
  const { profiles, activeProfileId, setActive } = useRCardCredential()
  const activeProfile = profiles.find((p) => p.id === activeProfileId)
  // The phone's identity for a community — the code a community's admin needs
  // to invite it — offered beside the contact card when the phone holds one.
  // The community it has chosen, else its newest identity.
  const [persona, setPersona] = useState<VtiPersona>()
  const [showing, setShowing] = useState<'contact' | 'identity'>('contact')
  useEffect(() => {
    if (!agent) return
    let live = true
    new GenericRecordsIdentityStore(agent)
      .listPersonas()
      .then((all) => {
        if (!live) return
        const chosen = communityTarget.getChosen()?.communityDid
        const newest = [...all].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        setPersona(newest.find((p) => p.communityDid === chosen) ?? newest[0])
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [agent])
  const identityShown = showing === 'identity' && Boolean(persona)

  const qrSize = width - 40

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    mainSafeArea: {
      flex: 1,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    bottomSafeArea: {
      flex: 0,
      backgroundColor: TabTheme.tabBarSecondaryBackgroundColor,
    },
    cameraViewContainer: {
      flex: 1,
      justifyContent: 'space-between',
    },
    messageContainer: {
      marginHorizontal: 40,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      paddingTop: 30,
    },
    bottomButtonsContainer: {},
    icon: {
      color: ColorPalette.grayscale.white,
      padding: 4,
    },
    textStyle: {
      color: 'white',
      marginHorizontal: 10,
      textAlign: 'center',
    },
    tabContainer: {
      flexDirection: 'row',
      ...TabTheme.tabBarStyle,
    },
    qrContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      width: '100%',
    },
    qrCodeViewContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
    },
    instruction: {
      fontSize: 14,
      color: ColorPalette.grayscale.mediumGrey,
      textAlign: 'center',
      marginTop: 16,
    },
    codeTitle: {
      textAlign: 'center',
      marginTop: 16,
    },
    choice: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: ColorPalette.brand.primary,
      marginBottom: 16,
      overflow: 'hidden',
    },
    choiceOption: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 8,
      alignItems: 'center',
    },
    choiceOptionOn: {
      backgroundColor: ColorPalette.brand.primary,
    },
    scanHint: {
      textAlign: 'center',
      marginTop: 8,
      paddingHorizontal: 24,
    },
    profileSwitcher: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    profileSwitcherAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: ColorPalette.brand.primaryBackground,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginRight: 8,
    },
    profileSwitcherAvatarImage: {
      width: 32,
      height: 32,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
  })

  const createInvitation = useCallback(async () => {
    setInvitation(undefined)
    if (offerRelationshipCredential) {
      const result = await createRelationshipInvitation(agent, store.preferences.walletName)
      if (result) {
        setRecordId(result.record.id)
        setInvitation(result.invitationUrl)
      }
    } else {
      const result = await createConnectionInvitation(agent)
      if (result) {
        setRecordId(result.record.id)
        setInvitation(result.invitationUrl)
      }
    }
  }, [agent, offerRelationshipCredential, store.preferences.walletName])

  useEffect(() => {
    if (!showTabs && defaultToConnect && showingQRCodeView) {
      navigation.setOptions({ title: t('Scan.ScanQRCode'), headerRight: () => undefined })
    } else if (!showTabs) {
      // Camera scan without tabs: still offer the paste-URL fallback (also used by E2E
      // to feed an invitation link without scanning a QR code with the camera).
      navigation.setOptions({
        title: t('Scan.ScanQRCode'),
        headerRight: () => (
          <IconButton
            buttonLocation={ButtonLocation.Right}
            accessibilityLabel={t('Scan.PasteUrl')}
            testID={testIdWithKey('PasteUrlButton')}
            onPress={() => {
              navigation.navigate(Screens.PasteUrl)
            }}
            icon="link"
          />
        ),
      })
    } else if (showTabs) {
      let headerRight: React.ReactElement | undefined = undefined
      let title = t('Scan.MyQRCode')

      if (firstTabActive) {
        headerRight = (
          <IconButton
            buttonLocation={ButtonLocation.Right}
            accessibilityLabel={t('Scan.PasteUrl')}
            testID={testIdWithKey('PasteUrlButton')}
            onPress={() => {
              navigation.navigate(Screens.PasteUrl)
            }}
            icon="link"
          />
        )
        title = t('Scan.ScanQRCode')
      }

      navigation.setOptions({ title, headerRight: () => headerRight })
    }
  }, [showTabs, defaultToConnect, showingQRCodeView, t, firstTabActive, navigation])

  useEffect(() => {
    if ((showTabs && !firstTabActive) || (defaultToConnect && !showTabs)) {
      createInvitation()
    }
    // store.rCard.activeProfileId: switching the active profile on this
    // screen regenerates the invitation under the newly active one.
  }, [
    showTabs,
    firstTabActive,
    defaultToConnect,
    createInvitation,
    store.preferences.walletName,
    store.rCard.activeProfileId,
  ])

  useEffect(() => {
    // Effect not required if tabs are not enabled
    if (showTabs && record?.state === DidCommDidExchangeState.Completed) {
      navigation.getParent()?.navigate(Stacks.ConnectionStack, {
        screen: Screens.Connection,
        params: { oobRecordId: recordId },
      })
    }
  }, [showTabs, record, navigation, recordId])

  useEffect(() => {
    if (!defaultToConnect || showTabs) return

    const connected =
      record?.state === DidCommDidExchangeState.Completed || record?.state === DidCommDidExchangeState.ResponseSent

    if (connected && record?.id) {
      navigation.getParent()?.navigate(Stacks.ContactStack, {
        screen: Screens.Chat,
        params: { connectionId: record.id },
      })
    }
  }, [defaultToConnect, showTabs, record, navigation])

  const styleForState = ({ pressed }: { pressed: boolean }) => [{ opacity: pressed ? 0.2 : 1 }]

  const toggleShowInfoBox = () => setShowInfoBox(!showInfoBox)

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['left', 'right']} style={styles.mainSafeArea} testID={testIdWithKey('QRScanner')}>
        {/* Decide to show camera content or connection invitation content */}
        {(!showTabs && !showingQRCodeView) || (showTabs && firstTabActive) ? (
          <>
            <ScanCamera
              handleCodeScan={handleCodeScan}
              error={error}
              enableCameraOnError={enableCameraOnError}
              torchActive={torchActive}
            />
            <View style={StyleSheet.absoluteFill} pointerEvents="none" testID={testIdWithKey('ScanOverlay')}>
              <SVGOverlay maskType={MaskType.QR_CODE} strokeColor={ColorPalette.grayscale.white} />
            </View>
            <View style={styles.cameraViewContainer}>
              <View style={styles.messageContainer}>
                {error ? (
                  <>
                    <Icon style={styles.icon} name="cancel" size={40} />
                    <ThemedText testID={testIdWithKey('ErrorMessage')} style={styles.textStyle}>
                      {error.message}
                    </ThemedText>
                    {showScanErrorButton && (
                      <Pressable
                        onPress={() => setShowErrorDetailsModal(true)}
                        accessibilityLabel={t('Scan.ShowDetails')}
                        accessibilityRole={'button'}
                        testID={testIdWithKey('ShowDetails')}
                        hitSlop={hitSlop}
                      >
                        <Icon name="information-outline" size={40} style={styles.icon} />
                      </Pressable>
                    )}
                  </>
                ) : (
                  <>
                    <Icon name="qrcode-scan" size={40} style={styles.icon} />
                    <ThemedText variant="title" style={styles.textStyle}>
                      {t('Scan.WillScanAutomatically')}
                    </ThemedText>
                    {/* One entry point: say what it takes (217). */}
                    <ThemedText style={[styles.textStyle, styles.scanHint]} testID={testIdWithKey('ScanWhatCanI')}>
                      {t('Scan.WhatCanIScan')}
                    </ThemedText>
                  </>
                )}
              </View>
              <View style={styles.bottomButtonsContainer}>
                {showScanButton && (
                  <View style={{ justifyContent: 'center', alignItems: 'center' }}>
                    <Pressable
                      accessibilityLabel={t('Scan.ScanNow')}
                      accessibilityRole={'button'}
                      testID={testIdWithKey('ScanNow')}
                      onPress={toggleShowInfoBox}
                      style={styleForState}
                      hitSlop={hitSlop}
                    >
                      <Icon name="circle-outline" size={60} style={{ color: 'white', marginBottom: -15 }} />
                    </Pressable>
                  </View>
                )}

                <View style={{ marginHorizontal: 24, height: 24, marginBottom: 60, flexDirection: 'row' }}>
                  {showScanHelp && (
                    <Pressable
                      accessibilityLabel={t('Scan.ScanHelp')}
                      accessibilityRole={'button'}
                      testID={testIdWithKey('ScanHelp')}
                      onPress={() => navigation.navigate(Screens.ScanHelp)}
                      style={styleForState}
                      hitSlop={hitSlop}
                    >
                      <Icon name="help-circle" size={24} style={{ color: 'white' }} />
                    </Pressable>
                  )}

                  <View style={{ width: 10, marginLeft: 'auto' }} />
                  <QRScannerTorch active={torchActive} onPress={() => setTorchActive(!torchActive)} />
                </View>
              </View>
            </View>

            <SafeAreaModal visible={showInfoBox} animationType="fade" transparent>
              <View
                style={{
                  flex: 1,
                  paddingHorizontal: 10,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                }}
              >
                <InfoBox
                  notificationType={InfoBoxType.Info}
                  title={t('Scan.BadQRCode')}
                  description={t('Scan.BadQRCodeDescription')}
                  onCallToActionPressed={toggleShowInfoBox}
                />
              </View>
            </SafeAreaModal>
            {showErrorDetailsModal && (
              <DismissiblePopupModal
                title={t('Scan.ErrorDetails')}
                description={error?.details || t('Scan.NoDetails')}
                onCallToActionLabel={t('Global.Dismiss')}
                onCallToActionPressed={() => setShowErrorDetailsModal(false)}
                onDismissPressed={() => setShowErrorDetailsModal(false)}
              />
            )}
          </>
        ) : (
          <View style={styles.qrCodeViewContainer}>
            {/* Two codes a person may be asked to show, said as what they are:
                a contact card for another Keyring user, or — once the phone
                holds one — its identity for a community, which that
                community's admin scans to invite it (215 feedback: nobody
                could tell what this code was). */}
            {persona ? (
              <View style={styles.choice} accessibilityRole="tablist">
                {(['contact', 'identity'] as const).map((which) => (
                  <Pressable
                    key={which}
                    style={[styles.choiceOption, showing === which ? styles.choiceOptionOn : undefined]}
                    onPress={() => setShowing(which)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: showing === which }}
                    testID={testIdWithKey(which === 'contact' ? 'MyQRContact' : 'MyQRIdentity')}
                  >
                    <ThemedText
                      variant="bold"
                      style={{ color: showing === which ? ColorPalette.grayscale.white : ColorPalette.brand.primary }}
                    >
                      {which === 'contact'
                        ? t('Scan.ContactCard')
                        : t('Scan.IdentityFor', {
                            community: communityLabelOf(persona.communityDid),
                            interpolation: { escapeValue: false },
                          })}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {!identityShown && offerRelationshipCredential && activeProfile && profiles.length > 1 && (
              <TouchableOpacity
                style={styles.profileSwitcher}
                onPress={() => setShowProfilePicker(true)}
                accessibilityRole="button"
                accessibilityLabel={t('Scan.SwitchProfile')}
                testID={testIdWithKey('SwitchProfile')}
              >
                <View style={styles.profileSwitcherAvatar}>
                  {formInputFromTemplate(activeProfile).photo ? (
                    <Image
                      style={styles.profileSwitcherAvatarImage}
                      source={{ uri: formInputFromTemplate(activeProfile).photo }}
                    />
                  ) : (
                    <Icon name="account" size={20} color={ColorPalette.grayscale.mediumGrey} />
                  )}
                </View>
                <ThemedText style={{ color: ColorPalette.brand.link }}>{activeProfile.label}</ThemedText>
                <Icon
                  name="chevron-down"
                  size={20}
                  color={ColorPalette.grayscale.mediumGrey}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            )}
            <View style={styles.qrContainer}>
              {identityShown && persona ? (
                <View testID={testIdWithKey('MyQRIdentityCode')}>
                  <QRRenderer value={persona.did} size={qrSize} />
                </View>
              ) : (
                <>
                  {!invitation && <LoadingIndicator />}
                  {invitation && <QRRenderer value={invitation} size={qrSize} />}
                </>
              )}
            </View>
            {/* E2E-only: expose invitation URL to the accessibility tree so Appium can
                read it and paste it into the peer wallet (avoids camera-based QR scan). */}
            {__DEV__ && invitation && (
              <ThemedText
                testID={testIdWithKey('InvitationUrl')}
                accessibilityLabel={invitation}
                style={{ height: 1, opacity: 0.01 }}
                numberOfLines={1}
              >
                {invitation}
              </ThemedText>
            )}
            <ThemedText variant="bold" style={styles.codeTitle} testID={testIdWithKey('MyQRCodeTitle')}>
              {identityShown && persona
                ? t('Scan.YourIdentityTitle', {
                    community: communityLabelOf(persona.communityDid),
                    interpolation: { escapeValue: false },
                  })
                : t('Scan.YourQRCodeTitle')}
            </ThemedText>
            <ThemedText style={styles.instruction} testID={testIdWithKey('MyQRCodeInstruction')}>
              {identityShown ? t('Scan.YourIdentityInstruction') : t('Scan.YourQRCodeInstruction')}
            </ThemedText>
          </View>
        )}
        <SafeAreaModal visible={showProfilePicker} animationType="slide" transparent>
          <View
            style={{
              flex: 1,
              justifyContent: 'flex-end',
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}
          >
            <View style={{ backgroundColor: ColorPalette.brand.primaryBackground, paddingVertical: 12 }}>
              {profiles.map((profile) => (
                <TouchableOpacity
                  key={profile.id}
                  style={styles.profileRow}
                  onPress={async () => {
                    await setActive(profile.id)
                    setShowProfilePicker(false)
                  }}
                  accessibilityRole="button"
                  testID={testIdWithKey(`SwitchProfile-${profile.id}`)}
                >
                  <View style={styles.profileSwitcherAvatar}>
                    {formInputFromTemplate(profile).photo ? (
                      <Image
                        testID={testIdWithKey(`SwitchProfileAvatar-${profile.id}`)}
                        style={styles.profileSwitcherAvatarImage}
                        source={{ uri: formInputFromTemplate(profile).photo }}
                      />
                    ) : (
                      <Icon name="account" size={20} color={ColorPalette.grayscale.mediumGrey} />
                    )}
                  </View>
                  <ThemedText style={[profile.id === activeProfileId && { fontWeight: '700' as const }]}>
                    {profile.label}
                  </ThemedText>
                  {profile.id === activeProfileId && (
                    <Icon name="check" size={20} color={ColorPalette.brand.primary} style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </SafeAreaModal>
        {showTabs ? (
          <View accessible={true} style={styles.tabContainer} accessibilityRole="tablist">
            <ScanTab
              title={t('Scan.ScanQRCode')}
              iconName={'crop-free'}
              onPress={() => setFirstTabActive(true)}
              active={firstTabActive}
            />
            <ScanTab
              title={t('Scan.MyQRCode')}
              iconName={'qr-code'}
              onPress={() => setFirstTabActive(false)}
              active={!firstTabActive}
            />
          </View>
        ) : null}
      </SafeAreaView>
      {showTabs ? <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea} /> : null}
    </View>
  )
}

export default QRScanner
