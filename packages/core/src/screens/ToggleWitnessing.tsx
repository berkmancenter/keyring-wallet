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

const ToggleWitnessing: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const [witnessingEnabled, setWitnessingEnabled] = useState(store.preferences.useWitnessing)
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
    const newValue = !witnessingEnabled
    setWitnessingEnabled(newValue)
    dispatch({
      type: DispatchAction.USE_WITNESSING,
      payload: [newValue],
    })
  }, [witnessingEnabled, dispatch])

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']}>
      <ScrollView style={styles.container}>
        <View style={styles.descriptionGap}>
          <ThemedText>{t('Settings.WitnessingDescription')}</ThemedText>
        </View>
        <View style={{ flexDirection: 'row', marginVertical: 20 }}>
          <View style={{ flexShrink: 1, marginRight: 10, justifyContent: 'center' }}>
            <ThemedText variant="bold">{t('Settings.Witnessing')}</ThemedText>
          </View>
          <View style={{ justifyContent: 'center' }}>
            <ToggleButton
              testID={testIdWithKey('ToggleWitnessing')}
              isEnabled={witnessingEnabled}
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

export default ToggleWitnessing
