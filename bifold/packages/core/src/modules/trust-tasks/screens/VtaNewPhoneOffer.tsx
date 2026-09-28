/**
 * The one-time offer after a new phone links (new-phone-new-device-plan.md
 * §B): the agent's other registered phones, each with Keep and Remove as
 * equal choices, then on to the agent. It never holds the person up: with no
 * other phone, or a list the agent won't give, it goes straight on. My
 * devices stays the place to change this later.
 *
 * @module trust-tasks/screens/VtaNewPhoneOffer
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { AgentDevice } from '../module/vtaDevices'

import { deviceViewOf } from './deviceWords'
import { NewPhoneOffer } from './NewPhoneOffer'
import { deviceErrorWords } from './VtaDevices'

/**
 * What the offer lists: this phone and the phones that registered as Keyring
 * (openvtc offers from its device registry too). Admins that never registered
 * (a computer, the browser plugin, a harness key) stay on My devices; an old
 * Keyring phone registers itself once it updates, and is offered from then on.
 */
const offered = (devices: AgentDevice[]): AgentDevice[] =>
  devices.filter((d) => d.isThisPhone || (d.source === 'registered' && d.kind === 'keyring'))

const VtaNewPhoneOffer: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const navigation = useNavigation()
  const [devices, setDevices] = useState<AgentDevice[] | undefined>()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
  })

  const onDone = useCallback(() => {
    // As the link screen's Continue did: the agent screen, set rather than pushed.
    const stack = navigation as unknown as { reset: (state: { index: number; routes: { name: string }[] }) => void }
    stack.reset({ index: 0, routes: [{ name: Screens.VtaAgent }] })
  }, [navigation])

  useEffect(() => {
    if (!agent) return
    let live = true
    vtaAgent
      .agentDevices(agent)
      .then((list) => {
        if (!live) return
        const mine = offered(list)
        const views = mine.map((d) => deviceViewOf(d, t))
        if (!views.some((v) => v.phone && !v.thisPhone && v.status === 'active')) onDone()
        else setDevices(mine)
      })
      .catch(() => {
        if (live) onDone()
      })
    return () => {
      live = false
    }
  }, [agent, t, onDone])

  const onRemove = async (did: string) => {
    const device = devices?.find((d) => d.did === did)
    if (!agent || !device) return
    await vtaAgent.removeAgentDevice(agent, device)
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('NewPhoneOffer')}>
        {devices === undefined ? (
          <ActivityIndicator color={ColorPalette.brand.primary} />
        ) : (
          <NewPhoneOffer
            devices={devices.map((d) => deviceViewOf(d, t))}
            onRemove={onRemove}
            errorOf={(e) => deviceErrorWords(e, t)}
            onDone={onDone}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaNewPhoneOffer
