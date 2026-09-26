/**
 * One community on "Your agent" (IN-20c): its name, where this phone stands
 * with it, what the agent holds for it, and at most one filled button — the
 * next step. Tapping the name opens the community.
 *
 * @module trust-tasks/screens/CommunityCard
 */

import type { Agent } from '@credo-ts/core'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { useCommunityJourney } from '../module/communityJourney'
import type { VtiMembership } from '../module/VtiCommunityStore'
import type { VtiPersona } from '../module/VtiIdentityStore'

import { communityCardModel, type CommunityCardPrimary } from './communityCardModel'
import { communityLabelOf } from './communityName'
import { shareIdentity } from './identityShare'
import { didHashKey, didLabelKey } from './testIdKey'

/**
 * A card's handle for tests and runners: `<label>-<hash>`, where the label is
 * {@link didLabelKey} (for reading only) and the hash {@link didHashKey} of the
 * whole DID; just the hash when the label is empty. Not the DID's tail: two
 * communities on one host share it.
 */
export const communityCardKey = (communityDid: string): string => {
  const label = didLabelKey(communityDid)
  const hash = didHashKey(communityDid)
  return label ? `${label}-${hash}` : hash
}

export interface CommunityCardProps {
  agent?: Agent
  communityDid: string
  persona?: VtiPersona
  membership?: VtiMembership
  invited: boolean
  vetter: boolean
  onOpen: (communityDid: string) => void
  onPrimary: (action: CommunityCardPrimary, communityDid: string) => void
}

const primaryLabel: Record<CommunityCardPrimary, string> = {
  openDesk: 'VtaLink.OpenDesk',
  continueVetting: 'VtaLink.ContinueVetting',
  acceptInvitation: 'MyAgent.Join',
}

export const CommunityCard: React.FC<CommunityCardProps> = ({
  agent,
  communityDid,
  persona,
  membership,
  invited,
  vetter,
  onOpen,
  onPrimary,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { journey } = useCommunityJourney(agent, communityDid)
  // Until the journey is read, a held membership already says "member".
  const join = journey?.join ?? (membership ? { kind: 'member' as const, membership } : undefined)
  const model = communityCardModel({ join, hasIdentity: !!persona, invited, vetter })
  const key = communityCardKey(communityDid)
  const community = communityLabelOf(communityDid, t)
  const words = (k: string) => t(k, { community, interpolation: { escapeValue: false } })

  const styles = StyleSheet.create({
    card: { gap: 8, paddingVertical: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  return (
    <View style={styles.card} testID={testIdWithKey(`AgentCommunityCard_${key}`)}>
      <Pressable
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={words('VtaLink.MemberOf')}
        // Kept for the runners that open a member's community from this row.
        testID={testIdWithKey(membership ? 'AgentMembershipRow' : `AgentCommunityOpen_${key}`)}
        onPress={() => onOpen(communityDid)}
      >
        <Icon name="account-group-outline" size={22} color={TextTheme.normal.color} />
        <View style={{ flex: 1 }}>
          <ThemedText variant="bold">{community}</ThemedText>
          <ThemedText style={styles.muted} testID={testIdWithKey(`AgentCommunityStatus_${key}`)}>
            {words(model.statusKey)}
            {vetter && membership ? ` · ${t('Vetting.SeatVetter')}` : ''}
          </ThemedText>
        </View>
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>

      {/* What the agent holds for this community, under it. */}
      {membership ? (
        <View style={styles.row}>
          <Icon name="card-account-details-outline" size={20} color={TextTheme.normal.color} />
          <ThemedText style={{ flex: 1 }}>
            {t('MyAgent.MemberSince', { date: membership.grantedAt.slice(0, 10) })}
          </ThemedText>
        </View>
      ) : null}
      {persona ? (
        <View style={styles.row}>
          <Icon name="account-circle-outline" size={20} color={TextTheme.normal.color} />
          <ThemedText style={{ flex: 1 }}>{words('VtaLink.IdentityFor')}</ThemedText>
          {/* The admin needs this identity to invite it (TestFlight report #3). */}
          <Pressable
            onPress={() => void shareIdentity(t, communityDid, persona.did)}
            accessibilityRole="button"
            accessibilityLabel={words('VtaLink.ShareIdentity')}
            hitSlop={12}
            testID={testIdWithKey('AgentShareIdentity')}
          >
            <Icon name="share-variant" size={22} color={ColorPalette.brand.link} />
          </Pressable>
        </View>
      ) : null}

      {model.primary ? (
        <Button
          title={t(primaryLabel[model.primary])}
          buttonType={ButtonType.Primary}
          onPress={() => onPrimary(model.primary!, communityDid)}
          testID={testIdWithKey(`AgentCommunityPrimary_${key}`)}
        />
      ) : null}
    </View>
  )
}

export default CommunityCard
