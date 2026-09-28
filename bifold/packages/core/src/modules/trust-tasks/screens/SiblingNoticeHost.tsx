/**
 * "Also open as you", from the presence loop (new-phone-new-device-plan.md
 * §F). The loop emits {@link SIBLING_SEEN_EVENT} when another device starts
 * acting as this agent; this names it once a session, as openvtc does, with a
 * way to My devices. Mounted above the tabs beside the offline banner, so it
 * hears the loop's first tick.
 *
 * @module trust-tasks/screens/SiblingNoticeHost
 */
import { useNavigation } from '@react-navigation/native'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter, StyleSheet, View } from 'react-native'

import { Screens, TabStacks } from '../../../types/navigators'
import type { AgentDevice } from '../module/vtaDevices'
import { SIBLING_SEEN_EVENT } from '../module/vtaPresence'

import { deviceViewOf } from './deviceWords'
import { SiblingNotice } from './SiblingNotice'

/**
 * The devices already named this session. The loop announces a device again
 * whenever it comes back into its liveness window; the person is told once.
 * Module state, so a remounted host still remembers.
 */
const announced = new Set<string>()

/** For tests: a new session. */
export const resetSiblingsAnnounced = (): void => announced.clear()

export const SiblingNoticeHost: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const [pending, setPending] = useState<AgentDevice[]>([])

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(SIBLING_SEEN_EVENT, (device: AgentDevice) => {
      if (!device?.did || announced.has(device.did)) return
      announced.add(device.did)
      setPending((now) => (now.some((d) => d.did === device.did) ? now : [...now, device]))
    })
    return () => subscription.remove()
  }, [])

  if (pending.length === 0) return null

  const styles = StyleSheet.create({ host: { paddingHorizontal: 16, paddingVertical: 8 } })

  return (
    <View style={styles.host}>
      <SiblingNotice
        names={pending.map((d) => deviceViewOf(d, t).name)}
        onOpen={() => {
          setPending([])
          ;(navigation as unknown as { navigate: (n: string, p?: object) => void }).navigate(TabStacks.MyAgentStack, {
            screen: Screens.VtaDevices,
          })
        }}
        onDismiss={() => setPending([])}
      />
    </View>
  )
}
