import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { Screens, Stacks, TabStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { ThemedText } from '../../../components/texts/ThemedText'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'

const BG_COLOR = '#010B13'
const PURPLE = '#A349A4'
const PURPLE_BG = 'rgba(163, 73, 164, 0.3)'

interface QRCodeExchangeSliderProps {
  visible: boolean
  onDismiss: () => void
  navigation: StackNavigationProp<TabStackParams>
}

const QRCodeExchangeSlider: React.FC<QRCodeExchangeSliderProps> = ({ visible, onDismiss, navigation }) => {
  const { t } = useTranslation()
  const { TextTheme } = useTheme()

  const goToScanScreen = useCallback(() => {
    navigation.navigate(Stacks.ConnectStack as any, { screen: Screens.Scan })
    requestAnimationFrame(() => {
      onDismiss()
    })
  }, [navigation, onDismiss])

  const goToGenerateRelationshipQRCode = useCallback(() => {
    navigation.navigate(Stacks.ConnectStack as any, {
      screen: Screens.Scan,
      params: { defaultToConnect: true, offerRelationshipCredential: true },
    })
    requestAnimationFrame(() => {
      onDismiss()
    })
  }, [navigation, onDismiss])

  return (
    <SafeAreaModal animationType="slide" transparent={true} visible={visible} onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.outsideListener} onPress={onDismiss} activeOpacity={1} />
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <View style={styles.handleBar} />
          <ThemedText variant="bold" style={styles.title} testID={testIdWithKey('QRCodeExchangeTitle')}>
            {t('VRCQRCodeExchange.Title')}
          </ThemedText>
          <ThemedText variant="normal" style={styles.description} testID={testIdWithKey('QRCodeExchangeDescription')}>
            {t('VRCQRCodeExchange.Description')}
          </ThemedText>
          <TouchableOpacity
            style={styles.purpleButton}
            onPress={goToScanScreen}
            testID={testIdWithKey('ScanQRCode')}
            accessibilityLabel={t('VRCQRCodeExchange.ScanQRCode')}
            accessibilityRole="button"
          >
            <ThemedText variant="bold" style={styles.purpleButtonText}>
              {t('VRCQRCodeExchange.ScanQRCode')}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.purpleButton}
            onPress={goToGenerateRelationshipQRCode}
            testID={testIdWithKey('GenerateRelationshipQRCode')}
            accessibilityLabel={t('VRCQRCodeExchange.GenerateRelationshipInvitation')}
            accessibilityRole="button"
          >
            <ThemedText variant="bold" style={styles.purpleButtonText}>
              {t('VRCQRCodeExchange.GenerateRelationshipInvitation')}
            </ThemedText>
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
    color: '#FFFFFF',
    marginBottom: 12,
  },
  description: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 28,
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
  },
})

export default QRCodeExchangeSlider
