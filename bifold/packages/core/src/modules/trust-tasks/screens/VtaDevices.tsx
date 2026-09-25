/**
 * The devices that run your agent (own_agent_subtask.md §4): this phone and
 * its backups, each by name, with Remove on the others. The way back in after
 * a lost phone: the backup opens this list and removes the lost one.
 *
 * Remove is an owner act: the controller asks for Face ID first and sends
 * nothing without it. This phone is never offered for removal (and the agent
 * refuses it anyway). Refusals are worded by reason, beside the list.
 *
 * @module trust-tasks/screens/VtaDevices
 */
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent, type VtaDevice } from '../module/vtaAgent'
import { deviceRefusalOf } from '../module/vtaOwner'

/** A row's handle for tests: the last 8 characters of the device's DID. */
export const deviceKey = (did: string): string => did.slice(-8)

/**
 * What a person calls an admin of their agent. Every admin is listed, not
 * only Keyring phones: the label when there is one (Keyring's own rows read
 * "Keyring — <device name>"; the browser plugin's "browser-plugin …" reads as
 * "Browser plugin"), otherwise a plain fallback by the kind of key. Never the
 * DID: that sits behind Details.
 */
export const deviceNameKey = (device: Pick<VtaDevice, 'did' | 'label'>): { key?: string; label?: string } => {
  const label = device.label?.trim()
  if (label && /browser[- ]plugin/i.test(label)) return { key: 'Devices.BrowserPlugin' }
  if (label) return { label }
  if (device.did.startsWith('did:key:')) return { key: 'Devices.AComputer' }
  if (device.did.startsWith('did:peer:')) return { key: 'Devices.AKeyringPhone' }
  return { key: 'Devices.Unnamed' }
}

const VtaDevices: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [devices, setDevices] = useState<VtaDevice[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [removed, setRemoved] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [detailsOf, setDetailsOf] = useState<string | undefined>()
  const navigation = useNavigation()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    key: { fontFamily: 'Menlo', fontSize: 12, color: ColorPalette.grayscale.mediumGrey },
  })

  const wordsFor = useCallback(
    (e: unknown): string | undefined => {
      if (e instanceof Error && e.name === 'OwnerNotConfirmed') {
        const reason = (e as { reason?: string }).reason
        return reason === 'cancelled'
          ? undefined
          : reason === 'unavailable'
            ? t(Platform.OS === 'ios' ? 'CreateAgent.NeedsScreenLockIos' : 'CreateAgent.NeedsScreenLockAndroid')
            : t('CreateAgent.NotConfirmed')
      }
      return t(`CreateAgent.Device.${deviceRefusalOf(e).reason}`)
    },
    [t]
  )

  const load = useCallback(async () => {
    if (!agent) return
    setError(undefined)
    try {
      setDevices(await vtaAgent.listDevices(agent))
    } catch (e) {
      setError(wordsFor(e))
    }
  }, [agent, wordsFor])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const nameOf = (device: VtaDevice): string => {
    const { key, label } = deviceNameKey(device)
    return label ?? t(key ?? 'Devices.Unnamed')
  }

  const addedOn = (device: VtaDevice): string | undefined => {
    const createdAt = device.createdAt
    const when = createdAt ? new Date(createdAt) : undefined
    return when && !Number.isNaN(when.getTime())
      ? t('Devices.Added', { date: when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })
      : undefined
  }

  const onRemove = async (device: VtaDevice) => {
    if (!agent) return
    setError(undefined)
    setRemoved(undefined)
    setBusy(device.did)
    try {
      await vtaAgent.removeDevice(agent, device.did)
      setRemoved(nameOf(device))
      await load()
    } catch (e) {
      setError(wordsFor(e))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('AgentDeviceList')}>
        <ThemedText>{t('Devices.Intro')}</ThemedText>
        <Button
          title={t('Devices.AddAnother')}
          buttonType={ButtonType.Primary}
          onPress={() =>
            (navigation as unknown as { navigate: (n: string, p?: object) => void }).navigate(Screens.VtaCreateAgent, {
              addDevice: true,
            })
          }
          testID={testIdWithKey('AgentDeviceAdd')}
        />
        {removed ? (
          <ThemedText testID={testIdWithKey('AgentDeviceRemoved')}>
            {t('Devices.Removed', { device: removed, interpolation: { escapeValue: false } })}
          </ThemedText>
        ) : null}
        {error ? (
          <ThemedText style={styles.error} testID={testIdWithKey('AgentDeviceError')}>
            {error}
          </ThemedText>
        ) : null}
        {devices === undefined && !error ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
        {devices?.map((device) => (
          <View key={device.did} style={styles.card} testID={testIdWithKey(`AgentDevice_${deviceKey(device.did)}`)}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText variant="bold">{device.thisPhone ? t('Devices.ThisPhone') : nameOf(device)}</ThemedText>
                {addedOn(device) ? <ThemedText style={styles.muted}>{addedOn(device)}</ThemedText> : null}
              </View>
              {device.thisPhone ? null : (
                <Button
                  title={t('Devices.Remove')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => onRemove(device)}
                  disabled={busy !== undefined}
                  testID={testIdWithKey(`AgentDeviceRemove_${deviceKey(device.did)}`)}
                >
                  {busy === device.did ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
                </Button>
              )}
            </View>
            <Pressable
              onPress={() => setDetailsOf(detailsOf === device.did ? undefined : device.did)}
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOf === device.did }}
              testID={testIdWithKey(`AgentDeviceDetails_${deviceKey(device.did)}`)}
            >
              <ThemedText style={styles.muted}>{t('Devices.Details')}</ThemedText>
            </Pressable>
            {detailsOf === device.did ? (
              <ThemedText
                style={styles.key}
                selectable
                testID={testIdWithKey(`AgentDeviceDid_${deviceKey(device.did)}`)}
              >
                {device.did}
              </ThemedText>
            ) : null}
          </View>
        ))}
        {devices?.length === 1 ? <ThemedText style={styles.muted}>{t('Devices.OnlyThisPhone')}</ThemedText> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaDevices
