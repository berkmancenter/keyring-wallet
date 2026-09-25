/**
 * Create my agent (own_agent_subtask.md §1, §7): a person with only a phone
 * and the VTA Farm's website makes an agent and owns it from Keyring.
 *
 * The steps follow the Farm's own wizard: the agent's address first (the
 * phone's key names the agent's mediator, so it cannot be made before), then
 * this phone's owner code for the Farm's "Admin DID" box, then connect. The
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
import { useNavigation } from '@react-navigation/native'
import React, { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import QRRenderer from '../../../components/misc/QRRenderer'
import { confirmOwner, type OwnerConfirmFailure } from '../module/ownerConfirm'
import { vtaAgent } from '../module/vtaAgent'
import { DeviceCannotOwn, deviceRefusalOf, type DeviceRefusalReason } from '../module/vtaOwner'

/**
 * A known agent host's website, to open from the intro. Never named on screen:
 * the words say "your agent's host", as for email. Unset, there is no button.
 */
export const AGENT_HOST_WEBSITE: string | undefined = undefined

type LocalStep = 'intro' | 'address' | 'backup' | 'backupAddress' | 'backupCode' | 'ready'

/** An agent's address, as the Farm shows it after "Create session". */
export const looksLikeAgentAddress = (text: string): boolean => /^did:webvh:[^\s]+:[^\s]+$/.test(text.trim())

/** The host a did:webvh names: shown until the agent gives its own name. */
const hostOf = (did: string): string => did.split(':')[3] ?? did

const VtaCreateAgent: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette, TextTheme } = useTheme()
  const { link } = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)

  const [step, setStep] = useState<LocalStep>('intro')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [codeShown, setCodeShown] = useState(false)
  const [howShown, setHowShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  const [backupAdded, setBackupAdded] = useState<string | undefined>()

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
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
        ? t('CreateAgent.NeedsScreenLock')
        : t('CreateAgent.NotConfirmed')

  const refusalLine = (reason: DeviceRefusalReason) => t(`CreateAgent.Device.${reason}`)

  /** Backup, last turn: this phone approves the other phone's code (plan §4). */
  const onAddBackup = async () => {
    if (!agent) return
    setError(undefined)
    setBusy(true)
    try {
      const device = await vtaAgent.addBackupDevice(agent, backupCode.trim(), t('CreateAgent.BackupLabel'))
      setBackupAdded(device.label ?? t('CreateAgent.BackupLabel'))
      setStep('ready')
    } catch (e) {
      const refusal = deviceRefusalOf(e)
      setError(
        e instanceof Error && e.name === 'OwnerNotConfirmed'
          ? ownerFailureLine((e as { reason?: OwnerConfirmFailure }).reason)
          : refusalLine(refusal.reason)
      )
    } finally {
      setBusy(false)
    }
  }

  /** Step 2 → 3: resolve the agent and make this phone's key (it names the agent's mediator). */
  const onAddressContinue = async () => {
    setError(undefined)
    const did = address.trim()
    if (!looksLikeAgentAddress(did)) {
      setError(t('CreateAgent.NotAnAddress'))
      return
    }
    if (!agent) return
    setBusy(true)
    try {
      await vtaAgent.startCreateAgent(agent, did, hostOf(did))
    } catch (e) {
      setError(e instanceof DeviceCannotOwn ? t('CreateAgent.NeedsScreenLock') : t('CreateAgent.NotConfirmed'))
      return
    } finally {
      setBusy(false)
    }
    if (vtaAgent.getState().link.kind === 'notLinked') setError(t('CreateAgent.NoAgentThere'))
  }

  const ownerKey = link.kind === 'showingKey' ? link.did : undefined

  /** Copy and Share hand the owner code out: an owner act, so it asks first. */
  const handOut = async (how: 'copy' | 'share') => {
    if (!ownerKey) return
    setError(undefined)
    const confirmed = await confirmOwner(t('CreateAgent.ConfirmReason'))
    if (!confirmed.ok) {
      setError(ownerFailureLine(confirmed.reason))
      return
    }
    if (how === 'copy') Clipboard.setString(ownerKey)
    else await Share.share({ message: ownerKey }).catch(() => undefined)
  }

  /** "It's online — connect": sign in as the owner code, then move onto the long-term key. */
  const onConnect = async () => {
    if (!agent) return
    setError(undefined)
    const confirmed = await confirmOwner(t('CreateAgent.ConfirmReason'))
    if (!confirmed.ok) {
      setError(ownerFailureLine(confirmed.reason))
      return
    }
    await vtaAgent.checkManualGrant(agent)
  }

  // Which screen: the link machine's own state wins once it has moved on.
  const screen: 'intro' | 'address' | 'ownerCode' | 'connecting' | LocalStep =
    link.kind === 'showingKey'
      ? 'ownerCode'
      : link.kind === 'linking'
        ? 'connecting'
        : link.kind === 'linked'
          ? step === 'ready' || step === 'backupAddress' || step === 'backupCode'
            ? step
            : 'backup'
          : step === 'backup' || step === 'ready' || step === 'backupAddress' || step === 'backupCode'
            ? 'address'
            : step

  const errorLine = (key: string) =>
    error ? (
      <ThemedText style={styles.error} testID={testIdWithKey(key)}>
        {error}
      </ThemedText>
    ) : null

  let body: React.ReactNode
  let actions: React.ReactNode

  if (screen === 'intro') {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentCreateIntro')}>
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
            testID={testIdWithKey('AgentCreateOpenHost')}
          />
        ) : null}
        <Button
          title={t('Global.Continue')}
          buttonType={ButtonType.Primary}
          onPress={() => setStep('address')}
          testID={testIdWithKey('AgentCreateContinue')}
        />
      </>
    )
  } else if (screen === 'address') {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentCreateAddress')}>
        <ThemedText style={styles.muted}>{t('CreateAgent.Step', { n: 1, of: 3 })}</ThemedText>
        <ThemedText variant="headingThree">{t('CreateAgent.AddressTitle')}</ThemedText>
        <ThemedText>{t('CreateAgent.AddressBody')}</ThemedText>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="did:webvh:…"
          testID={testIdWithKey('AgentCreateAddressInput')}
        />
      </View>
    )
    actions = (
      <>
        {errorLine('AgentCreateError')}
        <Button
          title={t('CreateAgent.Paste')}
          buttonType={ButtonType.Secondary}
          onPress={async () => setAddress((await Clipboard.getString()).trim())}
          testID={testIdWithKey('AgentCreatePasteAddress')}
        />
        <Button
          title={t('Global.Continue')}
          buttonType={ButtonType.Primary}
          onPress={onAddressContinue}
          disabled={busy || !address.trim()}
          testID={testIdWithKey('AgentCreateAddressContinue')}
        >
          {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      </>
    )
  } else if (screen === 'ownerCode' && link.kind === 'showingKey') {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentCreateOwnerCode')}>
        <ThemedText style={styles.muted}>{t('CreateAgent.Step', { n: 2, of: 3 })}</ThemedText>
        <ThemedText variant="headingThree">{t('CreateAgent.OwnerTitle')}</ThemedText>
        <ThemedText>{t('CreateAgent.OwnerBody')}</ThemedText>
        <ThemedText>{t('CreateAgent.OwnerWhereToPaste')}</ThemedText>
        <Pressable
          onPress={() => setHowShown(!howShown)}
          accessibilityRole="button"
          accessibilityState={{ expanded: howShown }}
          testID={testIdWithKey('AgentCreateOwnerHowToggle')}
        >
          <ThemedText style={styles.muted}>{t('CreateAgent.OwnerHowToggle')}</ThemedText>
        </Pressable>
        {howShown ? (
          <ThemedText style={styles.muted} testID={testIdWithKey('AgentCreateOwnerHow')}>
            {t('CreateAgent.OwnerHow')}
          </ThemedText>
        ) : null}
        <View style={styles.row}>
          <Button
            title={t('VtaLink.CopyKey')}
            buttonType={ButtonType.Secondary}
            onPress={() => handOut('copy')}
            testID={testIdWithKey('AgentCreateCopyCode')}
          />
          <Button
            title={t('VtaLink.ShareKey')}
            buttonType={ButtonType.Secondary}
            onPress={() => handOut('share')}
            testID={testIdWithKey('AgentCreateShareCode')}
          />
        </View>
        <Pressable
          onPress={() => setCodeShown(!codeShown)}
          accessibilityRole="button"
          accessibilityState={{ expanded: codeShown }}
          testID={testIdWithKey('AgentCreateShowCode')}
        >
          <ThemedText style={styles.muted}>
            {codeShown ? t('VtaLink.HideTheCode') : t('VtaLink.ShowTheCode')}
          </ThemedText>
        </Pressable>
        {codeShown ? (
          <ThemedText style={styles.key} testID={testIdWithKey('AgentCreateOwnerDid')} selectable>
            {link.did}
          </ThemedText>
        ) : null}
      </View>
    )
    actions = (
      <>
        {link.notYet ? (
          <ThemedText style={styles.error} testID={testIdWithKey('AgentCreateError')}>
            {t('CreateAgent.NotAcceptedYet')}
          </ThemedText>
        ) : link.noAnswer ? (
          <ThemedText style={styles.error} testID={testIdWithKey('AgentCreateError')}>
            {t('CreateAgent.Unreachable')}
          </ThemedText>
        ) : (
          errorLine('AgentCreateError')
        )}
        <Button
          title={t('CreateAgent.Connect')}
          buttonType={ButtonType.Primary}
          onPress={onConnect}
          disabled={link.checking}
          testID={testIdWithKey('AgentCreateConnect')}
        >
          {link.checking ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      </>
    )
  } else if (screen === 'connecting' && link.kind === 'linking') {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentCreateProgress')}>
        <View style={styles.row}>
          <ActivityIndicator color={ColorPalette.brand.primary} />
          <ThemedText testID={testIdWithKey(`AgentCreateStep_${link.step}`)}>
            {link.step === 'connecting' ? t('CreateAgent.SigningIn') : t('CreateAgent.GettingReady')}
          </ThemedText>
        </View>
      </View>
    )
  } else if (screen === 'backup') {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentBackup')}>
        <ThemedText style={styles.muted}>{t('CreateAgent.Step', { n: 3, of: 3 })}</ThemedText>
        <ThemedText variant="headingThree">{t('CreateAgent.BackupTitle')}</ThemedText>
        <ThemedText>{t('CreateAgent.BackupBody')}</ThemedText>
      </View>
    )
    actions = (
      <>
        <Button
          title={t('CreateAgent.UseAnotherPhone')}
          buttonType={ButtonType.Primary}
          onPress={() => setStep('backupAddress')}
          testID={testIdWithKey('AgentBackupPhone')}
        />
        <Button
          title={t('CreateAgent.NotNow')}
          buttonType={ButtonType.Secondary}
          onPress={() => setStep('ready')}
          testID={testIdWithKey('AgentBackupLater')}
        />
      </>
    )
  } else if (screen === 'backupAddress') {
    const agentDid = vtaAgent.agentAddress()
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentBackupAddressQr')}>
        <ThemedText variant="headingThree">{t('CreateAgent.BackupScanThis')}</ThemedText>
        <ThemedText>{t('CreateAgent.BackupScanThisBody')}</ThemedText>
        {agentDid ? <QRRenderer value={agentDid} testID={testIdWithKey('AgentBackupAddressQrCode')} /> : null}
      </View>
    )
    actions = (
      <Button
        title={t('Global.Next')}
        buttonType={ButtonType.Primary}
        onPress={() => setStep('backupCode')}
        testID={testIdWithKey('AgentBackupNext')}
      />
    )
  } else if (screen === 'backupCode') {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentBackupScanCode')}>
        <ThemedText variant="headingThree">{t('CreateAgent.BackupNowScan')}</ThemedText>
        <ThemedText>{t('CreateAgent.BackupNowScanBody')}</ThemedText>
        <TextInput
          style={styles.input}
          value={backupCode}
          onChangeText={setBackupCode}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="did:key:z6Mk…"
          testID={testIdWithKey('AgentBackupCodeInput')}
        />
      </View>
    )
    actions = (
      <>
        {errorLine('AgentCreateError')}
        <Button
          title={t('CreateAgent.Paste')}
          buttonType={ButtonType.Secondary}
          onPress={async () => setBackupCode((await Clipboard.getString()).trim())}
          testID={testIdWithKey('AgentBackupPasteCode')}
        />
        <Button
          title={t('CreateAgent.AddBackup')}
          buttonType={ButtonType.Primary}
          onPress={onAddBackup}
          disabled={busy || !backupCode.trim()}
          testID={testIdWithKey('AgentBackupAdd')}
        >
          {busy ? <ActivityIndicator color={ColorPalette.grayscale.white} /> : null}
        </Button>
      </>
    )
  } else {
    body = (
      <View style={styles.card} testID={testIdWithKey('AgentCreateReady')}>
        <ThemedText variant="headingThree">{t('CreateAgent.ReadyTitle')}</ThemedText>
        <ThemedText>
          {t('CreateAgent.ReadyBody', {
            label: link.kind === 'linked' ? link.label : hostOf(address),
            interpolation: { escapeValue: false },
          })}
        </ThemedText>
        <ThemedText style={styles.muted} testID={testIdWithKey(backupAdded ? 'AgentBackupAdded' : 'AgentBackupNone')}>
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
          testID={testIdWithKey('AgentCreateJoin')}
        />
        <Button
          title={t('Global.Done')}
          buttonType={ButtonType.Secondary}
          onPress={() => navigation.goBack()}
          testID={testIdWithKey('AgentCreateDone')}
        />
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      <View style={styles.actions}>{actions}</View>
    </SafeAreaView>
  )
}

export default VtaCreateAgent
