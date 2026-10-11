/**
 * Claim your agent (own_agent_subtask.md §1, §7): a person with only a phone
 * and an agent host's website makes an agent and owns it from Keyring.
 *
 * The steps follow the host's own wizard: the agent's address first (the
 * phone's key names the agent's mediator, so it cannot be made before), then
 * this phone's owner code for the host's "Admin DID" box, then connect. The
 * connect is today's no-QR link underneath — `startManualLink` makes and
 * shows the key, `checkManualGrant` signs in and moves onto the long-term key
 * — so the link machine's states drive the later steps.
 *
 * Plain words throughout: "agent" is the only term, codes are for pasting and
 * sit behind "Show the code", and every error sits beside its button (#221).
 * Face ID is never a step of its own: it is the system prompt when the phone
 * acts as owner (`confirmOwner`).
 *
 * @module trust-tasks/screens/VtaCreateAgent
 */
import { useAgent } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native'
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  AppState,
  Linking,
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

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import QRRenderer from '../../../components/misc/QRRenderer'
import { confirmOwner, ownerLockKind, type OwnerConfirmFailure, type OwnerLockKind } from '../module/ownerConfirm'
import type { AgentLabel } from '../module/agentLabel'
import { AgentAlreadyOnPhone, vtaAgent } from '../module/vtaAgent'
import { agentAddressScan, type ScannedAgent } from '../module/agentAddressScan'
import { deviceCodeScan } from '../module/deviceCodeScan'
import { DeviceCannotOwn, deviceCodeIn, deviceRefusalOf, type DeviceRefusalReason } from '../module/vtaOwner'

import { DeviceNameField } from './DeviceNamePrompt'
import { openScanner } from './openScanner'
import { VtaCreateAgentIds, type VtaCreateAgentId } from './VtaCreateAgent.ids'
import { useSafeHeaderHeight } from './VtaLink'
import { useMeasuredKeyboardOffset } from './keyboardOffset'
import { linkFailureText } from './linkFailureWords'

/**
 * A known agent host's website, to open from the intro. Never named on screen:
 * the words say "your agent's host", as for email. Unset, there is no button.
 */
export const AGENT_HOST_WEBSITE: string | undefined = undefined

/**
 * While the owner code is out, the phone asks the agent whether it has been
 * admitted, on its own: every 6 s for up to 10 min, then "Check again". A
 * host may only apply a new admin after a refresh, so the person needn't
 * guess when to tap.
 */
const SCREEN_PADDING = 20
const CARD_PADDING = 16
const CARD_GAP = 8
/** White margin a camera needs around a code; QRRenderer's own vertical margin is 20 each side. */
const QR_QUIET_ZONE = 16
const QR_RENDERER_MARGIN = 20
/** A floor: in a space smaller than this the code keeps this size and the page scrolls. */
const QR_MIN_SIZE = 160

export const GRANT_POLL_EVERY_MS = 6000
export const GRANT_POLL_WINDOW_MS = 10 * 60 * 1000

type LocalStep = 'intro' | 'address' | 'backupAddress' | 'backupCode' | 'ready'

/** An agent's address, as an agent host shows it after "Create session". */
export const looksLikeAgentAddress = (text: string): boolean => /^did:webvh:[^\s]+:[^\s]+$/.test(text.trim())

/**
 * What "… is online and belongs to this phone" calls the agent: the name it
 * gives itself, once read, else plainly "Your agent". Never the address's
 * host: that is the agent host's own domain (225 gate).
 */
export function readyNameOf(
  vtaDid: string | undefined,
  agentNames: Readonly<Record<string, AgentLabel>> | undefined,
  t: TFunction
): string {
  const own = vtaDid ? agentNames?.[vtaDid]?.label?.trim() : undefined
  const name = own || (t('VtaLink.YourAgentFallback') as string)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const VtaCreateAgent: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  // "Add another device" from My devices opens this screen at the backup
  // step: setup itself no longer offers a backup (decided 2026-09-25).
  const params = useRoute().params as { addDevice?: boolean; byAddress?: boolean } | undefined
  const addDevice = Boolean(params?.addDevice)
  // "No code? Use your agent's address" (Alberto, 239): straight to the
  // address, without the introduction's Continue first.
  const byAddress = Boolean(params?.byAddress)
  // The stack titles this screen "Claim your agent"; adding a device is not
  // claiming one, and its two steps said so under the wrong title (225 gate).
  useEffect(() => {
    if (addDevice) navigation.setOptions({ title: t('Screens.AddDevice') })
  }, [addDevice, navigation, t])
  const { ColorPalette, TextTheme } = useTheme()
  const { link, agentNames } = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const headerHeight = useSafeHeaderHeight()
  const keyboard = useMeasuredKeyboardOffset(headerHeight)
  const readyName = readyNameOf(link.kind === 'linked' ? link.vtaDid : undefined, agentNames, t)

  const [step, setStep] = useState<LocalStep>(addDevice ? 'backupAddress' : byAddress ? 'address' : 'intro')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [codeShown, setCodeShown] = useState(false)
  const [howShown, setHowShown] = useState(false)
  // Face ID is asked once, when the code is handed out; checks after that are quiet.
  const [ownerConfirmed, setOwnerConfirmed] = useState(false)
  // A phone with no screen lock cannot own the agent, and has no Face ID or
  // passcode to ask for: it is added as a device instead, as an admin adds
  // any other (Alberto, 239: one way to link by address, not two).
  const [asDevice, setAsDevice] = useState(false)
  // The agent named is one this phone already has: offered as a switch.
  const [existingAgent, setExistingAgent] = useState<string | undefined>()
  const [pollUntil, setPollUntil] = useState<number | undefined>()
  const [pollExpired, setPollExpired] = useState(false)
  // Paused only when the app is known to be away; an unknown state keeps waiting.
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background')
  const focused = useIsFocused()
  // The person's own lock, named on the owner-code screen (not always "Face ID").
  const [lockKind, setLockKind] = useState<OwnerLockKind>('unknown')
  useEffect(() => {
    let live = true
    void ownerLockKind().then((kind) => live && setLockKind(kind))
    return () => {
      live = false
    }
  }, [])
  const needsScreenLock = () =>
    t(Platform.OS === 'ios' ? 'CreateAgent.NeedsScreenLockIos' : 'CreateAgent.NeedsScreenLockAndroid')
  const [busy, setBusy] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const [backupAdded, setBackupAdded] = useState<string | undefined>()
  const [addressShown, setAddressShown] = useState(false)
  // A scan asked for from here and never answered is dropped with the screen.
  useEffect(() => () => deviceCodeScan.cancel(), [])
  useEffect(() => () => agentAddressScan.cancel(), [])
  // The add-device code is sized to the space the screen has left, not only
  // its width (IN-50): on a tall phone with large text a width-sized code ran
  // under the Next bar, and a code with hidden rows cannot be read.
  const [viewportHeight, setViewportHeight] = useState<number | undefined>()
  const [headingHeight, setHeadingHeight] = useState(0)
  const { width: windowWidth } = useWindowDimensions()
  const backupQrSize = Math.max(
    QR_MIN_SIZE,
    Math.min(
      windowWidth - 2 * (SCREEN_PADDING + CARD_PADDING + QR_QUIET_ZONE),
      viewportHeight === undefined
        ? Number.POSITIVE_INFINITY
        : viewportHeight -
            2 * (SCREEN_PADDING + CARD_PADDING + QR_QUIET_ZONE + QR_RENDERER_MARGIN) -
            headingHeight -
            CARD_GAP
    )
  )

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: SCREEN_PADDING, gap: 16 },
    card: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 8,
      padding: CARD_PADDING,
      gap: CARD_GAP,
    },
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
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  })

  const ownerFailureLine = (reason?: OwnerConfirmFailure): string | undefined =>
    reason === 'cancelled'
      ? undefined // cancelling is not an error: the button stays, nothing is said
      : reason === 'unavailable'
        ? needsScreenLock()
        : t('CreateAgent.NotConfirmed')

  const refusalLine = (reason: DeviceRefusalReason, code?: string) =>
    t(`CreateAgent.Device.${reason}`, { code: code ?? '' })

  /** Backup, last turn: this phone approves the other phone's code (plan §4). */
  // The other device's name on this agent (IN-123): a plain default by the
  // kind of code until the person types their own.
  const [deviceName, setDeviceName] = useState<string | undefined>()
  const [addressCopied, setAddressCopied] = useState(false)
  const [errorDetail, setErrorDetail] = useState<string | undefined>()
  const [errorDetailOpen, setErrorDetailOpen] = useState(false)
  const defaultDeviceName = (code: string) =>
    deviceCodeIn(code)?.startsWith('did:key:') || code.trim().startsWith('did:key:')
      ? t('Devices.ShortComputer')
      : t('Devices.ShortPhone')
  const nameForCode = deviceName ?? defaultDeviceName(backupCode)

  /** `scanned`: a code the scanner just read, added straight away (IN-125); Face ID still asks first. */
  const onAddBackup = async (scanned?: string) => {
    if (!agent) return
    setError(undefined)
    setErrorDetail(undefined)
    setErrorDetailOpen(false)
    setBusy(true)
    try {
      const raw = scanned ?? backupCode
      const code = deviceCodeIn(raw) ?? raw.trim()
      const label = (deviceName ?? defaultDeviceName(raw)).trim() || t('CreateAgent.BackupLabel')
      const device = await vtaAgent.addBackupDevice(agent, code, label)
      setBackupAdded(device.label ?? label)
      // Back to My devices, which reads the list again on focus.
      if (addDevice) navigation.goBack()
      else setStep('ready')
    } catch (e) {
      const refusal = deviceRefusalOf(e)
      setErrorDetail(refusal.reason === 'refused' ? refusal.detail : undefined)
      setError(
        e instanceof Error && e.name === 'OwnerNotConfirmed'
          ? ownerFailureLine((e as { reason?: OwnerConfirmFailure }).reason)
          : refusalLine(refusal.reason, refusal.code)
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * What Scan read: an agent's address fills the field, for Continue; a
   * host's automatic-connection QR goes to that flow, which asks the person
   * on the link screen before anything is sent.
   */
  const onAddressScanned = (scanned: ScannedAgent) => {
    if (scanned.kind === 'address') {
      // Read: on to the next step straight away, with no Continue to press (IN-125).
      setAddress(scanned.vtaDid)
      void onAddressContinue(scanned.vtaDid)
      return
    }
    vtaAgent.scanHostOffer(scanned.offer)
    navigation.navigate(Screens.VtaLink as never)
  }

  /** Step 2 → 3: resolve the agent and make this phone's key (it names the agent's mediator). */
  const onAddressContinue = async (scanned?: string) => {
    setError(undefined)
    setExistingAgent(undefined)
    const did = (scanned ?? address).trim()
    if (!looksLikeAgentAddress(did)) {
      setError(t('CreateAgent.NotAnAddress'))
      return
    }
    if (!agent) return
    setBusy(true)
    try {
      setAsDevice(false)
      await vtaAgent.startCreateAgent(agent, did, did)
    } catch (e) {
      // An agent this phone already has (IN-132): said, with a switch to it.
      if (e instanceof AgentAlreadyOnPhone) {
        setError(t('VtaLink.AlreadyOnPhone'))
        setExistingAgent(e.vtaDid)
        return
      }
      if (!(e instanceof DeviceCannotOwn)) {
        setError(t('CreateAgent.NotConfirmed'))
        return
      }
      setAsDevice(true)
      await vtaAgent.startManualLink(agent, did, did)
    } finally {
      setBusy(false)
    }
    if (vtaAgent.getState().link.kind === 'notLinked') setError(t('CreateAgent.NoAgentThere'))
  }

  // A link that fails once its code is out (the agent refused it, it serves a
  // community, the key swap was refused…) is said here, back on the address,
  // since this screen has no failed step: in the link screen's words, the
  // original text under Details. Since this is the one way to link by
  // address (Alberto, 239), none of them may end in silence. Only a failure
  // of this screen's own attempt: an older one is not this person's news.
  const attempting = link.kind === 'showingKey' || link.kind === 'linking'
  const wasAttempting = useRef(false)
  useEffect(() => {
    const failure = link.kind === 'notLinked' ? link.lastError : undefined
    if (wasAttempting.current && failure) {
      setStep('address')
      setError(
        failure.reason === 'communityAgent'
          ? `${linkFailureText(failure, t)} ${t('VtaLink.FailedCommunityAgentCleanup')}`
          : linkFailureText(failure, t)
      )
      setErrorDetail(failure.detail)
      setErrorDetailOpen(false)
    }
    wasAttempting.current = attempting
  }, [attempting, link, t])

  const ownerKey = link.kind === 'showingKey' ? link.did : undefined

  const startWaiting = () => {
    setPollExpired(false)
    setPollUntil(Date.now() + GRANT_POLL_WINDOW_MS)
  }

  /** Copy and Share hand the owner code out: an owner act, so it asks first, then the phone waits for the agent. */
  const handOut = async (how: 'copy' | 'share') => {
    if (!ownerKey) return
    setError(undefined)
    if (!ownerConfirmed && !asDevice) {
      const confirmed = await confirmOwner(t('CreateAgent.ConfirmReason'))
      if (!confirmed.ok) {
        setError(ownerFailureLine(confirmed.reason))
        return
      }
      setOwnerConfirmed(true)
    }
    if (how === 'copy') Clipboard.setString(ownerKey)
    // Shared as a sentence with the code on its own line, never the bare
    // did:key: AirDrop on a Mac took the bare code for a link it could not
    // open. Copy stays the bare code, for pasting into the host's settings.
    else
      await Share.share({
        title: t('CreateAgent.ShareCodeTitle'),
        message: `${t('CreateAgent.ShareCodeMessage')}\n\n${ownerKey}\n`,
      }).catch(() => undefined)
    startWaiting()
  }

  /** "I've added it — check now" and "Check again": one check now, and a fresh waiting window. */
  const onConnect = async () => {
    if (!agent) return
    setError(undefined)
    if (!ownerConfirmed && !asDevice) {
      const confirmed = await confirmOwner(t('CreateAgent.ConfirmReason'))
      if (!confirmed.ok) {
        setError(ownerFailureLine(confirmed.reason))
        return
      }
      setOwnerConfirmed(true)
    }
    startWaiting()
    await vtaAgent.checkManualGrant(agent)
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setAppActive(next !== 'background'))
    return () => subscription.remove()
  }, [])

  // The quiet check: only on the owner-code screen, in view, in the foreground,
  // inside the window. checkManualGrant skips while one is already in flight.
  const showingCode = link.kind === 'showingKey'
  const waiting = showingCode && pollUntil !== undefined && !pollExpired
  // The window counts time in Keyring, not time asleep (IN-135): leaving the
  // app keeps what was left of it, and coming back starts that again. A
  // phone that slept through a slow setup came back to "Check again" with
  // the window spent.
  const pollLeft = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (pollUntil === undefined || pollExpired) return
    if (!appActive) {
      if (pollLeft.current === undefined) pollLeft.current = Math.max(0, pollUntil - Date.now())
      return
    }
    if (pollLeft.current !== undefined) {
      const left = pollLeft.current
      pollLeft.current = undefined
      setPollUntil(Date.now() + left)
    }
  }, [appActive, pollUntil, pollExpired])
  useEffect(() => {
    if (!waiting || !focused || !appActive || !agent || pollUntil === undefined) return
    const timer = setInterval(() => {
      if (Date.now() >= pollUntil) {
        setPollExpired(true)
        return
      }
      void vtaAgent.checkManualGrant(agent)
    }, GRANT_POLL_EVERY_MS)
    return () => clearInterval(timer)
  }, [waiting, focused, appActive, agent, pollUntil])

  // Which screen: the link machine's own state wins once it has moved on.
  const screen: 'intro' | 'address' | 'ownerCode' | 'connecting' | LocalStep =
    link.kind === 'showingKey'
      ? 'ownerCode'
      : link.kind === 'linking'
        ? 'connecting'
        : link.kind === 'linked'
          ? step === 'backupAddress' || step === 'backupCode'
            ? step
            : 'ready'
          : step === 'ready' || step === 'backupAddress' || step === 'backupCode'
            ? 'address'
            : step

  const errorLine = (key: VtaCreateAgentId) =>
    error ? (
      <>
        <ThemedText style={styles.error} testID={testIdWithKey(key)}>
          {error}
        </ThemedText>
        {/* A refusal's own words, for whoever reads the report (al-phone, 10-05). */}
        {errorDetail ? (
          <>
            <Pressable
              onPress={() => setErrorDetailOpen(!errorDetailOpen)}
              accessibilityRole="button"
              accessibilityState={{ expanded: errorDetailOpen }}
              testID={testIdWithKey(`${key}DetailsToggle`)}
            >
              <ThemedText style={styles.muted}>{t('Errors.ShowDetails')}</ThemedText>
            </Pressable>
            {errorDetailOpen ? (
              <ThemedText style={styles.muted} selectable testID={testIdWithKey(`${key}Detail`)}>
                {errorDetail}
              </ThemedText>
            ) : null}
          </>
        ) : null}
      </>
    ) : null

  let body: React.ReactNode
  let actions: React.ReactNode

  if (screen === 'intro') {
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.createIntro)}>
        <ThemedText variant="headingThree">{t('CreateAgent.IntroTitle')}</ThemedText>
        <ThemedText>{t('CreateAgent.IntroBody')}</ThemedText>
        <ThemedText>{t('CreateAgent.IntroStep1')}</ThemedText>
        <ThemedText>{t('CreateAgent.IntroStep2')}</ThemedText>
        <ThemedText>{t('CreateAgent.IntroStep3')}</ThemedText>
      </View>
    )
    actions = (
      <>
        {AGENT_HOST_WEBSITE ? (
          <Button
            title={t('CreateAgent.OpenHost')}
            buttonType={ButtonType.Secondary}
            onPress={() => Linking.openURL(AGENT_HOST_WEBSITE as string)}
            testID={testIdWithKey(VtaCreateAgentIds.createOpenHost)}
          />
        ) : null}
        <Button
          title={t('Global.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() => setStep('address')}
          testID={testIdWithKey(VtaCreateAgentIds.createContinue)}
        />
      </>
    )
  } else if (screen === 'address') {
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.createAddress)}>
        <ThemedText style={styles.muted}>{t('CreateAgent.Step', { n: 1, of: 2 })}</ThemedText>
        <ThemedText variant="headingThree">{t('CreateAgent.AddressTitle')}</ThemedText>
        <ThemedText>{t('CreateAgent.AddressBody')}</ThemedText>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="did:webvh:…"
          // The step's button sits below the field; "go" reaches it without it.
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!busy && address.trim()) void onAddressContinue()
          }}
          testID={testIdWithKey(VtaCreateAgentIds.createAddressInput)}
        />
      </View>
    )
    actions = (
      <>
        {errorLine(VtaCreateAgentIds.createError)}
        {existingAgent && agent ? (
          <Button
            title={t('VtaLink.SwitchToIt')}
            buttonType={ButtonType.Primary}
            onPress={() => {
              const target = existingAgent
              setExistingAgent(undefined)
              void vtaAgent.switchToExisting(agent, target)
              ;(
                navigation as unknown as { reset: (state: { index: number; routes: { name: string }[] }) => void }
              ).reset({
                index: 0,
                routes: [{ name: Screens.VtaAgent }],
              })
            }}
            testID={testIdWithKey(VtaCreateAgentIds.createSwitchToExisting)}
          />
        ) : null}
        {/* The host's page shows the agent's address as a QR, or its
            automatic-connection QR: Scan takes either (228). */}
        <Button
          title={t('CreateAgent.ScanAddress')}
          buttonType={ButtonType.Secondary}
          onPress={() => {
            setError(undefined)
            agentAddressScan.request(onAddressScanned)
            openScanner(navigation)
          }}
          testID={testIdWithKey(VtaCreateAgentIds.createScanAddress)}
        />
        <Button
          title={t('CreateAgent.Paste')}
          buttonType={ButtonType.Secondary}
          onPress={async () => setAddress((await Clipboard.getString()).trim())}
          testID={testIdWithKey(VtaCreateAgentIds.createPasteAddress)}
        />
        <Button
          title={t('Global.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() => void onAddressContinue()}
          disabled={busy || !address.trim()}
          testID={testIdWithKey(VtaCreateAgentIds.createAddressContinue)}
        >
          {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      </>
    )
  } else if (screen === 'ownerCode' && link.kind === 'showingKey') {
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.createOwnerCode)}>
        <ThemedText style={styles.muted}>{t('CreateAgent.Step', { n: 2, of: 2 })}</ThemedText>
        <ThemedText variant="headingThree">
          {asDevice ? t('CreateAgent.AsDeviceTitle') : t('CreateAgent.OwnerTitle')}
        </ThemedText>
        {asDevice ? (
          <ThemedText testID={testIdWithKey(VtaCreateAgentIds.createAsDevice)}>
            {t('CreateAgent.AsDeviceBody')}
          </ThemedText>
        ) : (
          <ThemedText testID={testIdWithKey(VtaCreateAgentIds.createOwnerBody)}>
            {t('CreateAgent.OwnerBody', {
              method: t(`CreateAgent.Lock.${lockKind}`),
              interpolation: { escapeValue: false },
            })}
          </ThemedText>
        )}
        <ThemedText>{t('CreateAgent.OwnerWhereToPaste')}</ThemedText>
        <Pressable
          onPress={() => setHowShown(!howShown)}
          accessibilityRole="button"
          accessibilityState={{ expanded: howShown }}
          testID={testIdWithKey(VtaCreateAgentIds.createOwnerHowToggle)}
        >
          <ThemedText style={styles.muted}>{t('CreateAgent.OwnerHowToggle')}</ThemedText>
        </Pressable>
        {howShown ? (
          <ThemedText style={styles.muted} testID={testIdWithKey(VtaCreateAgentIds.createOwnerHow)}>
            {t('CreateAgent.OwnerHow')}
          </ThemedText>
        ) : null}
        <View style={styles.row}>
          <Button
            title={t('VtaLink.CopyKey')}
            buttonType={ButtonType.Secondary}
            onPress={() => handOut('copy')}
            testID={testIdWithKey(VtaCreateAgentIds.createCopyCode)}
          />
          <Button
            title={t('VtaLink.ShareKey')}
            buttonType={ButtonType.Secondary}
            onPress={() => handOut('share')}
            testID={testIdWithKey(VtaCreateAgentIds.createShareCode)}
          />
        </View>
        <Pressable
          onPress={() => setCodeShown(!codeShown)}
          accessibilityRole="button"
          accessibilityState={{ expanded: codeShown }}
          testID={testIdWithKey(VtaCreateAgentIds.createShowCode)}
        >
          <ThemedText style={styles.muted}>
            {codeShown ? t('VtaLink.HideTheCode') : t('VtaLink.ShowTheCode')}
          </ThemedText>
        </Pressable>
        {codeShown ? (
          <ThemedText style={styles.key} testID={testIdWithKey(VtaCreateAgentIds.createOwnerDid)} selectable>
            {link.did}
          </ThemedText>
        ) : null}
      </View>
    )
    actions = (
      <>
        {waiting ? (
          <View style={styles.row} testID={testIdWithKey(VtaCreateAgentIds.createWaiting)}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={{ flex: 1 }}>{t('CreateAgent.Waiting')}</ThemedText>
          </View>
        ) : link.notYet ? (
          <ThemedText style={styles.error} testID={testIdWithKey(VtaCreateAgentIds.createError)}>
            {t('CreateAgent.NotAcceptedYet')}
          </ThemedText>
        ) : link.noAnswer ? (
          <ThemedText style={styles.error} testID={testIdWithKey(VtaCreateAgentIds.createError)}>
            {t('CreateAgent.Unreachable')}
          </ThemedText>
        ) : (
          errorLine(VtaCreateAgentIds.createError)
        )}
        {pollExpired ? (
          <Button
            title={t('CreateAgent.CheckAgain')}
            buttonType={ButtonType.Primary}
            onPress={onConnect}
            disabled={link.checking}
            testID={testIdWithKey(VtaCreateAgentIds.createCheckAgain)}
          />
        ) : null}
        <Button
          title={t('CreateAgent.Connect')}
          buttonType={pollExpired ? ButtonType.Secondary : ButtonType.Primary}
          onPress={onConnect}
          disabled={link.checking}
          testID={testIdWithKey(VtaCreateAgentIds.createConnect)}
        >
          {link.checking && !waiting ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      </>
    )
  } else if (screen === 'connecting' && link.kind === 'linking') {
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.createProgress)}>
        <View style={styles.row}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
          <ThemedText testID={testIdWithKey(`AgentCreateStep_${link.step}`)}>
            {link.step === 'connecting' ? t('CreateAgent.SigningIn') : t('CreateAgent.GettingReady')}
          </ThemedText>
        </View>
      </View>
    )
  } else if (screen === 'backupAddress') {
    const agentDid = vtaAgent.agentAddress()
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.backupAddressQr)}>
        <ThemedText
          variant="headingThree"
          onLayout={(e) => setHeadingHeight(e.nativeEvent.layout.height)}
          testID={testIdWithKey(VtaCreateAgentIds.backupScanThisHeading)}
        >
          {t('CreateAgent.BackupScanThis')}
        </ThemedText>
        {agentDid ? (
          <QRRenderer
            value={agentDid}
            size={backupQrSize}
            quietZone={QR_QUIET_ZONE}
            testID={testIdWithKey(VtaCreateAgentIds.backupAddressQrCode)}
          />
        ) : null}
        <ThemedText>{t('CreateAgent.BackupScanThisBody')}</ThemedText>
        {agentDid ? (
          <Pressable
            onPress={() => setAddressShown(!addressShown)}
            accessibilityRole="button"
            accessibilityState={{ expanded: addressShown }}
            testID={testIdWithKey(VtaCreateAgentIds.backupShowAsText)}
          >
            <ThemedText style={styles.muted}>
              {addressShown ? t('VtaLink.HideText') : t('VtaLink.ShowAsText')}
            </ThemedText>
          </Pressable>
        ) : null}
        {agentDid && addressShown ? (
          <ThemedText selectable testID={testIdWithKey(VtaCreateAgentIds.backupAddressText)}>
            {agentDid}
          </ThemedText>
        ) : null}
        {/* One tap to hand the address to a computer (Universal Clipboard,
            AirDrop) rather than reading it off the QR (IN-126). */}
        {agentDid ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              title={addressCopied ? t('VtaLink.KeyCopied') : t('VtaLink.CopyKey')}
              buttonType={ButtonType.Secondary}
              onPress={() => {
                Clipboard.setString(agentDid)
                setAddressCopied(true)
              }}
              testID={testIdWithKey(VtaCreateAgentIds.backupCopyAddress)}
            />
            <Button
              title={t('VtaLink.ShareKey')}
              buttonType={ButtonType.Secondary}
              onPress={() => void Share.share({ message: agentDid }).catch(() => undefined)}
              testID={testIdWithKey(VtaCreateAgentIds.backupShareAddress)}
            />
          </View>
        ) : null}
      </View>
    )
    actions = (
      <>
        {/* A computer or another app (pnm, the browser plugin) does not scan
            this: it shows its own code to enter, so that way is said here
            rather than found only after Next (IN-123). */}
        <ThemedText style={styles.muted} testID={testIdWithKey(VtaCreateAgentIds.backupOtherKinds)}>
          {t('CreateAgent.BackupOtherKinds')}
        </ThemedText>
        <Button
          title={t('Global.Next')}
          buttonType={ButtonType.Primary}
          onPress={() => setStep('backupCode')}
          testID={testIdWithKey(VtaCreateAgentIds.backupNext)}
        />
        <Button
          title={t('CreateAgent.BackupEnterCode')}
          buttonType={ButtonType.Secondary}
          onPress={() => setStep('backupCode')}
          testID={testIdWithKey(VtaCreateAgentIds.backupEnterCode)}
        />
      </>
    )
  } else if (screen === 'backupCode') {
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.backupScanCode)}>
        <ThemedText variant="headingThree">{t('CreateAgent.BackupNowScan')}</ThemedText>
        <ThemedText>{t('CreateAgent.BackupNowScanBody')}</ThemedText>
        <TextInput
          style={styles.input}
          value={backupCode}
          onChangeText={setBackupCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="did:key:z6Mk…"
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!busy && backupCode.trim()) void onAddBackup()
          }}
          testID={testIdWithKey(VtaCreateAgentIds.backupCodeInput)}
        />
        {/* Its name, as My devices will show it; renamed later beside Remove. */}
        {backupCode.trim() ? <DeviceNameField value={nameForCode} onChange={setDeviceName} other /> : null}
      </View>
    )
    actions = (
      <>
        {errorLine(VtaCreateAgentIds.createError)}
        {/* One filled button: Scan until there is a code, then adding it (#30). */}
        <Button
          title={t('CreateAgent.ScanItsCode')}
          buttonType={backupCode.trim() ? ButtonType.Secondary : ButtonType.Primary}
          onPress={() => {
            setError(undefined)
            // Read: added straight away (IN-125); the owner check is the only stop.
            deviceCodeScan.request((code) => {
              setBackupCode(code)
              void onAddBackup(code)
            })
            openScanner(navigation)
          }}
          disabled={busy}
          testID={testIdWithKey(VtaCreateAgentIds.backupScanButton)}
        />
        <Button
          title={t('CreateAgent.Paste')}
          buttonType={ButtonType.Secondary}
          onPress={async () => {
            const pasted = await Clipboard.getString()
            setBackupCode(deviceCodeIn(pasted) ?? pasted.trim())
          }}
          testID={testIdWithKey(VtaCreateAgentIds.backupPasteCode)}
        />
        {backupCode.trim() ? (
          <Button
            title={t('CreateAgent.AddThisPhone')}
            buttonType={ButtonType.Primary}
            onPress={() => void onAddBackup()}
            disabled={busy}
            testID={testIdWithKey(VtaCreateAgentIds.backupAdd)}
          >
            {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
          </Button>
        ) : null}
      </>
    )
  } else {
    body = (
      <View style={styles.card} testID={testIdWithKey(VtaCreateAgentIds.createReady)}>
        <ThemedText variant="headingThree">{t('CreateAgent.ReadyTitle')}</ThemedText>
        <ThemedText>
          {t('CreateAgent.ReadyBody', { label: readyName, interpolation: { escapeValue: false } })}
        </ThemedText>
        <ThemedText
          style={styles.muted}
          testID={testIdWithKey(backupAdded ? VtaCreateAgentIds.backupAdded : VtaCreateAgentIds.backupNone)}
        >
          {backupAdded
            ? t('CreateAgent.YourBackup', { device: backupAdded, interpolation: { escapeValue: false } })
            : t('CreateAgent.BackupLater')}
        </ThemedText>
      </View>
    )
    actions = (
      <>
        <Button
          title={t('CreateAgent.JoinCommunity')}
          buttonType={ButtonType.Primary}
          onPress={() => navigation.navigate(Screens.VtiJoin as never)}
          testID={testIdWithKey(VtaCreateAgentIds.createJoin)}
        />
        <Button
          title={t('Global.Done')}
          buttonType={ButtonType.Secondary}
          // The stack is set to the agent's page, not popped back to the
          // panel this began on: that panel, linked now, swapped itself for
          // the agent's page while the pop was still animating, and on
          // Android that left the app gone (238 gate). The agent's page plays
          // the first-link introduction.
          onPress={() =>
            (navigation as unknown as { reset: (state: { index: number; routes: { name: string }[] }) => void }).reset({
              index: 0,
              routes: [{ name: Screens.VtaAgent }],
            })
          }
          testID={testIdWithKey(VtaCreateAgentIds.createDone)}
        />
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {/* The steps' buttons sit under the page, and on iOS the keyboard covered
          them: a person who pasted the address saw no Continue (225 gate).
          keyboard-controller's view lifts them over it on both platforms. */}
      <KeyboardAvoidingView
        ref={keyboard.ref}
        onLayout={keyboard.onLayout}
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={keyboard.offset}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
          testID={testIdWithKey(VtaCreateAgentIds.createScroll)}
        >
          {body}
        </ScrollView>
        <View style={styles.actions}>{actions}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default VtaCreateAgent
