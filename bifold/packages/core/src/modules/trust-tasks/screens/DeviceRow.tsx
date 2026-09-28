/**
 * One device on My devices (new-phone-new-device-plan.md §B): its name, what
 * it is and when it was last seen, and one action. Another phone gets
 * "Remove this phone"; anything else a plain Remove; this phone is never
 * removed here, only renamed. A device the agent still lists as removed says
 * so, and offers nothing.
 *
 * @module trust-tasks/screens/DeviceRow
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import { type DeviceStatus, lastSeenOf, platformKeyOf } from './deviceWords'
import { didHashKey } from './testIdKey'

/** A device as the row shows it: its name already worded, its state already read. */
export interface DeviceView {
  did: string
  name: string
  platform?: string
  lastSeenAt?: string
  status: DeviceStatus
  thisPhone: boolean
  /** A Keyring phone, so "Remove this phone" rather than a plain Remove. */
  phone: boolean
}

export const DeviceRow: React.FC<{
  device: DeviceView
  onRemove: () => void
  onRename: () => void
  busy?: boolean
  disabled?: boolean
  now?: Date
}> = ({ device, onRemove, onRename, busy, disabled, now }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [details, setDetails] = useState(false)
  const key = didHashKey(device.did)

  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    did: { fontFamily: 'Menlo', fontSize: 12, color: ColorPalette.grayscale.mediumGrey },
  })

  const seen = lastSeenOf(device.lastSeenAt, now)
  const seenText = !seen
    ? undefined
    : seen.key === 'Devices.SeenOn'
      ? t(seen.key, {
          date: seen.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
        })
      : t(seen.key, 'count' in seen ? { count: seen.count } : undefined)
  const platformKey = platformKeyOf(device.platform)
  const about = [
    device.thisPhone ? t('Devices.ThisPhone') : undefined,
    platformKey ? t(platformKey) : undefined,
    seenText,
  ]
    .filter(Boolean)
    .join(' · ')
  const removed = device.status !== 'active'

  return (
    <View style={styles.card} testID={testIdWithKey(`AgentDevice_${key}`)}>
      <View style={{ gap: 2 }}>
        <ThemedText variant="bold">{device.name}</ThemedText>
        {about ? <ThemedText style={styles.muted}>{about}</ThemedText> : null}
        {removed ? (
          <ThemedText testID={testIdWithKey(`AgentDeviceState_${key}`)}>{t('Devices.RemovedErasePending')}</ThemedText>
        ) : null}
      </View>
      {device.thisPhone ? (
        <Button
          title={t('Devices.Rename')}
          buttonType={ButtonType.Secondary}
          onPress={onRename}
          disabled={disabled}
          testID={testIdWithKey('AgentDeviceRename')}
        />
      ) : removed ? null : (
        <Button
          title={t(device.phone ? 'Devices.RemoveThisPhone' : 'Devices.Remove')}
          buttonType={ButtonType.Secondary}
          onPress={onRemove}
          disabled={disabled}
          testID={testIdWithKey(`AgentDeviceRemove_${key}`)}
        >
          {busy ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
        </Button>
      )}
      <Pressable
        onPress={() => setDetails(!details)}
        accessibilityRole="button"
        accessibilityState={{ expanded: details }}
        testID={testIdWithKey(`AgentDeviceDetails_${key}`)}
      >
        <ThemedText style={styles.muted}>{t('Devices.Details')}</ThemedText>
      </Pressable>
      {details ? (
        <ThemedText style={styles.did} selectable testID={testIdWithKey(`AgentDeviceDid_${key}`)}>
          {device.did}
        </ThemedText>
      ) : null}
    </View>
  )
}
