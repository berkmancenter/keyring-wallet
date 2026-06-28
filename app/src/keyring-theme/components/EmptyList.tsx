import { useTheme, testIdWithKey } from '@bifold/core'
import { Button, ButtonType } from '@bifold/core'
import { ThemedText } from '@bifold/core'
import React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, StyleSheet } from 'react-native'
import { DeviceEventEmitter } from 'react-native'

import WalletIcon from '@assets/img/tab-wallet.svg'
import { KeyRingEventTypes } from '../../events/eventTypes'

const CIRCLE_SIZE = 180
const CIRCLE_COLOR = 'rgba(163, 73, 164, 0.18)'
const ICON_SIZE = 80

export interface EmptyListProps {
  message?: string
}

const EmptyList = ({ message }: EmptyListProps) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [addCredentialPressed, setAddCredentialPressed] = useState<boolean>(false)

  useEffect(() => {
    const handle = DeviceEventEmitter.addListener(KeyRingEventTypes.ADD_CREDENTIAL_PRESSED, (value?: boolean) => {
      const newVal = value === undefined ? !addCredentialPressed : value
      setAddCredentialPressed(newVal)
    })
    return () => {
      handle.remove()
    }
  }, [addCredentialPressed])

  const addCredentialPress = useCallback(() => {
    DeviceEventEmitter.emit(KeyRingEventTypes.ADD_CREDENTIAL_PRESSED, !addCredentialPressed)
  }, [addCredentialPressed])

  return (
    <View style={[styles.container, { backgroundColor: ColorPalette.brand.primaryBackground }]}>
      <View style={styles.iconCircle}>
        <WalletIcon width={ICON_SIZE} height={ICON_SIZE} fill="#000000" />
      </View>
      <ThemedText
        variant="headingThree"
        style={[styles.text, { marginTop: 28, fontSize: 22, fontWeight: '700' }]}
        accessibilityRole="header"
      >
        {message || t('Credentials.EmptyList')}
      </ThemedText>
      <ThemedText
        style={[styles.text, { color: ColorPalette.grayscale.mediumGrey, fontSize: 16, lineHeight: 22 }]}
        testID={testIdWithKey('NoCredentials')}
      >
        {t('Credentials.EmptyListDescription')}
      </ThemedText>
      <View style={styles.buttonContainer}>
        <Button
          title={t('Credentials.AddFirstCredential')}
          accessibilityLabel={t('Credentials.AddFirstCredential')}
          testID={testIdWithKey('AddFirstCredential')}
          buttonType={ButtonType.Primary}
          onPress={addCredentialPress}
          disabled={addCredentialPressed}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: CIRCLE_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    textAlign: 'center',
    marginTop: 10,
  },
  buttonContainer: {
    marginTop: 24,
    width: '75%',
    alignSelf: 'center',
  },
})

export default EmptyList
