import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '../../contexts/theme'
import { Screens, HomeStackParams, TabStacks } from '../../types/navigators'
import { testIdWithKey } from '../../utils/testable'
import Button, { ButtonType } from '../buttons/Button'

import DismissiblePopupModal from './DismissiblePopupModal'
import { ThemedText } from '../texts/ThemedText'

interface CameraDisclosureModalProps {
  requestCameraUse: () => Promise<boolean>
}

// NOTE: rendered as a plain full-screen view, NOT an RN Modal. This component
// is the sole content of the Scan screen while camera permission is missing,
// so a Modal adds nothing — and on real iOS devices presenting a Modal right
// as the screen is pushed (QR-sheet dismissal still animating) fails silently,
// leaving a blank Scan screen with no way to grant the permission.
const CameraDisclosureModal: React.FC<CameraDisclosureModalProps> = ({ requestCameraUse }) => {
  const { t } = useTranslation()
  const navigation = useNavigation<StackNavigationProp<HomeStackParams>>()
  const [showSettingsPopup, setShowSettingsPopup] = useState(false)
  const [requestInProgress, setRequestInProgress] = useState(false)
  const { ColorPalette } = useTheme()

  const styles = StyleSheet.create({
    container: {
      height: '100%',
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      padding: 20,
    },
    messageText: {
      marginTop: 30,
    },
    controlsContainer: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      marginTop: 'auto',
      margin: 20,
    },
    buttonContainer: {
      paddingTop: 10,
    },
  })

  const onContinueTouched = async () => {
    setRequestInProgress(true)
    const granted = await requestCameraUse()
    if (!granted) {
      setShowSettingsPopup(true)
    }
    setRequestInProgress(false)
  }

  const onOpenSettingsTouched = async () => {
    await Linking.openSettings()
    navigation.getParent()?.navigate(TabStacks.HomeStack, { screen: Screens.Home })
  }

  const onNotNowTouched = () => {
    navigation.getParent()?.navigate(TabStacks.HomeStack, { screen: Screens.Home })
  }

  const onOpenSettingsDismissed = () => {
    setShowSettingsPopup(false)
  }

  return (
    <SafeAreaView style={{ backgroundColor: ColorPalette.brand.modalPrimaryBackground, flex: 1 }}>
      {showSettingsPopup && (
        <DismissiblePopupModal
          title={t('CameraDisclosure.AllowCameraUse')}
          description={t('CameraDisclosure.ToContinueUsing')}
          onCallToActionLabel={t('CameraDisclosure.OpenSettings')}
          onCallToActionPressed={onOpenSettingsTouched}
          onDismissPressed={onOpenSettingsDismissed}
        />
      )}
      <ScrollView style={styles.container}>
        <ThemedText variant="modalHeadingOne" testID={testIdWithKey('AllowCameraUse')} accessibilityRole="header">
          {t('CameraDisclosure.AllowCameraUse')}
        </ThemedText>
        <ThemedText variant="modalNormal" style={styles.messageText}>
          {t('CameraDisclosure.CameraDisclosure')}
        </ThemedText>
        <ThemedText variant="modalNormal" style={[styles.messageText, { marginBottom: 20 }]}>
          {t('CameraDisclosure.ToContinueUsing')}
        </ThemedText>
      </ScrollView>
      <View style={styles.controlsContainer}>
        <View style={styles.buttonContainer}>
          <Button
            title={t('Global.Continue')}
            accessibilityLabel={t('Global.Continue')}
            testID={testIdWithKey('Continue')}
            onPress={onContinueTouched}
            buttonType={ButtonType.ModalPrimary}
            disabled={requestInProgress}
          />
        </View>
        <View style={styles.buttonContainer}>
          <Button
            title={t('Global.NotNow')}
            accessibilityLabel={t('Global.NotNow')}
            testID={testIdWithKey('NotNow')}
            onPress={onNotNowTouched}
            buttonType={ButtonType.ModalSecondary}
          />
        </View>
      </View>
    </SafeAreaView>
  )
}

export default CameraDisclosureModal
