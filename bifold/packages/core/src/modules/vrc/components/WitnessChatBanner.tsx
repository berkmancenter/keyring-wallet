import React, { useCallback } from 'react'
import { View, Text, StyleSheet, Switch } from 'react-native'
import { useTranslation } from 'react-i18next'
import { NavigationProp, ParamListBase } from '@react-navigation/native'
import { useStore } from '../../../contexts/store'

interface WitnessChatBannerProps {
  connectionId: string
  navigation?: NavigationProp<ParamListBase>
}

const TOGGLE_ACTIVE_COLOR = '#A349A4'
const TOGGLE_INACTIVE_COLOR = '#9CA3AF'

export const WitnessChatBanner: React.FC<WitnessChatBannerProps> = ({ connectionId, navigation: _navigation }) => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()

  const useWitnessing = store.preferences.useWitnessing ?? true
  const enableReporting = store.witness?.enableReporting ?? true

  const handleToggleWitnessing = useCallback(() => {
    dispatch({
      type: 'preferences/useWitnessing',
      payload: [!useWitnessing],
    })
  }, [dispatch, useWitnessing])

  const handleToggleReporting = useCallback(() => {
    const currentReporting = store.witness?.enableReporting ?? true
    dispatch({
      type: 'witness/updateSettings',
      payload: [{ enableReporting: !currentReporting }],
    })
  }, [dispatch, store.witness])

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.toggleGroup}>
          <Text style={styles.label}>
            {t('Settings.Witnessing')}
          </Text>
          <Switch
            value={useWitnessing}
            onValueChange={handleToggleWitnessing}
            trackColor={{ false: TOGGLE_INACTIVE_COLOR, true: TOGGLE_ACTIVE_COLOR }}
            thumbColor="#FFFFFF"
          />
        </View>
        <View style={styles.toggleGroup}>
          <Text style={styles.label}>Reporting</Text>
          <Switch
            value={enableReporting}
            onValueChange={handleToggleReporting}
            trackColor={{ false: TOGGLE_INACTIVE_COLOR, true: TOGGLE_ACTIVE_COLOR }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(98, 44, 98, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: -1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  toggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },
})
