/**
 * VtaLink — linking this phone to an agent, after an enrolment offer was
 * scanned or pasted (plan §5.1).
 *
 * The screen renders the link state machine (`vtaAgent`, plan §4.2) and
 * nothing else: which step is showing, what is in flight and what failed all
 * come from that one state, so leaving and coming back shows the same step
 * rather than a fresh button. One primary action per step, at the bottom.
 *
 * @module trust-tasks/screens/VtaLink
 */

import { useAgent } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { useHeaderHeight } from '@react-navigation/elements'
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import QRRenderer from '../../../components/misc/QRRenderer'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { VtaLinkFailure } from '../module/vtaLinkMachine'

import { agentDisplayName, agentDisplayNameStart, withAgentName } from './agentName'
import { DeviceNameField } from './DeviceNamePrompt'
import { HostSetupSteps } from './HostSetupSteps'
import { defaultNameOf } from './deviceWords'
import { useMeasuredKeyboardOffset } from './keyboardOffset'
import { openScanner } from './openScanner'
import { plainError } from './plainError'
import { clearJustErased, ErasedNotice, RemovedPhoneCard } from './RemovedPhoneCard'
import { shareableKey } from './shareableKey'

/** The agent's host, for people: the domain inside a did:webvh, else the label alone. */
export function agentHost(vtaDid: string): string | undefined {
  const parts = vtaDid.split(':')
  return parts[1] === 'webvh' && parts.length >= 4 ? decodeURIComponent(parts[3]) : undefined
}

// The header's height, for the keyboard offset; a render without a header
// (a screen test) has none to report, and throws.
export const useSafeHeaderHeight = (): number => {
  try {
    return useHeaderHeight()
  } catch {
    return 0
  }
}

/** How often a phone showing its code to another phone asks whether it has been added (#30). */
export const PHONE_GRANT_POLL_EVERY_MS = 5000
/** How long it keeps asking by itself; after that, "Check again". */
export const PHONE_GRANT_POLL_WINDOW_MS = 10 * 60 * 1000

const VtaLink: React.FC = () => {
  const headerHeight = useSafeHeaderHeight()
  const keyboard = useMeasuredKeyboardOffset(headerHeight)
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const route = useRoute()
  const { ColorPalette, TextTheme } = useTheme()
  const { link: current, agentNames } = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const link = withAgentName(current, agentNames)
  // Form state only — what the person is typing before they ask for a key.
  // Opening straight into the address field when the previous screen already
  // asked: being asked the same question twice reads as not having been heard.
  const askedWithoutQr = Boolean((route?.params as { withoutQr?: boolean } | undefined)?.withoutQr)
  const [manualEntry, setManualEntry] = useState(askedWithoutQr)
  const [agentAddress, setAgentAddress] = useState('')
  const [copied, setCopied] = useState(false)
  const [keyShown, setKeyShown] = useState(false)
  // #30: a phone showing its code to another phone checks by itself whether it
  // has been added — in view, in the foreground, inside the window.
  const focused = useIsFocused()
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setAppActive(next === 'active'))
    return () => subscription.remove()
  }, [])
  const forOtherPhone = link.kind === 'showingKey' && link.via === 'scan'
  const [phonePollUntil, setPhonePollUntil] = useState<number | undefined>()
  const [phonePollExpired, setPhonePollExpired] = useState(false)
  useEffect(() => {
    if (!forOtherPhone) {
      setPhonePollUntil(undefined)
      setPhonePollExpired(false)
    } else if (phonePollUntil === undefined && !phonePollExpired) {
      setPhonePollUntil(Date.now() + PHONE_GRANT_POLL_WINDOW_MS)
    }
  }, [forOtherPhone, phonePollUntil, phonePollExpired])
  useEffect(() => {
    if (!forOtherPhone || !focused || !appActive || !agent || phonePollUntil === undefined) return
    const timer = setInterval(() => {
      if (Date.now() >= phonePollUntil) {
        setPhonePollExpired(true)
        setPhonePollUntil(undefined)
        return
      }
      void vtaAgent.checkManualGrant(agent)
    }, PHONE_GRANT_POLL_EVERY_MS)
    return () => clearInterval(timer)
  }, [forOtherPhone, focused, appActive, agent, phonePollUntil])
  const { width: windowWidth } = useWindowDimensions()
  const [errorOpen, setErrorOpen] = useState(false)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      padding: 16,
      gap: 8,
    },
    code: {
      ...TextTheme.headingTwo,
      fontFamily: 'Menlo',
      letterSpacing: 4,
      textAlign: 'center',
      paddingVertical: 12,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    actions: { padding: 20, gap: 12 },
    error: { color: ColorPalette.semantic.error },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    input: {
      ...TextTheme.normal,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
      borderRadius: 6,
      padding: 12,
      minHeight: 48,
    },
    key: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 13 },
  })

  const addressLooksRight = /^did:[a-z0-9]+:.+/.test(agentAddress.trim())

  const onShowMyCode = useCallback(() => {
    const vtaDid = agentAddress.trim()
    if (!agent || !/^did:[a-z0-9]+:.+/.test(vtaDid)) return
    setCopied(false)
    void vtaAgent.startManualLink(agent, vtaDid, vtaDid)
  }, [agent, agentAddress])

  const onCheckGrant = useCallback(() => {
    if (agent) void vtaAgent.checkManualGrant(agent)
  }, [agent])

  const onConfirm = useCallback(() => {
    if (agent) void vtaAgent.confirmOffer(agent)
  }, [agent])

  const onCancel = useCallback(() => {
    vtaAgent.cancelLink()
    navigation.goBack()
  }, [navigation])

  const onScanAgain = useCallback(() => {
    vtaAgent.relink()
    openScanner(navigation)
  }, [navigation])

  const defaultName = defaultNameOf(Platform.OS, new Date(), t)
  const [deviceName, setDeviceName] = useState(defaultName)
  const [naming, setNaming] = useState(false)
  const onDone = useCallback(async () => {
    clearJustErased()
    // Name this phone on the agent (new-phone-new-device-plan.md §A): the name
    // the person's other devices show. A refusal doesn't hold them up; the
    // presence loop registers the default later, and My devices can rename.
    setNaming(true)
    try {
      if (agent) await vtaAgent.registerThisDevice(agent, deviceName.trim() || defaultName)
    } catch {
      // Linked all the same.
    } finally {
      setNaming(false)
    }
    // The one-time offer, which goes on to the agent screen (where the
    // first-link introduction plays once) when there is no other phone. The
    // stack is set rather than pushed: pushed on top, "Linked ✓" stayed
    // underneath and came back on every return to the tab; and a link begun
    // from the scanner can open this screen as the stack's only route. It is
    // the only route: a linked phone has no operator panel to go back to.
    const stack = navigation as unknown as { reset: (state: { index: number; routes: { name: string }[] }) => void }
    stack.reset({ index: 0, routes: [{ name: Screens.VtaNewPhoneOffer }] })
  }, [agent, deviceName, defaultName, navigation])

  const failureText = (failure?: VtaLinkFailure) => {
    // An agent host's automatic connection says why in its own terms.
    if (failure?.hostReason) return t(`VtaLink.Host.Failed.${failure.hostReason}`)
    switch (failure?.reason) {
      case 'expired':
        return t('VtaLink.FailedExpired')
      case 'refused':
        return t('VtaLink.FailedRefused')
      case 'unreachable':
        return t('VtaLink.FailedUnreachable')
      case 'communityAgent':
        return t('VtaLink.FailedCommunityAgent')
      default:
        // Say what was caught, in words, rather than "something went wrong":
        // an iOS link that authenticated but never opened its mediator socket
        // showed only that, and the cause took a mediator log to find
        // (2026-09-25, lab).
        return failure?.detail ? t(plainError(failure.detail).line) : t('VtaLink.FailedOther')
    }
  }

  const host = 'vtaDid' in link ? (agentHost(link.vtaDid) ?? '') : ''
  let body: React.ReactNode
  let actions: React.ReactNode

  switch (link.kind) {
    case 'confirming':
    case 'submitting':
      if (link.via === 'host') {
        // An agent host's QR: which agent, and the site the code came from,
        // before this phone sends anything — accepting makes it an admin.
        body = (
          <View style={styles.card} testID={testIdWithKey('VtaLinkConfirm')}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('VtaLink.Host.ConfirmTitle', {
                label: agentDisplayName(link, t),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            <ThemedText>{t('VtaLink.Host.ConfirmBody')}</ThemedText>
            <ThemedText testID={testIdWithKey('VtaLinkHostSite')}>
              {t('VtaLink.Host.CodeFrom', { site: link.offerUrl, interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText variant="labelTitle">{t('VtaLink.Host.AgentAddress')}</ThemedText>
            <ThemedText style={styles.key} testID={testIdWithKey('VtaLinkAgentAddress')} selectable>
              {link.vtaDid}
            </ThemedText>
          </View>
        )
        actions = (
          <>
            <Button
              title={link.kind === 'submitting' ? t('VtaLink.Host.Connecting') : t('VtaLink.Host.Connect')}
              buttonType={ButtonType.Primary}
              onPress={onConfirm}
              disabled={link.kind === 'submitting'}
              testID={testIdWithKey('VtaLinkButton')}
              accessibilityLabel={t('VtaLink.Host.Connect')}
            >
              {link.kind === 'submitting' ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
            </Button>
            <Button
              title={t('VtaLink.Host.NotNow')}
              buttonType={ButtonType.Secondary}
              onPress={onCancel}
              testID={testIdWithKey('VtaLinkCancel')}
            />
          </>
        )
        break
      }
      body = (
        <View style={styles.card} testID={testIdWithKey('VtaLinkConfirm')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaLink.ConfirmTitle', { label: agentDisplayName(link, t), interpolation: { escapeValue: false } })}
          </ThemedText>
          {host ? <ThemedText testID={testIdWithKey('VtaLinkHost')}>{host}</ThemedText> : null}
          <ThemedText>{t('VtaLink.ConfirmBody')}</ThemedText>
        </View>
      )
      actions = (
        <>
          <Button
            title={link.kind === 'submitting' ? t('VtaLink.Linking') : t('VtaLink.LinkThisPhone')}
            buttonType={ButtonType.Primary}
            onPress={onConfirm}
            disabled={link.kind === 'submitting'}
            testID={testIdWithKey('VtaLinkButton')}
            accessibilityLabel={t('VtaLink.LinkThisPhone')}
          >
            {link.kind === 'submitting' ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
          <Button
            title={t('VtaLink.DontLink')}
            buttonType={ButtonType.Secondary}
            onPress={onCancel}
            testID={testIdWithKey('VtaLinkCancel')}
          />
        </>
      )
      break

    case 'awaitingGrant':
      if (link.via === 'host') {
        // The host is setting the agent up; there is no code to compare.
        body = (
          <View style={styles.card} testID={testIdWithKey('VtaLinkHostSettingUp')}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('VtaLink.Host.SettingUpTitle')}
            </ThemedText>
            <ThemedText>{t('VtaLink.Host.SettingUpBody')}</ThemedText>
            {/* Named steps once the phone knows where the host has got to
                (HostSetupSteps); the one sentence only until then. */}
            {link.stage ? (
              <HostSetupSteps stage={link.stage} />
            ) : (
              <View style={styles.row}>
                <ActivityIndicator color={ColorPalette.brand.primary} />
                <ThemedText style={{ flex: 1 }} testID={testIdWithKey('VtaLinkState')}>
                  {t('VtaLink.Host.SettingUpWaiting')}
                </ThemedText>
              </View>
            )}
          </View>
        )
        actions = (
          <Button
            title={t('VtaLink.StopLinking')}
            buttonType={ButtonType.Secondary}
            onPress={onCancel}
            testID={testIdWithKey('VtaLinkCancel')}
          />
        )
        break
      }
      body = (
        <View style={styles.card}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaLink.CheckCodeTitle')}
          </ThemedText>
          <ThemedText>{t('VtaLink.CheckCodeBody')}</ThemedText>
          <ThemedText
            style={styles.code}
            testID={testIdWithKey('VtaLinkCode')}
            accessibilityLabel={link.code.split('').join(' ')}
            selectable
          >
            {link.code}
          </ThemedText>
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText testID={testIdWithKey('VtaLinkState')}>{t('VtaLink.WaitingForGrant')}</ThemedText>
          </View>
        </View>
      )
      actions = (
        <Button
          title={t('VtaLink.StopLinking')}
          buttonType={ButtonType.Secondary}
          onPress={onCancel}
          testID={testIdWithKey('VtaLinkCancel')}
        />
      )
      break

    case 'showingKey':
      if (link.via === 'scan') {
        // A bare agent DID was scanned: another phone's "Add another phone"
        // code (#30), or an agent host's page that shows the agent's address
        // beside an "Admin DID" box. The phone cannot tell which, so the words
        // cover both: copy this phone's code into that box, or scan it from the
        // other phone. No Share; this phone notices by itself once it's added.
        body = (
          <View style={styles.card} testID={testIdWithKey('VtaLinkForOtherPhone')}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('VtaLink.AddThisPhone')}
            </ThemedText>
            <ThemedText>{t('VtaLink.AddThisPhoneBody')}</ThemedText>
            <QRRenderer
              value={link.did}
              size={Math.min(windowWidth - 2 * (20 + 16 + 16), 260)}
              quietZone={16}
              testID={testIdWithKey('VtaLinkKeyQr')}
            />
            <Pressable
              onPress={() => setKeyShown(!keyShown)}
              accessibilityRole="button"
              accessibilityState={{ expanded: keyShown }}
              testID={testIdWithKey('VtaLinkShowAsText')}
            >
              <ThemedText style={styles.muted}>{keyShown ? t('VtaLink.HideText') : t('VtaLink.ShowAsText')}</ThemedText>
            </Pressable>
            {keyShown ? (
              <ThemedText style={styles.key} testID={testIdWithKey('VtaLinkManualDid')} selectable>
                {link.did}
              </ThemedText>
            ) : null}
          </View>
        )
        actions = (
          <>
            {/* A check the agent did not answer yet is not news while the phone
                is still checking on its own (the agent may still be being made):
                in red it came and went between checks and read as a failure
                (iPhone 11, 2026-10-01). Said once the wait has run out. */}
            {link.noAnswer && phonePollExpired ? (
              <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkNoAnswer')}>
                {t('VtaLink.NoAnswer', {
                  label: agentDisplayNameStart(link, t),
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            ) : null}
            {/* The screen's status, with the buttons: under the QR it was cut
                off at the bottom of the scroll (228). */}
            {phonePollUntil !== undefined ? (
              <View style={styles.row} testID={testIdWithKey('VtaLinkWaitingForPhone')}>
                <ActivityIndicator color={ColorPalette.brand.primary} />
                <ThemedText style={{ flex: 1 }}>{t('VtaLink.WaitingToBeAdded')}</ThemedText>
              </View>
            ) : null}
            {phonePollExpired ? (
              <Button
                title={t('VtaLink.CheckAgain')}
                buttonType={ButtonType.Primary}
                onPress={() => {
                  setPhonePollExpired(false)
                  onCheckGrant()
                }}
                testID={testIdWithKey('VtaLinkCheckAgain')}
              />
            ) : null}
            {/* In the bar, never under the QR: there it fell below the fold on a
                Pixel 6 at default text, half hidden behind Stop linking. */}
            {/* Copy, and Share for a browser on another device (an agent host's
                Admin DID box): a sentence with the code on its own line. */}
            <View style={styles.row}>
              <Button
                title={copied ? t('VtaLink.KeyCopied') : t('VtaLink.CopyKey')}
                buttonType={phonePollExpired ? ButtonType.Secondary : ButtonType.Primary}
                onPress={() => {
                  Clipboard.setString(link.did)
                  setCopied(true)
                }}
                testID={testIdWithKey('VtaLinkCopyKey')}
              />
              <Button
                title={t('VtaLink.ShareKey')}
                buttonType={ButtonType.Secondary}
                onPress={() =>
                  void Share.share(shareableKey(t, agentDisplayName(link, t), link.did)).catch(() => undefined)
                }
                testID={testIdWithKey('VtaLinkShareKey')}
              />
            </View>
            <Button
              title={t('VtaLink.StopLinking')}
              buttonType={ButtonType.Secondary}
              onPress={onCancel}
              testID={testIdWithKey('VtaLinkCancel')}
            />
          </>
        )
        break
      }
      body = (
        <View style={styles.card} testID={testIdWithKey('VtaLinkShowingKey')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaLink.GiveKeyTitle')}
          </ThemedText>
          <ThemedText>
            {t('VtaLink.GiveKeyBody', { label: agentDisplayName(link, t), interpolation: { escapeValue: false } })}
          </ThemedText>
          {/* The two things to DO come first and fit on the screen. The code
              itself is a ~350-character did:peer, and putting it here pushed
              Share, Copy and "I've been added" below the fold — a tester had
              to scroll a wall of characters to find the buttons and reported
              the screen as hidden controls and weird text (#25). */}
          <ThemedText style={styles.muted} testID={testIdWithKey('VtaLinkShareKeyHint')}>
            {t('VtaLink.ShareKeyHint')}
          </ThemedText>
          <Button
            title={t('VtaLink.ShareKey')}
            buttonType={ButtonType.Primary}
            onPress={() =>
              void Share.share(shareableKey(t, agentDisplayName(link, t), link.did)).catch(() => undefined)
            }
            testID={testIdWithKey('VtaLinkShareKey')}
          />
          <Button
            title={copied ? t('VtaLink.KeyCopied') : t('VtaLink.CopyKey')}
            buttonType={ButtonType.Secondary}
            onPress={() => {
              Clipboard.setString(link.did)
              setCopied(true)
            }}
            testID={testIdWithKey('VtaLinkCopyKey')}
          />
          {/* Where the admin adds it, in view: behind "Show the code and how to
              add it" nobody found it (Alberto, relinking after Unlink, 219).
              The code itself stays behind its own toggle: a ~350-character
              did:peer is for pasting, not reading. */}
          <View style={{ gap: 4 }} testID={testIdWithKey('VtaLinkGiveKeyHow')}>
            <ThemedText variant="bold">{t('VtaLink.GiveKeyHowTitle')}</ThemedText>
            <ThemedText>{t('VtaLink.GiveKeyHow')}</ThemedText>
            <ThemedText style={styles.muted}>{t('VtaLink.GiveKeyHowTerminal')}</ThemedText>
          </View>
          <Pressable
            onPress={() => setKeyShown(!keyShown)}
            accessibilityRole="button"
            accessibilityState={{ expanded: keyShown }}
            testID={testIdWithKey('VtaLinkShowTheCode')}
          >
            <ThemedText style={styles.muted}>
              {keyShown ? t('VtaLink.HideTheCode') : t('VtaLink.ShowTheCode')}
            </ThemedText>
          </Pressable>
          {keyShown ? (
            <ThemedText style={styles.key} testID={testIdWithKey('VtaLinkManualDid')} selectable>
              {link.did}
            </ThemedText>
          ) : null}
        </View>
      )
      actions = (
        <>
          {/* What the last check found, beside the button that ran it. The
              card above ends with a ~350-character key, so anything appended
              to it lands below the fold on a phone: the answer was under the
              bottom of the screen while the question stayed pinned to it. */}
          {link.notYet ? (
            <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkNotYet')}>
              {t('VtaLink.NotAddedYet')}
            </ThemedText>
          ) : null}
          {/* Silence is not refusal: the agent may be offline, or its answer
              may have been lost on the way back. Either way the person is told
              rather than left watching a spinner. */}
          {link.noAnswer ? (
            <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkNoAnswer')}>
              {t('VtaLink.NoAnswer', { label: agentDisplayNameStart(link, t), interpolation: { escapeValue: false } })}
            </ThemedText>
          ) : null}
          <Button
            title={link.checking ? t('VtaLink.Checking') : link.noAnswer ? t('VtaLink.TryAgain') : t('VtaLink.ImAdded')}
            buttonType={ButtonType.Primary}
            onPress={onCheckGrant}
            disabled={link.checking}
            testID={testIdWithKey('VtaLinkCheckGrant')}
          >
            {link.checking ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
          <Button
            title={t('VtaLink.StopLinking')}
            buttonType={ButtonType.Secondary}
            onPress={onCancel}
            testID={testIdWithKey('VtaLinkCancel')}
          />
        </>
      )
      break

    case 'linking':
      body = (
        <View style={styles.card}>
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText testID={testIdWithKey('VtaLinkState')}>
              {link.step === 'rotating' ? t('VtaLink.StepRotating') : t('VtaLink.StepConnecting')}
            </ThemedText>
          </View>
        </View>
      )
      break

    case 'linked':
      body = (
        <View style={styles.card} testID={testIdWithKey('VtaLinkDone')}>
          <View style={styles.row}>
            <Icon name="check-circle" size={24} color={ColorPalette.semantic.success} />
            <ThemedText variant="headingThree" accessibilityRole="header">
              {t('VtaLink.Linked')}
            </ThemedText>
          </View>
          <ThemedText testID={testIdWithKey('VtaLinkLinkedBody')}>
            {t('VtaLink.LinkedBody', { label: agentDisplayName(link, t), interpolation: { escapeValue: false } })}
          </ThemedText>
          <DeviceNameField value={deviceName} onChange={setDeviceName} onSubmit={() => void onDone()} />
        </View>
      )
      actions = (
        <Button
          title={t('VtaLink.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() => void onDone()}
          disabled={naming}
          testID={testIdWithKey('VtaLinkContinue')}
        >
          {naming ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      )
      break

    case 'revoked':
      // The same card My Agent's landings show: a removed phone is told so
      // wherever it lands (RemovedPhoneCard).
      body = <RemovedPhoneCard link={link} />
      actions = null
      break

    case 'notLinked':
      body = (
        <>
          <ErasedNotice />
          <View style={styles.card}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {link.lastError ? t('VtaLink.FailedTitle') : t('VtaLink.NothingToLink')}
            </ThemedText>
            {link.lastError ? (
              <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkError')}>
                {failureText(link.lastError)}
              </ThemedText>
            ) : null}
            {/* The key this phone was granted stays on that agent's list: a VTA
                refuses a self-delete, so its admin is the one to remove it. */}
            {link.lastError?.reason === 'communityAgent' ? (
              <ThemedText testID={testIdWithKey('VtaLinkCommunityAgentCleanup')}>
                {t('VtaLink.FailedCommunityAgentCleanup')}
              </ThemedText>
            ) : null}
            {/* The original text, as Join and Invited keep it: for whoever reads
                a report, one tap away and never on its own. */}
            {link.lastError?.detail ? (
              <>
                <Pressable
                  onPress={() => setErrorOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: errorOpen }}
                  testID={testIdWithKey('VtaLinkErrorDetailsToggle')}
                >
                  <ThemedText style={styles.muted}>{t('Errors.ShowDetails')}</ThemedText>
                </Pressable>
                {errorOpen ? (
                  <ThemedText style={styles.muted} selectable testID={testIdWithKey('VtaLinkErrorDetail')}>
                    {link.lastError.detail}
                  </ThemedText>
                ) : null}
              </>
            ) : null}
          </View>
          {manualEntry ? (
            <View style={styles.card} testID={testIdWithKey('VtaLinkManualEntry')}>
              <ThemedText variant="labelTitle">{t('VtaLink.AgentAddress')}</ThemedText>
              <ThemedText>{t('VtaLink.AgentAddressHint')}</ThemedText>
              <TextInput
                style={styles.input}
                value={agentAddress}
                onChangeText={setAgentAddress}
                placeholder="did:webvh:…"
                placeholderTextColor={ColorPalette.grayscale.mediumGrey}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('VtaLink.AgentAddress')}
                testID={testIdWithKey('VtaLinkAgentAddress')}
                // The keyboard's own key submits, so it never has to be
                // dismissed to reach the button it covers.
                returnKeyType="go"
                onSubmitEditing={onShowMyCode}
                submitBehavior="blurAndSubmit"
              />
            </View>
          ) : null}
        </>
      )
      actions = manualEntry ? (
        <>
          <Button
            title={t('VtaLink.ShowMyCode')}
            buttonType={ButtonType.Primary}
            onPress={onShowMyCode}
            disabled={!addressLooksRight}
            testID={testIdWithKey('VtaLinkShowMyCode')}
          />
          <Button
            title={t('VtaLink.ScanInstead')}
            buttonType={ButtonType.Secondary}
            onPress={() => setManualEntry(false)}
            testID={testIdWithKey('VtaLinkScanInstead')}
          />
        </>
      ) : (
        <>
          <Button
            title={t('VtaLink.ScanAgain')}
            buttonType={ButtonType.Primary}
            onPress={onScanAgain}
            testID={testIdWithKey('VtaLinkScanAgain')}
          />
          <Button
            title={t('VtaLink.WithoutQr')}
            buttonType={ButtonType.Secondary}
            onPress={() => setManualEntry(true)}
            testID={testIdWithKey('VtaLinkWithoutQr')}
          />
        </>
      )
      break
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* The app draws under the system bars (KeyboardProvider), so Android no
          longer resizes the window for the keyboard: the footer stayed behind
          it there. keyboard-controller's view lifts it on both platforms, by
          the keyboard's overlap below the header. */}
      <KeyboardAvoidingView
        ref={keyboard.ref}
        onLayout={keyboard.onLayout}
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={keyboard.offset}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default VtaLink
