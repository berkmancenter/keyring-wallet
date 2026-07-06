import { SafeAreaModal, Screens, Stacks, testIdForAccessabilityLabel, testIdWithKey } from '@bifold/core'
import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { DidCommCredentialState } from '@credo-ts/didcomm'
import { useCredentialByState } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { showPersonCredentialSelector } from '@/keyring-theme/features/person-flow/utils/BCIDHelper'
import { KeyRingEventTypes } from '@events/eventTypes'

const BG_COLOR = '#010B13'
const PURPLE = '#A349A4'
const PURPLE_BG = 'rgba(163, 73, 164, 0.3)'

export default function AddCredentialSlider() {
  const navigation = useNavigation()
  const { t } = useTranslation()

  const [addCredentialPressed, setAddCredentialPressed] = useState<boolean>(false)
  const [showGetPersonCredential, setShowGetPersonCredential] = useState<boolean>(false)

  const credentialsReceived = useCredentialByState(DidCommCredentialState.CredentialReceived)
  const credentialsDone = useCredentialByState(DidCommCredentialState.Done)

  const deactivateSlider = useCallback(() => {
    DeviceEventEmitter.emit(KeyRingEventTypes.ADD_CREDENTIAL_PRESSED, false)
  }, [])

  const goToScanScreen = useCallback(() => {
    deactivateSlider()
    navigation.getParent()?.navigate(Stacks.ConnectStack, { screen: Screens.Scan })
  }, [deactivateSlider, navigation])

  const goToPersonCredentialScreen = useCallback(() => {
    deactivateSlider()
    navigation.getParent()?.navigate(Stacks.NotificationStack, {
      screen: Screens.CustomNotification,
    })
  }, [deactivateSlider, navigation])

  useEffect(() => {
    const credentialDefinitionIDs = [...credentialsReceived, ...credentialsDone]
      .filter((c) => c.metadata.data[AnonCredsCredentialMetadataKey]?.credentialDefinitionId)
      .map((c) => c.metadata.data[AnonCredsCredentialMetadataKey].credentialDefinitionId as string)

    setShowGetPersonCredential(showPersonCredentialSelector(credentialDefinitionIDs))
  }, [credentialsReceived, credentialsDone])

  useEffect(() => {
    const handle = DeviceEventEmitter.addListener(KeyRingEventTypes.ADD_CREDENTIAL_PRESSED, (value?: boolean) => {
      const newVal = value === undefined ? !addCredentialPressed : value
      setAddCredentialPressed(newVal)
    })

    return () => {
      handle.remove()
    }
  }, [addCredentialPressed])

  return (
    <SafeAreaModal
      animationType="slide"
      transparent={true}
      visible={addCredentialPressed}
      onRequestClose={deactivateSlider}
    >
      <TouchableOpacity style={styles.outsideListener} onPress={deactivateSlider} activeOpacity={1} />
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <View style={styles.handleBar} />
          <Text style={styles.title}>{t('AddCredentialSlider.Choose')}</Text>
          {showGetPersonCredential && (
            <TouchableOpacity
              style={styles.purpleButton}
              onPress={goToPersonCredentialScreen}
              testID={testIdWithKey(testIdForAccessabilityLabel(t('BCID.GetDigitalID')))}
              accessibilityLabel={t('BCID.GetDigitalID')}
              accessibilityRole="button"
            >
              <Text style={styles.purpleButtonText}>{t('BCID.GetDigitalID')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.purpleButton}
            onPress={goToScanScreen}
            testID={testIdWithKey(testIdForAccessabilityLabel(t('AddCredentialSlider.ScanQRCode')))}
            accessibilityLabel={t('AddCredentialSlider.ScanQRCode')}
            accessibilityRole="button"
          >
            <Text style={styles.purpleButtonText}>{t('AddCredentialSlider.ScanQRCode')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaModal>
  )
}

const styles = StyleSheet.create({
  outsideListener: {
    flex: 1,
  },
  centeredView: {
    marginTop: 'auto',
    justifyContent: 'flex-end',
  },
  modalView: {
    backgroundColor: BG_COLOR,
    borderTopStartRadius: 40,
    borderTopEndRadius: 40,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  purpleButton: {
    borderWidth: 2,
    borderColor: PURPLE,
    backgroundColor: PURPLE_BG,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  purpleButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
})
