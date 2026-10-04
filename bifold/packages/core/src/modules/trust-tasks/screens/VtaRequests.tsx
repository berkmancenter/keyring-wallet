/**
 * Requests — what waits for this person's decision, and nothing else.
 *
 * A notification, the "something waits" banner and the row in Manage all open
 * this screen. Every waiting request is shown in full with Approve / Decline;
 * one request is therefore already open. What it shows otherwise — getting
 * them, nothing waiting, can't reach the agent, done — is decided by
 * `requestsView`.
 *
 * Back always leads to "Your agent": a notification opens this screen with
 * nothing under it, so the header's back is supplied here when the stack has
 * none.
 *
 * @module trust-tasks/screens/VtaRequests
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import { HeaderBackButton } from '@react-navigation/elements'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'

import { agentHomeScreen } from './agentHome'
import { RequestCard } from './RequestCard'
import { requestsView } from './requestsView'

type Nav = {
  getState: () => { index?: number } | undefined
  goBack: () => void
  navigate: (name: string) => void
  replace: (name: string) => void
  setOptions: (options: object) => void
}

const VtaRequests: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const navigation = useNavigation() as unknown as Nav
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)

  // The clock: a request expires, and "quiet long enough" arrives, with nothing else happening.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Since when this screen has seen the connection up.
  const online = state.link.kind === 'linked' && state.link.connection.kind === 'online'
  const onlineSince = useRef<number | undefined>(undefined)
  if (!online) onlineSince.current = undefined
  else if (onlineSince.current === undefined) onlineSince.current = now

  const [decided, setDecided] = useState<'approved' | 'denied'>()
  const [deciding, setDeciding] = useState<string>()
  const onDecide = useCallback(async (id: string, decision: 'approve' | 'deny') => {
    setDeciding(id)
    try {
      await vtaAgent.decide(id, decision)
      setDecided(decision === 'approve' ? 'approved' : 'denied')
    } catch {
      // the failure is recorded on the request itself, by the controller
      setDecided(undefined)
    } finally {
      setDeciding(undefined)
    }
  }, [])

  const view = requestsView({
    link: state.link,
    reconnectGaveUp: state.reconnectGaveUp,
    approvals: state.approvals,
    now,
    onlineSince: onlineSince.current,
    decided,
    linkRestored: state.linkRestored,
  })

  // Whether a screen of this stack is under this one. Not `canGoBack()`: that
  // is true whenever the tabs can go back, and their "back" is the first tab.
  const hasUnder = useCallback(() => Number(navigation.getState()?.index ?? 0) > 0, [navigation])
  const toAgent = useCallback(() => {
    if (hasUnder()) navigation.goBack()
    else navigation.replace(agentHomeScreen(state.link))
  }, [navigation, hasUnder, state.link])
  // Opened by a link there is nothing under this screen: give the header its back.
  useLayoutEffect(() => {
    if (hasUnder()) return
    navigation.setOptions({
      headerLeft: (props: object) => (
        <HeaderBackButton {...props} onPress={toAgent} testID={testIdWithKey('RequestsHeaderBack')} />
      ),
    })
  }, [navigation, toAgent, hasUnder])
  // Not linked: there is nothing to decide; My Agent says what to do.
  useEffect(() => {
    if (view.mode === 'notLinked') navigation.replace(agentHomeScreen(state.link))
  }, [view.mode, navigation, state.link])

  const [retrying, setRetrying] = useState(false)
  const onTryAgain = useCallback(async () => {
    if (!agent) return
    setRetrying(true)
    try {
      await vtaAgent.tryAgainNow(agent)
    } catch {
      // still unreachable: the screen keeps saying so
    } finally {
      setRetrying(false)
    }
  }, [agent])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  const backToAgent = (
    <Button
      title={t('Requests.BackToAgent')}
      buttonType={ButtonType.Secondary}
      onPress={toAgent}
      testID={testIdWithKey('RequestsBackToAgent')}
    />
  )

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('Requests')}>
        {view.decided ? (
          <View style={styles.card} testID={testIdWithKey('RequestsDone')}>
            <ThemedText variant="bold">
              {t(view.decided === 'approved' ? 'Requests.DoneApproved' : 'Requests.DoneDeclined')}
            </ThemedText>
            {view.waiting.length > 0 ? (
              <ThemedText testID={testIdWithKey('RequestsMore')}>
                {t('Requests.More', { count: view.waiting.length })}
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {view.mode === 'loading' ? (
          <View style={[styles.card, styles.row]} testID={testIdWithKey('RequestsLoading')}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={{ flex: 1 }}>{t('Requests.Loading')}</ThemedText>
          </View>
        ) : null}

        {view.mode === 'empty' ? (
          <View style={styles.card} testID={testIdWithKey('RequestsEmpty')}>
            <ThemedText>{t('Requests.Empty')}</ThemedText>
          </View>
        ) : null}
        {/* Nothing has ever arrived: the likely reason is that the agent has no rule to ask about. */}
        {view.mode === 'empty' && state.approvals.length === 0 ? (
          <View style={styles.card} testID={testIdWithKey('RequestsAskMeCard')}>
            <ThemedText style={styles.muted}>{t('Requests.AskMeEmpty')}</ThemedText>
            <Button
              title={t('Requests.AskMeRow')}
              buttonType={ButtonType.Secondary}
              onPress={() => navigation.navigate(Screens.VtaAskMe)}
              testID={testIdWithKey('RequestsAskMe')}
            />
          </View>
        ) : null}

        {view.mode === 'unreachable' ? (
          <View style={styles.card} testID={testIdWithKey('RequestsUnreachable')}>
            <ThemedText>{t('Requests.Unreachable')}</ThemedText>
            <Button
              title={t('Requests.TryAgain')}
              buttonType={ButtonType.Primary}
              disabled={retrying}
              onPress={() => void onTryAgain()}
              testID={testIdWithKey('RequestsTryAgain')}
            />
          </View>
        ) : null}

        {view.waiting.map((approval) => (
          <View key={approval.id} style={styles.card}>
            <RequestCard
              approval={approval}
              shows="waiting"
              busy={deciding !== undefined}
              onDecide={(id, decision) => void onDecide(id, decision)}
            />
          </View>
        ))}

        {view.expired.map((approval) => (
          <View key={approval.id} style={styles.card}>
            <RequestCard approval={approval} shows="expired" busy={false} onDecide={() => undefined} />
          </View>
        ))}

        {view.earlier.length > 0 ? (
          <View style={{ gap: 8 }} testID={testIdWithKey('RequestsEarlier')}>
            <ThemedText variant="labelTitle" style={styles.muted} accessibilityRole="header">
              {t('Requests.Earlier')}
            </ThemedText>
            {view.earlier.map((approval) => (
              <View key={approval.id} style={styles.card}>
                <RequestCard approval={approval} shows="earlier" busy={false} onDecide={() => undefined} />
              </View>
            ))}
          </View>
        ) : null}

        {view.mode === 'waiting' ? null : backToAgent}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaRequests
