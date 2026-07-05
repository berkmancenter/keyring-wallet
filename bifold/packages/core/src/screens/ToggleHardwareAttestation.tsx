import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import ToggleButton from '../components/buttons/ToggleButton'
import FauxHeader from '../components/misc/FauxHeader'
import SafeAreaModal from '../components/modals/SafeAreaModal'
import { ThemedText } from '../components/texts/ThemedText'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import PINVerify, { PINEntryUsage } from './PINVerify'

const ToggleHardwareAttestation: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const [attestationEnabled, setAttestationEnabled] = useState(store.preferences.useHardwareAttestation)
  const [canSeeCheckPIN, setCanSeeCheckPIN] = useState<boolean>(false)
  const { ColorPalette, NavigationTheme, Assets } = useTheme()

  const styles = StyleSheet.create({
    container: {
      height: '100%',
      padding: 20,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    imageContainer: {
      alignItems: 'center' as const,
      marginBottom: 40,
    },
    descriptionGap: {
      rowGap: 20,
    },
  })

  const handleToggle = useCallback(() => {
    setCanSeeCheckPIN(true)
  }, [])

  const onAuthenticationComplete = useCallback(
    (status: boolean) => {
      if (status) {
        const newValue = !attestationEnabled
        setAttestationEnabled(newValue)
        dispatch({
          type: DispatchAction.USE_HARDWARE_ATTESTATION,
          payload: [newValue],
        })
      }
      setCanSeeCheckPIN(false)
    },
    [attestationEnabled, dispatch]
  )

  const onBackPressed = () => setCanSeeCheckPIN(false)

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']}>
      <ScrollView style={styles.container}>
        <View style={styles.imageContainer}>
          <Assets.svg.hardwareAttestation width={200} height={200} />
        </View>
        <View style={styles.descriptionGap}>
          <ThemedText>{t('Settings.HardwareAttestationDescription')}</ThemedText>
          <ThemedText>
            {t('Settings.HardwareAttestationPINConfirmNotice')}
          </ThemedText>
        </View>
        <View style={{ flexDirection: 'row', marginVertical: 20 }}>
          <View style={{ flexShrink: 1, marginRight: 10, justifyContent: 'center' }}>
            <ThemedText variant="bold">{t('Settings.HardwareAttestation')}</ThemedText>
          </View>
          <View style={{ justifyContent: 'center' }}>
            <ToggleButton
              testID={testIdWithKey('ToggleHardwareAttestation')}
              isEnabled={attestationEnabled}
              isAvailable={true}
              toggleAction={handleToggle}
              disabled={false}
              enabledIcon="check"
              disabledIcon="close"
            />
          </View>
        </View>
      </ScrollView>
      <SafeAreaModal
        style={{ backgroundColor: ColorPalette.brand.primaryBackground }}
        visible={canSeeCheckPIN}
        transparent={false}
        animationType={'slide'}
        presentationStyle={'fullScreen'}
        statusBarTranslucent={true}
      >
        <SafeAreaView edges={['top']} style={{ backgroundColor: NavigationTheme.colors.primary }} />
        <FauxHeader title={t('Screens.EnterPIN')} onBackPressed={onBackPressed} />
        <PINVerify
          usage={PINEntryUsage.ChangeHardwareAttestation}
          setAuthenticated={onAuthenticationComplete}
          onCancelAuth={setCanSeeCheckPIN}
        />
      </SafeAreaModal>
    </SafeAreaView>
  )
}

export default ToggleHardwareAttestation
