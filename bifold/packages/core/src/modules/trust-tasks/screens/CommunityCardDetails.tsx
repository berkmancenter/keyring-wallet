/**
 * The foot of a community card's Details in the Wallet (226): where the card is
 * kept, and — in place of "Remove" — the way to the community.
 *
 * The Wallet's copy of a community card is derived from the community store
 * (vtiWalletCards): deleting the copy would be undone at the next reconcile,
 * and the card would still be held. Giving a card up is leaving the community,
 * which the community's own screen does (with its confirmation and the
 * community told), so the card says so and opens it.
 *
 * @module trust-tasks/screens/CommunityCardDetails
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens, Stacks, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { classifyCredential } from '../module/vtiInbox'
import { isCommunityCard } from '../module/vtiWalletCards'

import { CardKeptRow } from './CardKeptRow'
import { communityCardKey } from './CommunityCard'
import { communityHeadingOf } from './communityName'

/** The community a Wallet credential is a card of, or undefined for any other credential. */
export function communityCardOf(vc: unknown): { communityDid: string; kind: string } | undefined {
  if (!vc || typeof vc !== 'object') return undefined
  const json = vc as Record<string, unknown>
  if (!isCommunityCard(json)) return undefined
  const { communityDid, kind } = classifyCredential(json)
  return communityDid ? { communityDid, kind } : undefined
}

type Navigate = { navigate: (name: string, params?: object) => void }

/**
 * Open a community's screen from anywhere, through the tabs (as links do).
 * `initial: false` keeps the My Agent stack's own first screen ("Your agent")
 * under it: without it the community screen became the stack's only route, and
 * the My Agent tab was stuck there with no way back (226 candidate 3, a device).
 */
export const openCommunityFrom = (navigation: unknown, communityDid: string): void =>
  (navigation as Navigate).navigate(Stacks.TabStack, {
    screen: TabStacks.MyAgentStack,
    params: { screen: Screens.VtiCommunity, params: { communityDid }, initial: false },
  })

export const CommunityCardDetails: React.FC<{
  card: Record<string, unknown>
  onOpenCommunity: (did: string) => void
}> = ({ card, onOpenCommunity }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const of = communityCardOf(card)
  if (!of) return null
  const community = communityHeadingOf(of.communityDid, t, { claim: 'plain' })
  const handle = communityCardKey(of.communityDid)
  const styles = StyleSheet.create({
    box: { backgroundColor: ColorPalette.brand.secondaryBackground, padding: 16, gap: 12, marginTop: 16 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.box} testID={testIdWithKey('CommunityCardDetails')}>
      <CardKeptRow
        card={card}
        kind={of.kind === 'membership' ? 'membership' : 'role'}
        handle={handle}
        community={community}
      />
      <ThemedText style={styles.muted} testID={testIdWithKey('CommunityCardFrom')}>
        {t('Community.CardFromCommunity', { community, interpolation: { escapeValue: false } })}
      </ThemedText>
      <Button
        title={t('Community.CardOpenCommunity', { community, interpolation: { escapeValue: false } })}
        buttonType={ButtonType.Secondary}
        onPress={() => onOpenCommunity(of.communityDid)}
        testID={testIdWithKey('CommunityCardOpenCommunity')}
      />
    </View>
  )
}
