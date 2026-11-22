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
import { cardStandingOf, subscribeCardStanding, type CardStanding } from '../module/vtiCardStanding'
import { cardVaultStateOf, subscribeCardVault } from '../module/vtiCardVault'

import { localDate } from './localTime'

/** A card's vault state as one string: what the row's words and icon key on. */
export type CardKeptKey = 'kept' | 'pending' | 'notYetKept' | 'cannotKeep:proofSet' | 'cannotKeep:refusedByAgent'

export function cardKeptKeyOf(credentialId: string): CardKeptKey {
  const s = cardVaultStateOf(credentialId)
  return s.state === 'cannotKeep' ? `cannotKeep:${s.reason}` : s.state
}

export function useCardKept(credentialId: string): CardKeptKey {
  return useSyncExternalStore(subscribeCardVault, () => cardKeptKeyOf(credentialId))
}

/** Whether the card still stands: held, past its end date (expired), or withdrawn (revoked), as last known. */
export function useCardStanding(card: Record<string, unknown>): CardStanding {
  return useSyncExternalStore(subscribeCardStanding, () => cardStandingOf(card))
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
  /** The community's name, for "<community> withdrew this card". */
  community?: string
  /** The membership was ended by the community at this time (#166): the card is history, whatever it says. */
  endedAt?: string
}

/**
 * What the row says of a card, from its standing and whether the membership ended:
 * - `kept`: the card stands; the line says where it is kept.
 * - `renew`: only the card's dates have run out (IN-501). The community's ACL, not the card, says who is a member,
 *   so the membership stands and the card is renewed (vtiCardRenewal): it needs renewing, it has not ended.
 * - `ended` / `withdrawn`: history — the community ended the membership, or withdrew the card.
 */
export type CardRowState =
  | { show: 'kept' }
  | { show: 'renew'; at: string }
  | { show: 'ended'; at: string }
  | { show: 'withdrawn' }

export function cardRowState(standing: CardStanding, endedAt?: string): CardRowState {
  if (endedAt) return { show: 'ended', at: endedAt }
  if (standing.state === 'revoked') return { show: 'withdrawn' }
  if (standing.state === 'expired') return { show: 'renew', at: standing.at }
  return { show: 'kept' }
}

export const CardKeptRow: React.FC<CardKeptRowProps> = ({ card, kind, handle, community, endedAt }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const id = typeof card.id === 'string' ? card.id : ''
  const kept = useCardKept(id)
  const row = cardRowState(useCardStanding(card), endedAt)
  const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  // A card with no id cannot be kept or matched on another phone: say nothing
  // rather than something untrue.
  if (!id) return null
  return (
    <View style={styles.row} testID={testIdWithKey(`AgentCard_${kind}_${handle}`)}>
      <Icon
        name={row.show === 'kept' ? ICON[kept] : row.show === 'renew' ? 'autorenew' : 'history'}
        size={20}
        color={TextTheme.normal.color}
      />
      <View style={{ flex: 1 }}>
        <ThemedText>{t(kind === 'membership' ? 'VtaLink.YourMembershipCard' : 'VtaLink.YourRoleCard')}</ThemedText>
        {row.show === 'kept' ? (
          <ThemedText style={styles.muted} testID={testIdWithKey(`AgentCardKept_${kind}_${handle}`)}>
            {t(CARD_KEPT_WORDS[kept])}
          </ThemedText>
        ) : row.show === 'renew' ? (
          // Still in the Wallet (vtiWalletCards keeps a lapsed card of a membership that stands).
          <ThemedText testID={testIdWithKey(`AgentCardRenew_${kind}_${handle}`)}>
            {t(kind === 'membership' ? 'VtaLink.CardMembershipNeedsRenewing' : 'VtaLink.CardRoleNeedsRenewing', {
              date: localDate(row.at),
            })}
          </ThemedText>
        ) : (
          // No longer in the Wallet (vtiWalletCards shows only cards that
          // stand), so here is where the person sees what happened to it.
          <ThemedText testID={testIdWithKey(`AgentCardHistory_${kind}_${handle}`)}>
            {row.show === 'ended'
              ? t(kind === 'membership' ? 'VtaLink.CardMembershipEnded' : 'VtaLink.CardRoleEnded', {
                  date: localDate(row.at),
                })
              : t('VtaLink.CardWithdrawn', {
                  community: community ?? t('Community.Unnamed'),
                  interpolation: { escapeValue: false },
                })}
          </ThemedText>
        )}
      </View>
    </View>
  )
}
