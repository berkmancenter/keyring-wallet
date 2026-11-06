/**
 * Connecting with someone from a scanned or pasted shared-connect link
 * (relationship over TSP, docs/plans/relationship-over-tsp-plan.md WP3):
 * reached only with the shared-connect developer flag on.
 *
 *  1. Reading — the link and the inviter's DID document, offline. Nothing is sent.
 *  2. Confirm — who is asking, as far as the code can say: the name they gave
 *     (marked unverified, or "No name given"), a short prefix of their DID and
 *     the host of their message relay. Nothing else from the code is shown,
 *     and the code itself is never displayed. Connect and Cancel; **nothing is
 *     sent before Connect** (VTI-LNK-052).
 *  3. Connecting, then waiting for the answer (Stop), and how it ended: connected, no answer yet
 *     (Ask again or Stop; the encounter stays open, so an unanswered request is never shown as
 *     failed), expired, declined, refused, or stopped by the person. The states come from the
 *     live session (`SharedConnectSteps.session`).
 *
 * Every step goes through one `SharedConnectSteps` object, so the screen is
 * tested with fakes and holds no protocol of its own.
 *
 * @module trust-tasks/screens/SharedConnect
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import type { MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { SessionState } from '../module/sharedConnect'
import {
  getSharedConnectSession,
  previewSharedConnect,
  startSharedConnect,
  type SharedConnectPreview,
  type SharedConnectPreviewResult,
  type SharedConnectStartResult,
} from '../module/sharedConnectStart'
import { TRIGGER_UI_MESSAGE_KEYS } from '../module/triggerLink'

import { SharedConnectIds } from './SharedConnect.ids'

const id = (key: string) => testIdWithKey(key)

/** The two things the screen does, so a test can stand in for both. */
export interface SharedConnectSteps {
  preview: (link: string) => Promise<SharedConnectPreviewResult>
  start: (link: string) => Promise<SharedConnectStartResult>
  /** The live session for an encounter (by its enactment), to watch, retry and stop. Absent when it already ended. */
  session?: (enactment: string) => SharedConnectHandle | undefined
}

/** The part of a session the screen uses. */
export interface SharedConnectHandle {
  readonly outcome: SessionState | undefined
  subscribe: (listener: (state: SessionState) => void) => () => void
  retry: () => Promise<void>
  cancel: () => Promise<void>
}

/** The words for a session ending that is final. `failed` is only ever the person stopping it. */
const FINAL_MESSAGE_KEYS: Record<string, string> = {
  completed: 'SharedConnect.Completed',
  declined: 'SharedConnect.Declined',
  refused: 'SharedConnect.Refused',
  expired: 'SharedConnect.Expired',
  failed: 'SharedConnect.Cancelled',
}

export const agentSharedConnectSteps = (agent: Parameters<typeof previewSharedConnect>[0]): SharedConnectSteps => ({
  preview: (link) => previewSharedConnect(agent, link),
  start: (link) => startSharedConnect(agent, link),
  session: (enactment) => getSharedConnectSession(enactment),
})

type Step =
  | { kind: 'reading' }
  | { kind: 'confirm'; preview: SharedConnectPreview }
  | { kind: 'connecting' }
  | { kind: 'waiting'; handle: SharedConnectHandle }
  | { kind: 'unanswered'; handle: SharedConnectHandle }
  | { kind: 'ended'; messageKey: string }

/** The time left as the person's clock reads it, e.g. a local time; never a raw timestamp. */
export const expiryText = (exp: number, locale?: string): string =>
  new Date(exp * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

export const SharedConnectFlow: React.FC<{
  link?: string
  steps: SharedConnectSteps
  onClose: () => void
}> = ({ link, steps, onClose }) => {
  const { t, i18n } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [step, setStep] = useState<Step>({ kind: 'reading' })

  useEffect(() => {
    let live = true
    if (!link) {
      setStep({ kind: 'ended', messageKey: TRIGGER_UI_MESSAGE_KEYS.invalid })
      return
    }
    steps
      .preview(link)
      .then((result) => {
        if (!live) return
        setStep(
          result.kind === 'ready'
            ? { kind: 'confirm', preview: result.preview }
            : { kind: 'ended', messageKey: TRIGGER_UI_MESSAGE_KEYS[result.ui] }
        )
      })
      .catch(() => live && setStep({ kind: 'ended', messageKey: 'SharedConnect.Failed' }))
    return () => {
      live = false
    }
    // The link is fixed for the life of the screen; the steps are too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unsubscribe = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => unsubscribe.current?.(), [])

  /** Follow a live session: waiting, unanswered (open, can ask again), or a final ending. */
  const watch = (handle: SharedConnectHandle) => {
    const show = (state: SessionState | undefined) => {
      if (state === undefined || state === 'waiting') setStep({ kind: 'waiting', handle })
      else if (state === 'unanswered') setStep({ kind: 'unanswered', handle })
      else setStep({ kind: 'ended', messageKey: FINAL_MESSAGE_KEYS[state] })
    }
    unsubscribe.current?.()
    unsubscribe.current = handle.subscribe(show)
    show(handle.outcome)
  }

  // Set by the first press of Connect, before anything else: a second touch in
  // the same frame lands before the step changes and must not start again.
  const pressed = useRef(false)
  const connect = async () => {
    if (!link || pressed.current) return
    pressed.current = true
    setStep({ kind: 'connecting' })
    try {
      const result = await steps.start(link)
      if (result.kind === 'started') {
        const handle = steps.session?.(result.encounter.enactment)
        if (handle) return watch(handle)
        setStep({ kind: 'ended', messageKey: 'SharedConnect.Ready' })
        return
      }
      setStep({
        kind: 'ended',
        messageKey: result.kind === 'refused' ? TRIGGER_UI_MESSAGE_KEYS[result.ui] : 'SharedConnect.Failed',
      })
    } catch {
      setStep({ kind: 'ended', messageKey: 'SharedConnect.Failed' })
    }
  }

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
        content: { padding: 20, gap: 16, flexGrow: 1 },
        card: {
          backgroundColor: ColorPalette.grayscale.white,
          borderColor: ColorPalette.grayscale.lightGrey,
          borderWidth: 1,
          borderRadius: 12,
          padding: 14,
          gap: 10,
        },
        row: { gap: 2 },
        mono: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
        buttons: { gap: 12 },
      }),
    [ColorPalette, TextTheme]
  )

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']} testID={id(SharedConnectIds.screen)}>
      <ScrollView contentContainerStyle={styles.content}>
        {step.kind === 'reading' && (
          <View testID={id(SharedConnectIds.reading)}>
            <ActivityIndicator />
            <ThemedText>{t('SharedConnect.Reading')}</ThemedText>
          </View>
        )}
        {step.kind === 'confirm' && (
          <View style={{ gap: 16 }} testID={id(SharedConnectIds.confirm)}>
            <ThemedText variant="headingTwo">{t('SharedConnect.ConfirmTitle')}</ThemedText>
            <ThemedText>{t('SharedConnect.ConfirmBody')}</ThemedText>
            <View style={styles.card}>
              <View style={styles.row}>
                <ThemedText variant="labelSubtitle">{t('SharedConnect.Name')}</ThemedText>
                {/* Text the sender wrote: sanitised by the reader, shown with its unverified marker, never trusted. */}
                <ThemedText testID={id(SharedConnectIds.name)}>
                  {step.preview.label ?? t('SharedConnect.NoName')}
                </ThemedText>
                {step.preview.label ? (
                  <ThemedText testID={id(SharedConnectIds.unverified)}>{t('SharedConnect.Unverified')}</ThemedText>
                ) : null}
              </View>
              <View style={styles.row}>
                <ThemedText variant="labelSubtitle">{t('SharedConnect.Contact')}</ThemedText>
                <ThemedText style={styles.mono} testID={id(SharedConnectIds.contact)}>
                  {step.preview.didShort}
                </ThemedText>
              </View>
              <View style={styles.row}>
                <ThemedText variant="labelSubtitle">{t('SharedConnect.Relay')}</ThemedText>
                <ThemedText testID={id(SharedConnectIds.relay)}>
                  {step.preview.relayHost ?? t('SharedConnect.NoRelay')}
                </ThemedText>
              </View>
              <ThemedText testID={id(SharedConnectIds.expires)}>
                {t('SharedConnect.Expires', { time: expiryText(step.preview.exp, i18n.language) })}
              </ThemedText>
            </View>
            <View style={styles.buttons}>
              <Button
                title={t('SharedConnect.Connect')}
                accessibilityLabel={t('SharedConnect.Connect')}
                testID={id(SharedConnectIds.connect)}
                buttonType={ButtonType.Primary}
                onPress={connect}
              />
              <Button
                title={t('SharedConnect.Cancel')}
                accessibilityLabel={t('SharedConnect.Cancel')}
                testID={id(SharedConnectIds.cancel)}
                buttonType={ButtonType.Secondary}
                onPress={onClose}
              />
            </View>
          </View>
        )}
        {step.kind === 'connecting' && (
          <View testID={id(SharedConnectIds.connecting)}>
            <ActivityIndicator />
            <ThemedText>{t('SharedConnect.Connecting')}</ThemedText>
          </View>
        )}
        {step.kind === 'waiting' && (
          <View style={{ gap: 16 }} testID={id(SharedConnectIds.waiting)}>
            <ActivityIndicator />
            <ThemedText>{t('SharedConnect.Waiting')}</ThemedText>
            <Button
              title={t('SharedConnect.Stop')}
              accessibilityLabel={t('SharedConnect.Stop')}
              testID={id(SharedConnectIds.stop)}
              buttonType={ButtonType.Secondary}
              onPress={() => void step.handle.cancel()}
            />
          </View>
        )}
        {step.kind === 'unanswered' && (
          <View style={{ gap: 16 }} testID={id(SharedConnectIds.unanswered)}>
            <ThemedText>{t('SharedConnect.Unanswered')}</ThemedText>
            <View style={styles.buttons}>
              <Button
                title={t('SharedConnect.Retry')}
                accessibilityLabel={t('SharedConnect.Retry')}
                testID={id(SharedConnectIds.retry)}
                buttonType={ButtonType.Primary}
                onPress={() => void step.handle.retry()}
              />
              <Button
                title={t('SharedConnect.Stop')}
                accessibilityLabel={t('SharedConnect.Stop')}
                testID={id(SharedConnectIds.stop)}
                buttonType={ButtonType.Secondary}
                onPress={() => void step.handle.cancel()}
              />
            </View>
          </View>
        )}
        {step.kind === 'ended' && (
          <View style={{ gap: 16 }} testID={id(SharedConnectIds.result)}>
            <ThemedText>{t(step.messageKey)}</ThemedText>
            <Button
              title={t('SharedConnect.Done')}
              accessibilityLabel={t('SharedConnect.Done')}
              testID={id(SharedConnectIds.done)}
              buttonType={ButtonType.Primary}
              onPress={onClose}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

/** The screen in the My Agent stack: the link its route carries (each scan is its own route) and the agent's steps. */
const SharedConnect: React.FC<{
  steps?: SharedConnectSteps
  link?: string
  route?: { params?: { link?: string } }
}> = ({ steps, link, route }) => {
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  const [code] = useState(() => link ?? route?.params?.link)
  const agentSteps = useMemo(() => steps ?? (agent ? agentSharedConnectSteps(agent) : undefined), [steps, agent])
  if (!agentSteps) return null
  return <SharedConnectFlow link={code} steps={agentSteps} onClose={() => navigation.goBack()} />
}

export default SharedConnect
