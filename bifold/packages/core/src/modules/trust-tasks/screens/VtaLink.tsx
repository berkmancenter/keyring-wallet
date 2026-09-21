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
import { useNavigation } from '@react-navigation/native'
import React, { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
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
  })

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
    navigation.navigate(Screens.MyAgent as never)
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
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </SafeAreaView>
  )
}

export default VtaLink
