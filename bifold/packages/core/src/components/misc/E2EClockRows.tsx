import React from 'react'
import { StyleSheet, View } from 'react-native'

import { defaultAutoLockTime } from '../../constants'
import { TOKENS, useContainer } from '../../container-api'
import { useStore } from '../../contexts/store'
import { GRANT_POLL_WINDOW_MS, PHONE_GRANT_POLL_WINDOW_MS } from '../../modules/trust-tasks/clocks'
import {
  e2eClocksSet,
  effectiveDefaultAutoLockMinutes,
  effectiveGrantPollWindowMs,
  shortClocks,
} from '../../utils/e2eClocks'
import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 10,
    marginHorizontal: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: { marginRight: 10, textAlign: 'left' },
})

/**
 * The clocks in force, for the gate's linkwait rows to read (gate efficiency items 3 and 4): one row each under the
 * testIDs E2EClocksMode, E2EGrantWindowSeconds, E2EPhoneGrantWindowSeconds and E2EAutoLockMinutes. Only in a test
 * build (E2E_CLOCKS set, to `short` or `real`); a store build never sets it (the staging workflow refuses it), so
 * there it renders nothing. Every Developer screen renders it: bifold's, and an app's own that replaces it.
 */
export const E2EClockRows: React.FC = () => {
  const [store] = useStore()
  // The lock in force: the same fallback contexts/activity uses (a saved time wins).
  const customAutoLockTimes = useContainer()?.resolve(TOKENS.CONFIG)?.customAutoLockTimes
  if (!e2eClocksSet()) return null
  const rows = [
    { testID: testIdWithKey('E2EClocksMode'), label: 'Clocks', value: shortClocks() ? 'short' : 'real' },
    {
      testID: testIdWithKey('E2EGrantWindowSeconds'),
      label: 'Grant window (s)',
      value: String(effectiveGrantPollWindowMs(GRANT_POLL_WINDOW_MS) / 1000),
    },
    {
      testID: testIdWithKey('E2EPhoneGrantWindowSeconds'),
      label: 'Phone grant window (s)',
      value: String(effectiveGrantPollWindowMs(PHONE_GRANT_POLL_WINDOW_MS) / 1000),
    },
    {
      testID: testIdWithKey('E2EAutoLockMinutes'),
      label: 'Auto-lock (min)',
      value: String(
        store.preferences.autoLockTime ??
          effectiveDefaultAutoLockMinutes(customAutoLockTimes?.default?.time ?? defaultAutoLockTime)
      ),
    },
  ]
  return (
    <>
      {rows.map(({ testID, label, value }) => (
        <View key={testID} style={styles.row}>
          <ThemedText variant="bold" style={styles.label}>
            {label}
          </ThemedText>
          <ThemedText testID={testID}>{value}</ThemedText>
        </View>
      ))}
    </>
  )
}

export default E2EClockRows
