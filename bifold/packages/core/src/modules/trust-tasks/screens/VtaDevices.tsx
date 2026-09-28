/**
 * The devices that run your agent (own_agent_subtask.md §4;
 * new-phone-new-device-plan.md §B): this phone first, then the others, each
 * with its name, what it is and when it was last seen. The way back in after
 * a lost phone: another device opens this list and removes the lost one.
 *
 * Remove is an owner act: the controller asks for Face ID first and sends
 * nothing without it. Removing cuts the device's access (and, for a
 * registered phone, asks it to erase its copy), and it leaves the list. This
 * phone is never offered for removal, only renamed. Refusals are worded by
 * reason, beside the list.
 *
 * @module trust-tasks/screens/VtaDevices
 */
import { useAgent } from '@bifold/react-hooks'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Platform, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { AgentDevice } from '../module/vtaDevices'
import { deviceRefusalOf } from '../module/vtaOwner'

import { DeviceNamePrompt } from './DeviceNamePrompt'
import { DeviceRow } from './DeviceRow'
import { LostPhoneCard, type RotationSupport } from './LostPhoneCard'
import { deviceViewOf } from './deviceWords'
import { didHashKey } from './testIdKey'

/**
 * A row's handle for tests: {@link didHashKey} of the device's whole DID. Not
 * its tail: two did:peer:2 keys on one mediator share their last characters.
 */
export const deviceKey = (did: string): string => didHashKey(did)

export { deviceNameKey } from './deviceWords'

/**
 * A device action's refusal in words: a cancelled Face ID says nothing, no
 * screen lock says how to set one, and the agent's refusals by reason.
 */
export const deviceErrorWords = (e: unknown, t: (key: string) => string): string | undefined => {
  if (e instanceof Error && e.name === 'OwnerNotConfirmed') {
    const reason = (e as { reason?: string }).reason
    return reason === 'cancelled'
      ? undefined
      : reason === 'unavailable'
        ? t(Platform.OS === 'ios' ? 'CreateAgent.NeedsScreenLockIos' : 'CreateAgent.NeedsScreenLockAndroid')
        : t('CreateAgent.NotConfirmed')
  }
  return t(`CreateAgent.Device.${deviceRefusalOf(e).reason}`)
}

/** This phone first; the rest in the agent's order. */
const thisPhoneFirst = (devices: AgentDevice[]): AgentDevice[] => [
  ...devices.filter((d) => d.isThisPhone),
  ...devices.filter((d) => !d.isThisPhone),
]

const VtaDevices: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [devices, setDevices] = useState<AgentDevice[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [removed, setRemoved] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [renaming, setRenaming] = useState(false)
  const [rotation, setRotation] = useState<RotationSupport | undefined>()
  const navigation = useNavigation()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  const wordsFor = useCallback((e: unknown) => deviceErrorWords(e, t), [t])

  const load = useCallback(async () => {
    if (!agent) return
    setError(undefined)
    try {
      setDevices(thisPhoneFirst(await vtaAgent.agentDevices(agent)))
    } catch (e) {
      setError(wordsFor(e))
    }
  }, [agent, wordsFor])

  useFocusEffect(
    useCallback(() => {
      void load()
      if (agent) void vtaAgent.canRotatePersonaKeys(agent).then(setRotation)
    }, [load, agent])
  )

  /**
   * A lost phone's second step (new-phone-new-device-plan.md §D): every
   * identity's keys, behind one owner check. Identities that could not be
   * changed, or changed but not yet published, are said, and the button
   * stays to try again.
   */
  const onRotate = async () => {
    if (!agent) return
    const { unpublished, failed } = await vtaAgent.rotateAllPersonaKeys(agent)
    if (failed.length > 0)
      throw Object.assign(new Error('some identities were not changed'), { partial: failed.length })
    // Changed on the agent, but its host doesn't serve the new keys yet: others
    // may still check the old ones, so it is never "Done" (lab O9).
    if (unpublished.length > 0) {
      throw Object.assign(new Error('some new keys are not published yet'), { unpublished: unpublished.length })
    }
  }
  const rotateWords = (e: unknown): string | undefined => {
    if (e && typeof e === 'object' && 'partial' in e) {
      return t('AgentKeys.RotatePartial', { count: (e as { partial: number }).partial })
    }
    if (e && typeof e === 'object' && 'unpublished' in e) {
      return t('AgentKeys.RotateUnpublished', { count: (e as { unpublished: number }).unpublished })
    }
    return deviceErrorWords(e, t)
  }

  const onRemove = async (device: AgentDevice) => {
    if (!agent) return
    setError(undefined)
    setRemoved(undefined)
    setBusy(device.did)
    try {
      const { mode } = await vtaAgent.removeAgentDevice(agent, device)
      const name = deviceViewOf(device, t).name
      setRemoved(
        t(mode === 'wiped' ? 'Devices.RemovedWiped' : 'Devices.Removed', {
          device: name,
          interpolation: { escapeValue: false },
        })
      )
      await load()
    } catch (e) {
      setError(wordsFor(e))
    } finally {
      setBusy(undefined)
    }
  }

  const onRename = async (name: string) => {
    if (!agent) return
    setError(undefined)
    setBusy('rename')
    try {
      await vtaAgent.renameThisDevice(agent, name)
      setRenaming(false)
      await load()
    } catch (e) {
      setError(wordsFor(e))
    } finally {
      setBusy(undefined)
    }
  }

  const here = devices?.find((d) => d.isThisPhone)

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
        {removed ? <ThemedText testID={testIdWithKey('AgentDeviceRemoved')}>{removed}</ThemedText> : null}
        {error ? (
          <ThemedText style={styles.error} testID={testIdWithKey('AgentDeviceError')}>
            {error}
          </ThemedText>
        ) : null}
        {devices === undefined && !error ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
        {renaming && here ? (
          <DeviceNamePrompt
            initial={deviceViewOf(here, t).name}
            onSave={(name) => void onRename(name)}
            busy={busy === 'rename'}
          />
        ) : null}
        {devices?.map((device) => (
          <DeviceRow
            key={device.did}
            device={deviceViewOf(device, t)}
            onRemove={() => void onRemove(device)}
            onRename={() => setRenaming(true)}
            busy={busy === device.did}
            disabled={busy !== undefined}
          />
        ))}
        {/* Also when only this phone is left: a lost phone that never
            registered is gone from the list once revoked, and its keys
            still want changing. */}
        {devices ? <LostPhoneCard rotation={rotation} onRotate={onRotate} errorOf={rotateWords} /> : null}
        {devices?.length === 1 ? (
          <ThemedText style={styles.muted} testID={testIdWithKey('AgentDeviceOnlyThis')}>
            {t('Devices.OnlyThisPhone')}
          </ThemedText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaDevices
