/**
 * Agent settings — its own screen, opened from the gear in "Your agent"'s
 * header (Alberto, 10-06). What used to unfold under a row at the foot of
 * "Your agent": naming the agent, the other agents and unlinking them, the
 * cards the agent keeps, unlinking this one, what it did lately, and the
 * operator's details. Requests are not here: they are on "Your agent".
 *
 * Test ids are the ones these parts had on "Your agent" (`AgentUnlink`,
 * `AgentUnlinkCard`, `AgentActivity`, `AgentDetailsToggle`, …), so a driver
 * that opens settings first finds them; new: `AgentSettingsScreen`,
 * `AgentNameInput`, `AgentNameSave`, `AgentNameReset`, `AgentOtherRow_<i>`.
 * `AgentSwitcherUnlink_<i>` stays on another agent's Unlink, `<i>` its place
 * among every linked agent as on the chips.
 *
 * @module trust-tasks/screens/VtaAgentSettings
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { AGENT_NICKNAME_MAX, vtaAgent, type VtaActivity } from '../module/vtaAgent'

import { agentDisplayName, withAgentName } from './agentName'
import { GetCardsFromAgent } from './GetCardsFromAgent'
import { shortTask } from './RequestCard'
import { forgetAgentHoldings, ownHoldings } from './VtaAgentHome'
import { useVtaLinkWithClock } from './VtaStatus'

const VtaAgentSettings: React.FC = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const route = useRoute()
  const { ColorPalette, TextTheme } = useTheme()
  const { state } = useVtaLinkWithClock()
  const { link } = state
  const linkedDid = link.kind === 'linked' ? link.vtaDid : undefined
  // "Link a new agent" on a gone agent opens this screen at its unlink.
  const askedToUnlink = Boolean((route.params as { unlink?: boolean } | undefined)?.unlink)
  const [unlinkOpen, setUnlinkOpen] = useState(askedToUnlink)
  const [unlinkTarget, setUnlinkTarget] = useState<string>()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [personas, setPersonas] = useState<VtiPersona[]>()
  const scrollRef = useRef<ScrollView>(null)

  const currentName = link.kind === 'linked' ? state.agentNames?.[link.vtaDid] : undefined
  const [nameDraft, setNameDraft] = useState(currentName?.source === 'nickname' ? currentName.label : '')
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    if (!agent) return
    let live = true
    void new GenericRecordsIdentityStore(agent)
      .listPersonas()
      .then((all) => live && setPersonas(ownHoldings(all, [], linkedDid).personas))
      .catch(() => live && setPersonas([]))
    return () => {
      live = false
    }
  }, [agent, linkedDid])

  // The card opens at the foot of the screen: bring it into view.
  useEffect(() => {
    if (!unlinkOpen) return
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(timer)
  }, [unlinkOpen])

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    mono: { ...TextTheme.normal, fontFamily: 'Menlo', fontSize: 12 },
    link: { color: ColorPalette.brand.link, textDecorationLine: 'underline' },
    input: {
      ...TextTheme.normal,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: TextTheme.normal.color,
    },
  })

  const go = (screen: Screens) => (navigation as unknown as { navigate: (name: string) => void }).navigate(screen)

  if (link.kind !== 'linked') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <View style={styles.content} testID={testIdWithKey('AgentSettingsScreen')}>
          <ThemedText>{t('VtaLink.NothingToLink')}</ThemedText>
        </View>
      </SafeAreaView>
    )
  }

  const agents = state.agents?.length ? state.agents : [{ vtaDid: link.vtaDid, label: link.label }]
  const nameOf = (vtaDid: string) =>
    agentDisplayName(withAgentName(agents.find((a) => a.vtaDid === vtaDid) ?? { vtaDid }, state.agentNames), t)
  const thisName = agentDisplayName(withAgentName(link, state.agentNames), t)
  const otherAgents = agents.map((a, i) => ({ ...a, i })).filter((a) => a.vtaDid !== link.vtaDid)
  const activityText = (a: VtaActivity) => t(`VtaLink.Activity.${a.kind}`)

  const saveName = async (name: string) => {
    if (!agent) return
    setSavingName(true)
    try {
      await vtaAgent.nameAgent(agent, link.vtaDid, name)
      setNameDraft(name.trim())
    } finally {
      setSavingName(false)
    }
  }

  // Unlinking is local: this phone forgets the agent and its own key for it.
  // The agent keeps the key on its list until its owner removes it — a client
  // cannot remove its own entry (VTI-Q23) — and the confirmation says so.
  const unlink = () => {
    if (!agent) return
    setUnlinkOpen(false)
    forgetAgentHoldings()
    void vtaAgent.unlink(agent).then(() => go(Screens.VtaLink))
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} testID={testIdWithKey('AgentSettingsScreen')}>
        {/* What to call it on this phone: an agent made with pnm gives no name. */}
        <View style={styles.card} testID={testIdWithKey('AgentNameCard')}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('VtaLink.NameAgent')}
          </ThemedText>
          <ThemedText style={styles.muted}>{t('VtaLink.NameAgentHint')}</ThemedText>
          <TextInput
            style={styles.input}
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder={thisName}
            placeholderTextColor={ColorPalette.grayscale.mediumGrey}
            maxLength={AGENT_NICKNAME_MAX}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => void saveName(nameDraft)}
            accessibilityLabel={t('VtaLink.NameAgent')}
            testID={testIdWithKey('AgentNameInput')}
          />
          <Button
            title={t('VtaLink.NameAgentSave')}
            buttonType={ButtonType.Primary}
            disabled={savingName || !nameDraft.trim() || nameDraft.trim() === currentName?.label}
            onPress={() => void saveName(nameDraft)}
            testID={testIdWithKey('AgentNameSave')}
          />
          {currentName?.source === 'nickname' ? (
            <Pressable
              onPress={() => void saveName('')}
              accessibilityRole="button"
              style={styles.row}
              testID={testIdWithKey('AgentNameReset')}
            >
              <ThemedText style={styles.link}>{t('VtaLink.NameAgentReset')}</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {/* The other agents: unlinked from here; switched to from the chips. */}
        {otherAgents.length > 0 ? (
          <View style={styles.card} testID={testIdWithKey('AgentOthers')}>
            <ThemedText variant="labelTitle" accessibilityRole="header">
              {t('VtaLink.OtherAgents')}
            </ThemedText>
            <ThemedText style={styles.muted}>{t('VtaLink.SwitcherOnlyCurrent')}</ThemedText>
            {otherAgents.map((a) => (
              <View key={a.vtaDid} style={styles.row} testID={testIdWithKey(`AgentOtherRow_${a.i}`)}>
                <ThemedText variant="bold" style={{ flex: 1 }}>
                  {nameOf(a.vtaDid)}
                </ThemedText>
                <Pressable
                  onPress={() => setUnlinkTarget(a.vtaDid)}
                  accessibilityRole="button"
                  accessibilityLabel={t('VtaLink.UnlinkTitle', {
                    agent: nameOf(a.vtaDid),
                    interpolation: { escapeValue: false },
                  })}
                  hitSlop={8}
                  testID={testIdWithKey(`AgentSwitcherUnlink_${a.i}`)}
                >
                  <ThemedText style={styles.link}>{t('VtaLink.UnlinkConfirm')}</ThemedText>
                </Pressable>
              </View>
            ))}
            {unlinkTarget ? (
              <View style={{ gap: 8 }} testID={testIdWithKey('AgentUnlinkOtherCard')}>
                <ThemedText variant="labelTitle" accessibilityRole="header">
                  {t('VtaLink.UnlinkTitle', { agent: nameOf(unlinkTarget), interpolation: { escapeValue: false } })}
                </ThemedText>
                <ThemedText>
                  {t('VtaLink.UnlinkOtherBody', { agent: nameOf(unlinkTarget), interpolation: { escapeValue: false } })}
                </ThemedText>
                <Button
                  title={t('VtaLink.UnlinkConfirm')}
                  buttonType={ButtonType.Critical}
                  onPress={() => {
                    const target = unlinkTarget
                    setUnlinkTarget(undefined)
                    if (agent && target) void vtaAgent.unlinkAgent(agent, target)
                  }}
                  testID={testIdWithKey('AgentUnlinkOtherConfirm')}
                />
                <Button
                  title={t('Global.Cancel')}
                  buttonType={ButtonType.Secondary}
                  onPress={() => setUnlinkTarget(undefined)}
                  testID={testIdWithKey('AgentUnlinkOtherCancel')}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* A task of this phone's that waits on someone else's consent: not a
            decision for this person, so it is not under Requests. */}
        {state.awaitingConsentFor ? (
          <View style={[styles.card, styles.row]}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <ThemedText style={{ flex: 1 }} testID={testIdWithKey('AgentAwaitingConsent')}>
              {t('MyAgent.AwaitingConsent', {
                task: shortTask(state.awaitingConsentFor),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
          </View>
        ) : null}

        {/* The cards the agent keeps, back on this phone (226). */}
        {agent && personas ? <GetCardsFromAgent agent={agent} personas={personas} /> : null}

        <View style={styles.card} testID={testIdWithKey('AgentActivity')}>
          <ThemedText variant="labelTitle">{t('VtaLink.Did')}</ThemedText>
          {state.activity.length === 0 ? (
            <ThemedText style={styles.muted}>{t('VtaLink.DidNothing')}</ThemedText>
          ) : (
            state.activity.slice(0, 6).map((a) => (
              <ThemedText key={`${a.at}-${a.kind}`}>
                {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {activityText(a)}
              </ThemedText>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Pressable
            style={styles.row}
            onPress={() => setDetailsOpen(!detailsOpen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            testID={testIdWithKey('AgentDetailsToggle')}
          >
            <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={20} color={TextTheme.normal.color} />
            <ThemedText variant="labelTitle">{t('VtaLink.Details')}</ThemedText>
          </Pressable>
          {detailsOpen ? (
            <View testID={testIdWithKey('AgentDetails')}>
              <ThemedText style={styles.muted}>{t('VtaLink.DetailsAgent')}</ThemedText>
              <ThemedText style={styles.mono} selectable>
                {link.vtaDid}
              </ThemedText>
              <ThemedText style={styles.muted}>{t('VtaLink.DetailsPhoneKey')}</ThemedText>
              <ThemedText style={styles.mono} selectable>
                {state.managerDid ?? '—'}
              </ThemedText>
              <ThemedText style={styles.muted}>{t('VtaLink.DetailsLinkedAt')}</ThemedText>
              <ThemedText>{new Date(link.linkedAt).toLocaleString()}</ThemedText>
            </View>
          ) : null}
        </View>

        <Button
          title={t('VtaLink.Unlink')}
          buttonType={ButtonType.Tertiary}
          onPress={() => setUnlinkOpen(true)}
          testID={testIdWithKey('AgentUnlink')}
        />
        {unlinkOpen ? (
          <View style={styles.card} testID={testIdWithKey('AgentUnlinkCard')}>
            <ThemedText variant="labelTitle" accessibilityRole="header" testID={testIdWithKey('AgentUnlinkTitle')}>
              {t('VtaLink.UnlinkTitle', { agent: thisName, interpolation: { escapeValue: false } })}
            </ThemedText>
            <ThemedText testID={testIdWithKey('AgentUnlinkBody')}>
              {t(link.connection.kind === 'gone' ? 'VtaLink.UnlinkBodyGone' : 'VtaLink.UnlinkBody')}
            </ThemedText>
            {otherAgents.length > 0 ? (
              <ThemedText testID={testIdWithKey('AgentUnlinkNext')}>
                {t('VtaLink.UnlinkNext', {
                  agent: nameOf(otherAgents[0].vtaDid),
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            ) : null}
            <Button
              title={t('VtaLink.UnlinkConfirm')}
              buttonType={ButtonType.Critical}
              onPress={unlink}
              testID={testIdWithKey('AgentUnlinkConfirm')}
            />
            <Button
              title={t('Global.Cancel')}
              buttonType={ButtonType.Secondary}
              onPress={() => setUnlinkOpen(false)}
              testID={testIdWithKey('AgentUnlinkCancel')}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtaAgentSettings
