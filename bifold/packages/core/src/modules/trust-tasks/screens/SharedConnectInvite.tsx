/**
 * "Show my code": this phone shows a shared-connect code for someone else to
 * scan (relationship over TSP, docs/plans/relationship-over-tsp-plan.md WP9,
 * Keyring as the inviter). Reached from the QR Code Exchange sheet, only while
 * the inviter switch is on (`isSharedConnectInviteEnabled`).
 *
 * The code, its expiry and its teardown belong to `useSharedConnectInvite`; this
 * screen shows the state it reports and nothing else:
 *
 *  - minting: the code is being made.
 *  - waiting: the code, the time left, when it expires, Copy link, Share link.
 *  - proposed: someone scanned it; RelationshipProposalModal (mounted at the
 *    root) asks whether to accept. The screen says so and waits.
 *  - connecting, connected, expired, failed (declined, relay, send, unknown),
 *    cancelled.
 *
 * Nothing the other person sent is shown here (WP12): the request carries no
 * name in this version, and the modal shows only their address prefix.
 *
 * The time left is one interval, running only while the code can still be
 * scanned, and cleared on any other state and when the screen goes away. When
 * it expires is said in the app's language and the phone's 12/24-hour setting,
 * with the scanner's own `expiryText` (#954).
 *
 * Its words, `SharedConnectInvite.*` in the localization files: the French and
 * Brazilian Portuguese are MACHINE-DRAFTED and not yet read by a native
 * speaker. They merged that way on Alberto's decision (2026-11-07); a native
 * read is a condition for turning "Show a code" on for testers, not for
 * merging. Whoever flips the inviter switch's default on checks it was done.
 *
 * @module trust-tasks/screens/SharedConnectInvite
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import QRRenderer from '../../../components/misc/QRRenderer'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { invitationShareContent } from '../../../utils/invitationLink'
import { testIdWithKey } from '../../../utils/testable'
import { isSharedConnectInviteEnabled } from '../module/sharedConnectFlag'
import type { SharedConnectInvite, SharedConnectInviteFailure } from '../module/sharedConnectInviteTypes'

import { expiryText } from './SharedConnect'
import { SharedConnectInviteIds as Ids } from './SharedConnect.ids'

const id = (key: string) => testIdWithKey(key)

/** The states in which the code can still be scanned, so the time left runs. */
const LIVE = new Set(['waiting', 'proposed'])

/** Whole seconds until `expiresAt`, never below zero. */
export const secondsLeft = (expiresAt: number, nowMs: number): number =>
  Math.max(0, Math.ceil(expiresAt - nowMs / 1000))

/** "9:41": minutes and two-digit seconds. Digits only, so the same in every language. */
export const clockOf = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const FAILURE_KEYS: Record<SharedConnectInviteFailure, string> = {
  declined: 'SharedConnectInvite.FailedDeclined',
  relay: 'SharedConnectInvite.FailedRelay',
  send: 'SharedConnectInvite.FailedSend',
  exhausted: 'SharedConnectInvite.FailedExhausted',
  rejected: 'SharedConnectInvite.FailedRejected',
  unknown: 'SharedConnectInvite.FailedUnknown',
}

export const SharedConnectInviteView: React.FC<{
  invite: SharedConnectInvite
  onClose: () => void
  /** The clock, for tests. */
  now?: () => number
}> = ({ invite, onClose, now = Date.now }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { width } = useWindowDimensions()
  const { state, link, expiresAt, failure } = invite

  // The time left: one interval, only while the code can be scanned.
  const live = LIVE.has(state) && expiresAt !== undefined
  const [left, setLeft] = useState(() => (expiresAt === undefined ? 0 : secondsLeft(expiresAt, now())))
  useEffect(() => {
    if (!live || expiresAt === undefined) return
    setLeft(secondsLeft(expiresAt, now()))
    const timer = setInterval(() => setLeft(secondsLeft(expiresAt, now())), 1000)
    return () => clearInterval(timer)
  }, [live, expiresAt, now])

  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])
  const copy = useCallback(() => {
    if (!link) return
    Clipboard.setString(link)
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }, [link])

  const share = useCallback(() => {
    if (!link) return
    // A sheet closed without sharing is not an error.
    void Share.share(invitationShareContent(link, t('SharedConnectInvite.ShareTitle'), Platform.OS)).catch(
      () => undefined
    )
  }, [link, t])

  const cancel = useCallback(async () => {
    await invite.cancel()
    onClose()
  }, [invite, onClose])

  const qrSize = Math.max(200, Math.min(width - 80, 280))

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
        content: { padding: 20, gap: 14, flexGrow: 1 },
        center: { textAlign: 'center' },
        quiet: { textAlign: 'center', color: ColorPalette.grayscale.mediumGrey },
        qr: {
          alignSelf: 'center',
          backgroundColor: ColorPalette.grayscale.white,
          borderRadius: 12,
          padding: 12,
        },
        clock: { textAlign: 'center', fontVariant: ['tabular-nums'] },
        links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
        link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12 },
        footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 12 },
      }),
    [ColorPalette]
  )

  const linkColor = ColorPalette.brand.link

  // The buttons sit outside the scroll, so Cancel or Done is always on screen, at any text size.
  const footer = (() => {
    const done = (
      <Button
        title={t('SharedConnectInvite.Done')}
        accessibilityLabel={t('SharedConnectInvite.Done')}
        testID={id(Ids.done)}
        buttonType={ButtonType.Secondary}
        onPress={onClose}
      />
    )
    const renew = (
      <Button
        title={t('SharedConnectInvite.NewCode')}
        accessibilityLabel={t('SharedConnectInvite.NewCode')}
        testID={id(Ids.renew)}
        buttonType={ButtonType.Primary}
        onPress={() => invite.renew()}
      />
    )
    switch (state) {
      case 'connected':
        return done
      case 'expired':
      case 'failed':
      case 'cancelled':
        return (
          <>
            {renew}
            {done}
          </>
        )
      default:
        return (
          <Button
            title={t(state === 'connecting' ? 'SharedConnectInvite.Stop' : 'SharedConnectInvite.Cancel')}
            accessibilityLabel={t(state === 'connecting' ? 'SharedConnectInvite.Stop' : 'SharedConnectInvite.Cancel')}
            testID={id(Ids.cancel)}
            buttonType={ButtonType.Secondary}
            onPress={() => void cancel()}
          />
        )
    }
  })()

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']} testID={id(Ids.screen)}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          {state === 'minting' && (
            <View style={{ gap: 12 }} testID={id(Ids.minting)}>
              <ActivityIndicator />
              <ThemedText style={styles.center}>{t('SharedConnectInvite.Minting')}</ThemedText>
            </View>
          )}
          {state === 'waiting' && link && expiresAt !== undefined && (
            <View style={{ gap: 14 }} testID={id(Ids.waiting)}>
              <ThemedText style={styles.center}>{t('SharedConnectInvite.Instruction')}</ThemedText>
              <View style={styles.qr}>
                <QRRenderer value={link} size={qrSize} testID={Ids.qr} />
              </View>
              <ThemedText variant="headingTwo" style={styles.clock} testID={id(Ids.countdown)}>
                {t('SharedConnectInvite.TimeLeft', { time: clockOf(left) })}
              </ThemedText>
              <ThemedText style={styles.quiet} testID={id(Ids.expiresAt)}>
                {expiryText(expiresAt, t, new Date(now()))}
              </ThemedText>
              <View style={styles.links}>
                <Pressable
                  onPress={copy}
                  accessibilityRole="button"
                  accessibilityLabel={t('SharedConnectInvite.CopyLink')}
                  testID={id(Ids.copyLink)}
                >
                  <View style={styles.link}>
                    <Icon name={copied ? 'check' : 'content-copy'} size={20} color={linkColor} />
                    <ThemedText style={{ color: linkColor }}>
                      {t(copied ? 'SharedConnectInvite.Copied' : 'SharedConnectInvite.CopyLink')}
                    </ThemedText>
                  </View>
                </Pressable>
                <Pressable
                  onPress={share}
                  accessibilityRole="button"
                  accessibilityLabel={t('SharedConnectInvite.ShareLink')}
                  testID={id(Ids.shareLink)}
                >
                  <View style={styles.link}>
                    <Icon name="share-variant" size={20} color={linkColor} />
                    <ThemedText style={{ color: linkColor }}>{t('SharedConnectInvite.ShareLink')}</ThemedText>
                  </View>
                </Pressable>
              </View>
              <ThemedText style={styles.quiet}>{t('SharedConnectInvite.KeepOpen')}</ThemedText>
              {/* The full link, for the e2e drivers: read off the screen instead of scanning it. */}
              <ThemedText
                testID={id(Ids.link)}
                accessibilityLabel={link}
                style={{ height: 1, opacity: 0.01 }}
                numberOfLines={1}
              >
                {link}
              </ThemedText>
            </View>
          )}
          {state === 'proposed' && (
            <View style={{ gap: 12 }} testID={id(Ids.proposed)}>
              <ActivityIndicator />
              <ThemedText style={styles.center}>{t('SharedConnectInvite.Proposed')}</ThemedText>
            </View>
          )}
          {state === 'connecting' && (
            <View style={{ gap: 12 }} testID={id(Ids.connecting)}>
              <ActivityIndicator />
              <ThemedText variant="headingThree" style={styles.center}>
                {t('SharedConnectInvite.Connecting')}
              </ThemedText>
              <ThemedText style={styles.center}>{t('SharedConnectInvite.ConnectingBody')}</ThemedText>
              <ThemedText style={styles.quiet}>{t('SharedConnectInvite.ConnectingNote')}</ThemedText>
            </View>
          )}
          {state === 'connected' && (
            <View style={{ gap: 12 }} testID={id(Ids.connected)}>
              <ThemedText variant="headingThree" style={styles.center}>
                {t('SharedConnectInvite.Connected')}
              </ThemedText>
              <ThemedText style={styles.center}>{t('SharedConnectInvite.ConnectedBody')}</ThemedText>
            </View>
          )}
          {state === 'expired' && (
            <View style={{ gap: 12 }} testID={id(Ids.expired)}>
              <ThemedText variant="headingThree" style={styles.center}>
                {t('SharedConnectInvite.Expired')}
              </ThemedText>
              <ThemedText style={styles.center}>{t('SharedConnectInvite.ExpiredBody')}</ThemedText>
            </View>
          )}
          {state === 'failed' && (
            <View style={{ gap: 12 }} testID={id(Ids.failed)}>
              <ThemedText variant="headingThree" style={styles.center}>
                {t('SharedConnectInvite.Failed')}
              </ThemedText>
              <ThemedText style={styles.center}>{t(FAILURE_KEYS[failure ?? 'unknown'])}</ThemedText>
            </View>
          )}
          {state === 'cancelled' && (
            <View style={{ gap: 12 }} testID={id(Ids.cancelled)}>
              <ThemedText style={styles.center}>{t('SharedConnectInvite.Cancelled')}</ThemedText>
            </View>
          )}
        </ScrollView>
        <View style={styles.footer}>{footer}</View>
      </View>
    </SafeAreaView>
  )
}

/**
 * The screen in the Connect stack. `useInvite` is the hook that makes and runs
 * the code; it is passed in so the screen holds no protocol of its own.
 *
 * With the inviter switch off the hook is never mounted, so nothing starts (no
 * code, no relay session), however the route was reached: the QR sheet hides
 * its button, and this covers any other way in. The core checks the switch too.
 */
export const makeSharedConnectInviteScreen = (
  useInvite: () => SharedConnectInvite,
  enabled: () => boolean = isSharedConnectInviteEnabled
): React.FC => {
  const Running: React.FC<{ onClose: () => void }> = ({ onClose }) => (
    <SharedConnectInviteView invite={useInvite()} onClose={onClose} />
  )
  const SharedConnectInviteScreen: React.FC = () => {
    const navigation = useNavigation()
    const [on] = useState(enabled)
    const close = () => navigation.goBack()
    return on ? <Running onClose={close} /> : <SharedConnectInviteOff onClose={close} />
  }
  return SharedConnectInviteScreen
}

/** What the route shows with the switch off: that it is off, and Done. Nothing is made or sent. */
const SharedConnectInviteOff: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  return (
    <SafeAreaView
      style={{ flex: 1, padding: 20, gap: 16, backgroundColor: ColorPalette.brand.primaryBackground }}
      edges={['bottom', 'left', 'right']}
      testID={id(Ids.off)}
    >
      <ThemedText>{t('SharedConnectInvite.Off')}</ThemedText>
      <Button
        title={t('SharedConnectInvite.Done')}
        accessibilityLabel={t('SharedConnectInvite.Done')}
        testID={id(Ids.done)}
        buttonType={ButtonType.Primary}
        onPress={onClose}
      />
    </SafeAreaView>
  )
}
