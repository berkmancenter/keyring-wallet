/**
 * Developer screen: which JS this phone runs, and the ring it is in.
 *
 * Joining ring 0 is how a maintainer's own device gets a bundle first. The
 * bundle id is shown under a testID so the gate's OTA smoke can assert which
 * bundle a phone actually runs.
 */
import { testIdWithKey, useTheme } from '@bifold/core'
import { HotUpdater } from '@hot-updater/react-native'
import React, { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { readOtaStatus, OtaStatus } from './otaStatus'
import { DEFAULT_RING, Ring, setRing } from './rings'

const readSafely = (): OtaStatus | undefined => {
  try {
    return readOtaStatus()
  } catch {
    return undefined
  }
}

const OtaDeveloperSection: React.FC = () => {
  const { SettingsTheme, TextTheme, ColorPalette } = useTheme()
  const [status, setStatus] = useState<OtaStatus | undefined>(readSafely)

  const moveTo = useCallback((ring: Ring) => {
    setRing(HotUpdater, ring)
    setStatus(readSafely())
  }, [])

  // testID is the full id (testIdWithKey('…') with a literal key at each call),
  // so the e2e testID manifest (e2e/scripts/gen-app-testids.mjs) can see it.
  const line = (label: string, value: string, testID?: string) => (
    <Text
      testID={testID}
      accessibilityLabel={testID ? value : undefined}
      style={{ ...TextTheme.normal, fontSize: 14, marginTop: 6 }}
    >
      {`${label}: ${value}`}
    </Text>
  )

  if (!status) {
    return (
      <View style={{ backgroundColor: SettingsTheme.groupBackground, padding: 24 }}>
        {line('State', 'not in this build')}
      </View>
    )
  }

  const inRing0 = status.ring === 'ring0'
  return (
    <View style={{ backgroundColor: SettingsTheme.groupBackground, padding: 24 }}>
      {line('State', status.enabled ? 'on' : 'off (this build names no update server)')}
      {line(
        'Running',
        status.embedded ? `embedded (${status.bundleId})` : status.bundleId,
        testIdWithKey('OtaBundleId')
      )}
      {line('Channel', status.channel)}
      {line('Ring', status.ring ?? 'none', testIdWithKey('OtaRing'))}
      {line('Native fingerprint', status.fingerprint ?? 'none')}
      {status.rolledBack.length > 0 &&
        line('Rolled back', status.rolledBack.join(', '), testIdWithKey('OtaRolledBack'))}
      {status.enabled && (
        <Pressable
          onPress={() => moveTo(inRing0 ? DEFAULT_RING : 'ring0')}
          testID={inRing0 ? testIdWithKey('OtaLeaveRing0') : testIdWithKey('OtaJoinRing0')}
          accessibilityLabel={inRing0 ? 'Leave ring 0' : 'Join ring 0'}
          style={{
            backgroundColor: ColorPalette.brand.primary,
            paddingVertical: 12,
            borderRadius: 8,
            alignItems: 'center',
            marginTop: 12,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
            {inRing0 ? 'Leave ring 0' : 'Join ring 0 (maintainer devices)'}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

export default OtaDeveloperSection
