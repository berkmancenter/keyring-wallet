import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { hitSlop } from '../../constants'
import { useTheme } from '../../contexts/theme'
import { Screens, Stacks, TabStackParams } from '../../types/navigators'
import { testIdWithKey } from '../../utils/testable'
import Button, { ButtonType } from '../buttons/Button'
import { ThemedText } from '../texts/ThemedText'
import SafeAreaModal from './SafeAreaModal'

interface QRCodeExchangeSliderProps {
  visible: boolean
  onDismiss: () => void
  navigation: StackNavigationProp<TabStackParams>
}

const QRCodeExchangeSlider: React.FC<QRCodeExchangeSliderProps> = ({ visible, onDismiss, navigation }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()

  const styles = StyleSheet.create({
    centeredView: {
      marginTop: 'auto',
      justifyContent: 'flex-end',
    },
    outsideListener: {
      height: '100%',
    },
    modalView: {
      backgroundColor: ColorPalette.grayscale.white,
      borderTopStartRadius: 20,
      borderTopEndRadius: 20,
      shadowColor: '#000',
      padding: 20,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    closeButton: {
      alignSelf: 'flex-start',
      marginBottom: 8,
    },
    drawerRowItem: {
      color: ColorPalette.grayscale.black,
    },
    title: {
      ...TextTheme.bold,
      textAlign: 'center',
      marginVertical: 10,
      color: ColorPalette.brand.primary,
    },
    description: {
      ...TextTheme.normal,
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 22,
      color: ColorPalette.grayscale.black,
    },
    buttonContainer: {
      marginBottom: 16,
    },
  })

  const goToScanScreen = useCallback(() => {
    navigation.navigate(Stacks.ConnectStack as any, { screen: Screens.Scan })
    requestAnimationFrame(() => {
      onDismiss()
    })
  }, [navigation, onDismiss])

  const goToGenerateQRCode = useCallback(() => {
    navigation.navigate(Stacks.ConnectStack as any, {
      screen: Screens.Scan,
      params: { defaultToConnect: true },
    })
    requestAnimationFrame(() => {
      onDismiss()
    })
  }, [navigation, onDismiss])

  return (
    <SafeAreaModal animationType="slide" transparent={true} visible={visible} onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.outsideListener} onPress={onDismiss} />
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <TouchableOpacity
            testID={testIdWithKey('Close')}
            accessibilityLabel={t('Global.Close')}
            accessibilityRole={'button'}
            onPress={onDismiss}
            hitSlop={hitSlop}
            style={styles.closeButton}
          >
            <Icon name="window-close" size={35} style={styles.drawerRowItem} />
          </TouchableOpacity>
          <ThemedText variant="bold" style={styles.title} testID={testIdWithKey('QRCodeExchangeTitle')}>
            {t('QRCodeExchange.Title')}
          </ThemedText>
          <ThemedText variant="normal" style={styles.description} testID={testIdWithKey('QRCodeExchangeDescription')}>
            {t('QRCodeExchange.Description')}
          </ThemedText>
          <View style={styles.buttonContainer}>
            <Button
              title={t('QRCodeExchange.ScanQRCode')}
              accessibilityLabel={t('QRCodeExchange.ScanQRCode')}
              testID={testIdWithKey('ScanQRCode')}
              onPress={goToScanScreen}
              buttonType={ButtonType.ModalPrimary}
            />
          </View>
          <View style={styles.buttonContainer}>
            <Button
              title={t('QRCodeExchange.GenerateQRCode')}
              accessibilityLabel={t('QRCodeExchange.GenerateQRCode')}
              testID={testIdWithKey('GenerateQRCode')}
              onPress={goToGenerateQRCode}
              buttonType={ButtonType.ModalPrimary}
            />
          </View>
        </View>
      </View>
    </SafeAreaModal>
  )
}

export default QRCodeExchangeSlider
