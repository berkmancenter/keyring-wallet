/**
 * A community this phone knows only through another agent's identity
 * (Alberto's iPhone, 10-06): he joined with al-phone, unlinked it, and linked
 * al-signer. Your agent rightly no longer listed the community, while its
 * screen still said "You're a member" and offered Leave, which failed with
 * "this phone holds no identity for that community": the identity is
 * al-phone's, and only al-phone's session can speak as it.
 *
 * So the screen says whose it is and offers the way that works: switch to
 * that agent when it is linked, or add it again when it is not. Removing it
 * from this phone stays possible, second, and says it does not leave.
 *
 * @module trust-tasks/screens/HeldByAnotherAgent
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import React, { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { vtaAgent } from '../module/vtaAgent'

import { agentDisplayName, withAgentName } from './agentName'
import { didPathName } from './communityName'

export interface HeldByAnotherAgentProps {
  communityDid: string
  /** The community as the screen names it. */
  community: string
  /** The agent whose identity holds what this phone knows of the community. */
  holderVtaDid: string
}

export const HeldByAnotherAgent: React.FC<HeldByAnotherAgentProps> = ({ communityDid, community, holderVtaDid }) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const navigation = useNavigation()
  const { ColorPalette } = useTheme()
  const state = useSyncExternalStore(vtaAgent.subscribe, vtaAgent.getState)
  const linked = (state.agents ?? []).find((a) => a.vtaDid === holderVtaDid)
  // An agent no longer linked keeps no label here: its DID's last word, when it has one.
  const name = linked
    ? agentDisplayName(withAgentName(linked, state.agentNames), t)
    : (state.agentNames?.[holderVtaDid]?.label ??
      didPathName(holderVtaDid) ??
      (t('VtaLink.YourAgentFallback') as string))
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 10 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const words = { agent: name, community, interpolation: { escapeValue: false } }

  const removeHere = async () => {
    if (!agent) return
    setRemoving(true)
    try {
      const identities = new GenericRecordsIdentityStore(agent)
      const theirs = (await identities.listPersonas()).filter(
        (p) => p.communityDid === communityDid && p.vtaDid === holderVtaDid
      )
      const communities = new GenericRecordsCommunityStore(agent)
      for (const persona of theirs) await communities.forgetCommunity(communityDid, persona.did)
      await identities.forgetPersona(communityDid, holderVtaDid)
      ;(navigation as unknown as { goBack?: () => void }).goBack?.()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <View style={styles.card} testID={testIdWithKey('CommunityHeldElsewhere')}>
      <ThemedText variant="bold" testID={testIdWithKey('CommunityHeldElsewhereText')}>
        {t('Community.HeldElsewhere', words)}
      </ThemedText>
      <ThemedText style={styles.muted}>
        {t(linked ? 'Community.HeldElsewhereLinked' : 'Community.HeldElsewhereUnlinked', words)}
      </ThemedText>
      {linked ? (
        <Button
          title={t('Join.UseAgent', words)}
          buttonType={ButtonType.Primary}
          onPress={() => agent && void vtaAgent.useAgent(agent, holderVtaDid)}
          testID={testIdWithKey('CommunityUseHolderAgent')}
        />
      ) : (
        <Button
          title={t('Community.AddAgentAgain', words)}
          buttonType={ButtonType.Primary}
          onPress={() =>
            void vtaAgent
              .startAddingAgent()
              .then(() => (navigation as unknown as { navigate: (name: string) => void }).navigate(Screens.VtaLink))
          }
          testID={testIdWithKey('CommunityAddHolderAgent')}
        />
      )}
      {confirming ? (
        <View style={{ gap: 8 }} testID={testIdWithKey('CommunityRemoveHereCard')}>
          <ThemedText>{t('Community.RemoveHereWarning', words)}</ThemedText>
          <Button
            title={t('Community.RemoveHereConfirm')}
            buttonType={ButtonType.Critical}
            disabled={removing}
            onPress={() => void removeHere()}
            testID={testIdWithKey('CommunityRemoveHereConfirm')}
          />
          <Button
            title={t('Global.Cancel')}
            buttonType={ButtonType.Secondary}
            onPress={() => setConfirming(false)}
            testID={testIdWithKey('CommunityRemoveHereCancel')}
          />
        </View>
      ) : (
        <Button
          title={t('Community.RemoveHere')}
          buttonType={ButtonType.Tertiary}
          onPress={() => setConfirming(true)}
          testID={testIdWithKey('CommunityRemoveHere')}
        />
      )}
    </View>
  )
}

export default HeldByAnotherAgent
