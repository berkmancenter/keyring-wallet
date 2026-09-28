/**
 * The one-time offer on a newly linked phone (new-phone-new-device-plan.md
 * §B): the person's other phones, each with Keep and Remove as equal choices,
 * as openvtc offers and never preselects. Nothing is removed without a press,
 * and Done leaves at any point with the rest kept. My devices stays the place
 * to change this later.
 *
 * @module trust-tasks/screens/NewPhoneOffer
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import type { DeviceView } from './DeviceRow'
import { platformKeyOf } from './deviceWords'
import { didHashKey } from './testIdKey'

type Choice = 'kept' | 'removed'

export const NewPhoneOffer: React.FC<{
  devices: DeviceView[]
  onRemove: (did: string) => Promise<void>
  /** Words for a refused removal; undefined says nothing (a cancelled confirmation). */
  errorOf: (e: unknown) => string | undefined
  onDone: () => void
}> = ({ devices, onRemove, errorOf, onDone }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const others = devices.filter((d) => d.phone && !d.thisPhone && d.status === 'active')

  const styles = StyleSheet.create({
    content: { gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 12 },
    actions: { flexDirection: 'row', gap: 12 },
    action: { flex: 1 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
  })

  const remove = async (did: string) => {
    setError(undefined)
    setBusy(did)
    try {
      await onRemove(did)
      setChoices((c) => ({ ...c, [did]: 'removed' }))
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <View style={styles.content}>
      <ThemedText variant="headingThree" accessibilityRole="header">
        {t('Devices.OfferTitle')}
      </ThemedText>
      <ThemedText>{t('Devices.OfferBody')}</ThemedText>
      {error ? (
        <ThemedText style={styles.error} testID={testIdWithKey('OfferError')}>
          {error}
        </ThemedText>
      ) : null}
      {others.map((device) => {
        const key = didHashKey(device.did)
        const choice = choices[device.did]
        const platformKey = platformKeyOf(device.platform)
        return (
          <View key={device.did} style={styles.card} testID={testIdWithKey(`OfferDevice_${key}`)}>
            <View style={{ gap: 2 }}>
              <ThemedText variant="bold">{device.name}</ThemedText>
              {platformKey ? <ThemedText style={styles.muted}>{t(platformKey)}</ThemedText> : null}
            </View>
            {choice ? (
              <ThemedText testID={testIdWithKey(`OfferChoice_${key}`)}>
                {t(choice === 'kept' ? 'Devices.OfferKept' : 'Devices.RemovedErasePending')}
              </ThemedText>
            ) : (
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button
                    title={t('Devices.OfferKeep')}
                    buttonType={ButtonType.Secondary}
                    onPress={() => setChoices((c) => ({ ...c, [device.did]: 'kept' }))}
                    disabled={busy !== undefined}
                    testID={testIdWithKey(`OfferKeep_${key}`)}
                  />
                </View>
                <View style={styles.action}>
                  <Button
                    title={t('Devices.OfferRemove')}
                    buttonType={ButtonType.Secondary}
                    onPress={() => void remove(device.did)}
                    disabled={busy !== undefined}
                    testID={testIdWithKey(`OfferRemove_${key}`)}
                  >
                    {busy === device.did ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
                  </Button>
                </View>
              </View>
            )}
          </View>
        )
      })}
      <ThemedText style={styles.muted}>{t('Devices.OfferLater')}</ThemedText>
      <Button
        title={t('Devices.OfferDone')}
        buttonType={ButtonType.Primary}
        onPress={onDone}
        disabled={busy !== undefined}
        testID={testIdWithKey('OfferDone')}
      />
    </View>
  )
}
