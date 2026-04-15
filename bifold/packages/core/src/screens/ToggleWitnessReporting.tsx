import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import ToggleButton from '../components/buttons/ToggleButton'
import { ThemedText } from '../components/texts/ThemedText'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'

const ToggleWitnessReporting: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const [reportingEnabled, setReportingEnabled] = useState(store.witness.enableReporting)
  const { ColorPalette } = useTheme()

  const styles = StyleSheet.create({
    container: {
      height: '100%',
      padding: 20,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    descriptionGap: {
      rowGap: 20,
    },
  })

  const handleToggle = useCallback(() => {
    const newValue = !reportingEnabled
    setReportingEnabled(newValue)
    dispatch({
      type: DispatchAction.UPDATE_WITNESS_SETTINGS,
      payload: [{ ...store.witness, enableReporting: newValue }],
    })
  }, [reportingEnabled, store.witness, dispatch])

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']}>
      <ScrollView style={styles.container}>
        <View style={styles.descriptionGap}>
          <ThemedText>{t('Settings.WitnessReportingDescription')}</ThemedText>
          <ThemedText>{t('Settings.WitnessReportingPrivacyNotice')}</ThemedText>
        </View>
        <View style={{ flexDirection: 'row', marginVertical: 20 }}>
          <View style={{ flexShrink: 1, marginRight: 10, justifyContent: 'center' }}>
            <ThemedText variant="bold">{t('Settings.WitnessReporting')}</ThemedText>
          </View>
          <View style={{ justifyContent: 'center' }}>
            <ToggleButton
              testID={testIdWithKey('ToggleWitnessReporting')}
              isEnabled={reportingEnabled}
              isAvailable={true}
              toggleAction={handleToggle}
              disabled={false}
              enabledIcon="check"
              disabledIcon="close"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export default ToggleWitnessReporting
