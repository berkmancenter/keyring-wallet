/**
 * "Also open as you", from the presence loop (new-phone-new-device-plan.md
 * §F). The loop emits {@link SIBLING_SEEN_EVENT} when another device starts
 * acting as this agent; this names it once a session, as openvtc does, with a
 * way to My devices.
 *
 * Two parts: the host, mounted above the tabs beside the offline banner so it
 * hears the loop's first tick, keeps what is to be said; the strip shows it
 * under the header of whichever screen is open (HeaderWithBanner).
 *
 * @module trust-tasks/screens/SiblingNoticeHost
 */
import { useNavigation } from '@react-navigation/native'
import React, { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'

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

/** What the strip says: the devices not yet dismissed, and whether it is open. One for every screen's header. */
interface Notice {
  pending: AgentDevice[]
  open: boolean
}
const NONE: Notice = { pending: [], open: false }
let notice: Notice = NONE
const listeners = new Set<() => void>()
const setNotice = (next: Notice) => {
  notice = next
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** For tests: a new session. */
export const resetSiblingsAnnounced = (): void => {
  announced.clear()
  setNotice(NONE)
}

export const SiblingNoticeHost: React.FC = () => {
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(SIBLING_SEEN_EVENT, (device: AgentDevice) => {
      if (!device?.did || announced.has(device.did)) return
      announced.add(device.did)
      if (!notice.pending.some((d) => d.did === device.did))
        setNotice({ ...notice, pending: [...notice.pending, device] })
    })
    return () => subscription.remove()
  }, [])

  return null
}

/**
 * The strip under a screen's header, while a device is still to be acknowledged.
 *
 * It renders inside every stack header (HeaderWithBanner), so two things hold it up:
 * - With nothing pending it must render nothing. That is `SiblingNotice` returning null on an empty list: keep that
 *   guard, or every screen in the app grows an empty strip.
 * - `useNavigation` needs a navigator: HeaderWithBanner is rendered only as a stack's `header`, and rendering it
 *   outside one would throw on every screen.
 *
 * Open or closed is one state for every header, on purpose: open it on Messages, go to My Agent, and it is open
 * there too. It is one notice about the person's devices, not about the screen, and it stays as they left it until
 * they answer it.
 */
export const SiblingNoticeStrip: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const { pending, open } = useSyncExternalStore(subscribe, () => notice)
  // Every stack header holds this strip: with no device to name it is nothing, here, whatever SiblingNotice does.
  if (pending.length === 0) return null

  return (
    <SiblingNotice
      names={pending.map((d) => deviceViewOf(d, t).name)}
      open={open}
      onToggle={() => setNotice({ ...notice, open: !notice.open })}
      onOpen={() => {
        setNotice(NONE)
        ;(navigation as unknown as { navigate: (n: string, p?: object) => void }).navigate(TabStacks.MyAgentStack, {
          screen: Screens.VtaDevices,
        })
      }}
      onDismiss={() => setNotice(NONE)}
    />
  )
}
