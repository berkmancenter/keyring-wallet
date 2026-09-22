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
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens, Stacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { VtaLinkFailure } from '../module/vtaLinkMachine'

/** The agent's host, for people: the domain inside a did:webvh, else the label alone. */
export function agentHost(vtaDid: string): string | undefined {
  const parts = vtaDid.split(':')
  return parts[1] === 'webvh' && parts.length >= 4 ? decodeURIComponent(parts[3]) : undefined
}

const VtaLink: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette, TextTheme } = useTheme()
  const { link } = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  // Form state only — what the person is typing before they ask for a key.
  const [manualEntry, setManualEntry] = useState(false)
  const [agentAddress, setAgentAddress] = useState('')
  const [copied, setCopied] = useState(false)

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
    void vtaAgent.startManualLink(agent, vtaDid, agentHost(vtaDid) ?? vtaDid)
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
    const root = navigation as unknown as { navigate: (name: string, params?: object) => void }
    // The scanner itself, with its paste-URL button — not `defaultToConnect`,
    // which opens this wallet's own invitation QR instead.
    root.navigate(Stacks.ConnectStack, { screen: Screens.Scan })
  }, [navigation])

  const onDone = useCallback(() => {
    // The agent screen, where the first-link introduction plays once, over My
    // Agent. The stack is set rather than pushed: pushed on top, "Linked ✓"
    // stayed underneath and came back on every return to the tab; and a link
    // begun from the scanner can open this screen as the stack's only route.
    const stack = navigation as unknown as { reset: (state: { index: number; routes: { name: string }[] }) => void }
    stack.reset({ index: 1, routes: [{ name: Screens.MyAgent }, { name: Screens.VtaAgent }] })
  }, [navigation])

  const failureText = (failure?: VtaLinkFailure) => {
    switch (failure?.reason) {
      case 'expired':
        return t('VtaLink.FailedExpired')
      case 'refused':
        return t('VtaLink.FailedRefused')
      case 'unreachable':
        return t('VtaLink.FailedUnreachable')
      default:
        return t('VtaLink.FailedOther')
    }
  }

  const host = 'vtaDid' in link ? (agentHost(link.vtaDid) ?? '') : ''
  let body: React.ReactNode
  let actions: React.ReactNode

  switch (link.kind) {
    case 'confirming':
    case 'submitting':
      body = (
        <View style={styles.card} testID={testIdWithKey('VtaLinkConfirm')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaLink.ConfirmTitle', { label: link.label, interpolation: { escapeValue: false } })}
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
      body = (
        <View style={styles.card} testID={testIdWithKey('VtaLinkShowingKey')}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaLink.GiveKeyTitle')}
          </ThemedText>
          <ThemedText>
            {t('VtaLink.GiveKeyBody', { label: link.label, interpolation: { escapeValue: false } })}
          </ThemedText>
          <ThemedText style={styles.key} testID={testIdWithKey('VtaLinkManualDid')} selectable>
            {link.did}
          </ThemedText>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                title={copied ? t('VtaLink.KeyCopied') : t('VtaLink.CopyKey')}
                buttonType={ButtonType.Secondary}
                onPress={() => {
                  Clipboard.setString(link.did)
                  setCopied(true)
                }}
                testID={testIdWithKey('VtaLinkCopyKey')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('VtaLink.ShareKey')}
                buttonType={ButtonType.Secondary}
                onPress={() => void Share.share({ message: link.did })}
                testID={testIdWithKey('VtaLinkShareKey')}
              />
            </View>
          </View>
          {link.notYet ? (
            <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkNotYet')}>
              {t('VtaLink.NotAddedYet')}
            </ThemedText>
          ) : null}
        </View>
      )
      actions = (
        <>
          <Button
            title={link.checking ? t('VtaLink.Checking') : t('VtaLink.ImAdded')}
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
          <ThemedText>
            {t('VtaLink.LinkedBody', { label: link.label, interpolation: { escapeValue: false } })}
          </ThemedText>
        </View>
      )
      actions = (
        <Button
          title={t('VtaLink.Continue')}
          buttonType={ButtonType.Primary}
          onPress={onDone}
          testID={testIdWithKey('VtaLinkContinue')}
        />
      )
      break

    case 'revoked':
      body = (
        <View style={styles.card}>
          <ThemedText variant="headingThree" accessibilityRole="header">
            {t('VtaLink.RevokedTitle')}
          </ThemedText>
          <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkError')}>
            {t('VtaLink.RevokedBody', { label: link.label, interpolation: { escapeValue: false } })}
          </ThemedText>
        </View>
      )
      actions = (
        <Button
          title={t('VtaLink.ScanAgain')}
          buttonType={ButtonType.Primary}
          onPress={onScanAgain}
          testID={testIdWithKey('VtaLinkScanAgain')}
        />
      )
      break

    case 'notLinked':
      body = (
        <>
          <View style={styles.card}>
            <ThemedText variant="headingThree" accessibilityRole="header">
              {link.lastError ? t('VtaLink.FailedTitle') : t('VtaLink.NothingToLink')}
            </ThemedText>
            {link.lastError ? (
              <ThemedText style={styles.error} testID={testIdWithKey('VtaLinkError')}>
                {failureText(link.lastError)}
              </ThemedText>
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default VtaLink
