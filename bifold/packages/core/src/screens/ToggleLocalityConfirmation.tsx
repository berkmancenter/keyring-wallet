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

/**
 * Settings → Secure Exchanges toggle for locality confirmation
 * (docs/plans/locality-plan.md §8.1, §8.4). Deliberately no PIN gate — §8.4
 * frames this as a single, low-friction toggle beside `useWitnessing`'s own
 * (no-PIN) pattern, not `useHardwareAttestation`'s (which gates a
 * signing-key preference, a different kind of consequence).
 *
 * Off means: no BLE advertisement, no GATT response, no Bluetooth permission
 * ever requested — the exchange still runs, the witness records
 * `method: "none", confirmed: false, reason: "declinedByHolder"`. This
 * screen only flips the flag; the actual gate lives where the witnessed
 * exchange assembles the session request (trust-tasks/ceremony.ts).
 */
const ToggleLocalityConfirmation: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const [localityEnabled, setLocalityEnabled] = useState(store.preferences.useLocalityConfirmation)
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
    const newValue = !localityEnabled
    setLocalityEnabled(newValue)
    dispatch({
      type: DispatchAction.USE_LOCALITY_CONFIRMATION,
      payload: [newValue],
    })
  }, [localityEnabled, dispatch])

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']}>
      <ScrollView style={styles.container}>
        <View style={styles.descriptionGap}>
          <ThemedText>{t('Settings.LocalityConfirmationDescription')}</ThemedText>
        </View>
        <View style={{ flexDirection: 'row', marginVertical: 20 }}>
          <View style={{ flexShrink: 1, marginRight: 10, justifyContent: 'center' }}>
            <ThemedText variant="bold">{t('Settings.LocalityConfirmation')}</ThemedText>
          </View>
          <View style={{ justifyContent: 'center' }}>
            <ToggleButton
              testID={testIdWithKey('ToggleLocalityConfirmation')}
              isEnabled={localityEnabled}
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

export default ToggleLocalityConfirmation
