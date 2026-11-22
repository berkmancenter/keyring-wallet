/**
 * Before an invitation goes out as a link: ask a person whose phone could be woken to turn notifications on (IN-448).
 *
 * A link is the remote case: the other person's steps reach a phone while Keyring is closed only through a push, and
 * a phone is wakeable only when the build has push (`enablePushNotifications`), the phone is linked to an agent, and
 * notifications are allowed. So `useRemoteVrcNotificationsGate` says to ask only where turning them on actually makes
 * the phone wakeable: push in the build, an agent linked, permission not yet given. A code scanned in the room needs
 * none of this: both people are there. The ask is a sheet on the "Share as a link" tap, because the QR screen does
 * not scroll and has no room for it.
 *
 * Every way out carries on to the share: the ask never stands between a person and their link. "Turn on" asks for
 * the permission and, once given, makes the phone wakeable (the app's toggle: the gateway, the agent's set-wake, the
 * mediator's device info). "Not now" puts it away for this run of the app. If that doesn't work, or an approval rule
 * on the agent holds it, the sheet says so first: it asked, so it shouldn't go quiet about the answer.
 *
 * @module vrc/components/RemoteVrcNotificationsAsk
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { TOKENS, useServices } from '../../../container-api'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../../trust-tasks/module/vtaAgent'

/** How long the share waits for the phone to be made wakeable; that goes on regardless. */
export const WAKEABLE_WAIT_MS = 4000
/**
 * iOS can't open the share sheet while this sheet is leaving, so it waits for that, or this long if never told. Long
 * on purpose: too long opens the share a moment late, too short and "Share as a link" silently does nothing.
 */
export const DISMISS_FALLBACK_MS = 1500

/** Put away for this run of the app ("Not now", or done). */
let putAway = false

/** For tests. */
export function resetRemoteVrcNotificationsAsk(): void {
  putAway = false
}

/** Whether a share should ask first. Read at the tap, so a permission changed in Settings counts. */
export function useRemoteVrcNotificationsGate(): () => Promise<boolean> {
  const [{ enablePushNotifications }] = useServices([TOKENS.CONFIG])
  return useCallback(async () => {
    if (putAway || !enablePushNotifications || vtaAgent.getState().link.kind !== 'linked') return false
    try {
      return (await enablePushNotifications.status()) !== 'granted'
    } catch {
      return false
    }
  }, [enablePushNotifications])
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { flexShrink: 1, borderTopRightRadius: 20, borderTopLeftRadius: 20 },
  content: { padding: 24, gap: 12 },
})

/** Mounted while asking; `onDone` once, when the sheet has gone and the share can open. */
const RemoteVrcNotificationsAsk: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [{ enablePushNotifications }] = useServices([TOKENS.CONFIG])
  // Set when something stands between this phone and being woken: said here, then Continue goes on to the share.
  const [note, setNote] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(fallback.current), [])

  const finish = useCallback(() => {
    if (done.current) return
    done.current = true
    clearTimeout(fallback.current)
    onDone()
  }, [onDone])

  const leave = useCallback(() => {
    putAway = true
    setLeaving(true)
    if (Platform.OS === 'ios') fallback.current = setTimeout(finish, DISMISS_FALLBACK_MS)
    else finish()
  }, [finish])

  const turnOn = async () => {
    if (busy || !agent || !enablePushNotifications) return
    setBusy(true)
    try {
      const status = await enablePushNotifications.setup()
      if (status !== 'granted') {
        setNote('RemoteVrcNotify.Denied')
        return
      }
      // Past the wait it goes on on its own. An app whose `toggle` returns nothing hasn't said whether it worked.
      const outcome = await Promise.race([
        enablePushNotifications.toggle(true, agent),
        new Promise<'still going'>((resolve) => setTimeout(() => resolve('still going'), WAKEABLE_WAIT_MS)),
      ])
      // Read only once it has answered: past the wait, the flag is from before this try.
      if (outcome !== 'still going' && vtaAgent.getState().wakeBlockedByRule) {
        setNote('PushNotifications.BlockedByApprovalRule')
        return
      }
      if (outcome === 'failed') {
        setNote('PushNotifications.NotSetUpYet')
        return
      }
      leave()
    } catch (e) {
      agent.config.logger.warn(`[VRC] notifications for a remote exchange not turned on: ${(e as Error).message}`)
      setNote('RemoteVrcNotify.Denied')
    } finally {
      setBusy(false)
    }
  }

  const label = note ? t('Global.Continue') : t('RemoteVrcNotify.NotNow')
  return (
    <SafeAreaModal visible={!leaving} transparent animationType="slide" onDismiss={finish}>
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <SafeAreaView
          style={[styles.sheet, { backgroundColor: ColorPalette.brand.modalPrimaryBackground }]}
          edges={['bottom']}
        >
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            testID={testIdWithKey('RemoteVrcNotificationsAsk')}
          >
            <ThemedText>{t(note ?? 'RemoteVrcNotify.Ask')}</ThemedText>
            {!note && (
              <Button
                title={t('RemoteVrcNotify.TurnOn')}
                accessibilityLabel={t('RemoteVrcNotify.TurnOn')}
                testID={testIdWithKey('RemoteVrcNotificationsTurnOn')}
                buttonType={ButtonType.Primary}
                onPress={() => void turnOn()}
                disabled={busy}
              />
            )}
            <Button
              title={label}
              accessibilityLabel={label}
              testID={testIdWithKey('RemoteVrcNotificationsNotNow')}
              buttonType={ButtonType.Secondary}
              onPress={leave}
              disabled={busy}
            />
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaModal>
  )
}

export default RemoteVrcNotificationsAsk
