/**
 * One of a community's cards on its "Your agent" card — the membership card,
 * the role card — and where it is kept: by the person's agent, on its way
 * there, or on this phone only, and why (226, agent-kept cards).
 *
 * @module trust-tasks/screens/CardKeptRow
 */

import React, { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { cardVaultStateOf, subscribeCardVault } from '../module/vtiCardVault'

/** A card's vault state as one string: what the row's words and icon key on. */
export type CardKeptKey = 'kept' | 'pending' | 'notYetKept' | 'cannotKeep:proofSet' | 'cannotKeep:refusedByAgent'

export function cardKeptKeyOf(credentialId: string): CardKeptKey {
  const s = cardVaultStateOf(credentialId)
  return s.state === 'cannotKeep' ? `cannotKeep:${s.reason}` : s.state
}

export function useCardKept(credentialId: string): CardKeptKey {
  return useSyncExternalStore(subscribeCardVault, () => cardKeptKeyOf(credentialId))
}

/** What the person reads for each state. */
export const CARD_KEPT_WORDS: Record<CardKeptKey, string> = {
  kept: 'VtaLink.CardKept',
  pending: 'VtaLink.CardSaving',
  notYetKept: 'VtaLink.CardNotYetKept',
  'cannotKeep:proofSet': 'VtaLink.CardPhoneOnlyProofSet',
  'cannotKeep:refusedByAgent': 'VtaLink.CardPhoneOnlyRefused',
}

const ICON: Record<CardKeptKey, string> = {
  kept: 'cloud-check-outline',
  pending: 'cloud-upload-outline',
  notYetKept: 'cloud-outline',
  'cannotKeep:proofSet': 'cellphone',
  'cannotKeep:refusedByAgent': 'cellphone',
}

export interface CardKeptRowProps {
  /** The card itself (its `id` is the key the vault state is kept under). */
  card: Record<string, unknown>
  kind: 'membership' | 'role'
  /** The card's testID handle (communityCardKey). */
  handle: string
}

export const CardKeptRow: React.FC<CardKeptRowProps> = ({ card, kind, handle }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const id = typeof card.id === 'string' ? card.id : ''
  const kept = useCardKept(id)
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  // A card with no id cannot be kept or matched on another phone: say nothing
  // rather than something untrue.
  if (!id) return null
  return (
    <View style={styles.row} testID={testIdWithKey(`AgentCard_${kind}_${handle}`)}>
      <Icon name={ICON[kept]} size={20} color={TextTheme.normal.color} />
      <View style={{ flex: 1 }}>
        <ThemedText>{t(kind === 'membership' ? 'VtaLink.YourMembershipCard' : 'VtaLink.YourRoleCard')}</ThemedText>
        <ThemedText style={styles.muted} testID={testIdWithKey(`AgentCardKept_${kind}_${handle}`)}>
          {t(CARD_KEPT_WORDS[kept])}
        </ThemedText>
      </View>
    </View>
  )
}
