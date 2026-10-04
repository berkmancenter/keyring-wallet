/**
 * One community on "Your agent" (IN-20c): its name, where this phone stands
 * with it, what the agent holds for it, and at most one filled button — the
 * next step. Tapping the name opens the community.
 *
 * @module trust-tasks/screens/CommunityCard
 */

import type { Agent } from '@credo-ts/core'
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { useCommunityJourney } from '../module/communityJourney'
import { isCurrentMembership, type VtiMembership } from '../module/VtiCommunityStore'
import { vtiAgent } from '../module/vtiAgent'
import type { VtiPersona } from '../module/VtiIdentityStore'

import { CardKeptRow } from './CardKeptRow'
import { communityCardModel, type CommunityCardPrimary } from './communityCardModel'
import { asTitle, communityHeadingOf } from './communityName'
import { shareIdentity } from './identityShare'
import { didHashKey, didLabelKey } from './testIdKey'
import { localDate } from './localTime'

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
  /** When this phone was linked to the agent, to mark what the agent held before it. */
  linkedAt?: string
  onOpen: (communityDid: string) => void
  onPrimary: (action: CommunityCardPrimary, communityDid: string) => void
  /** Told the card's next step whenever it changes, so "Your agent" can lead with it. */
  onNextStep?: (communityDid: string, primary: CommunityCardPrimary | undefined) => void
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
  linkedAt,
  onOpen,
  onPrimary,
  onNextStep,
}) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  // The shared session already signed in as this card's identity can ask the
  // community where its request stands at no cost, so this card asks on focus.
  // Any other open request is asked about when the person says so ("Check
  // now"): asking signs the shared session in as that identity. A community
  // pushes no refusal, so this is how one is learned off the Join screen (#269).
  const sharedDid = useSyncExternalStore(vtiAgent.subscribe, () => vtiAgent.getState().did)
  const heldByShared = Boolean(persona && sharedDid === persona.did)
  const { journey, check } = useCommunityJourney(agent, communityDid, { poll: heldByShared })
  const [checking, setChecking] = useState(false)
  // Until the journey is read, a held membership already says "member".
  // A membership the community removed says so from the start (#166).
  const removal = membership && !isCurrentMembership(membership) ? membership.removal : undefined
  const join =
    journey?.join ??
    (membership
      ? removal
        ? { kind: 'removed' as const, membership, at: removal.decidedAt }
        : { kind: 'member' as const, membership }
      : undefined)
  const model = communityCardModel({ join, hasIdentity: !!persona, invited, vetter })
  const key = communityCardKey(communityDid)
  useEffect(() => {
    onNextStep?.(communityDid, model.primary)
  }, [onNextStep, communityDid, model.primary])
  // Named, or at least told apart from the other cards — never a host.
  const community = communityHeadingOf(communityDid, t)
  const words = (k: string) => t(k, { community, interpolation: { escapeValue: false } })
  // "You're a member of X (not confirmed by the community)" read as if the
  // membership were unconfirmed; the community issued it, so the status line
  // names it plainly. The heading above still says where the name came from.
  const status = t(model.statusKey, {
    community:
      model.statusKey === 'Join.StandingMember' ? communityHeadingOf(communityDid, t, { claim: 'plain' }) : community,
    interpolation: { escapeValue: false },
  })
  // A membership the agent held before this phone was linked to it came with
  // the agent, not from anything done on this phone.
  const heldBeforeLink = !!membership && !!linkedAt && Date.parse(membership.grantedAt) < Date.parse(linkedAt)

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
          <ThemedText variant="bold" testID={testIdWithKey(`AgentCommunityName_${key}`)}>
            {asTitle(community)}
          </ThemedText>
          <ThemedText style={styles.muted} testID={testIdWithKey(`AgentCommunityStatus_${key}`)}>
            {status}
            {vetter && membership && !removal ? ` · ${t('Vetting.SeatVetter')}` : ''}
          </ThemedText>
        </View>
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
      {(join?.kind === 'sent' || join?.kind === 'pending' || join?.kind === 'deferred') && !heldByShared ? (
        <Pressable
          style={styles.row}
          disabled={checking}
          onPress={() => {
            setChecking(true)
            void check().finally(() => setChecking(false))
          }}
          accessibilityRole="button"
          testID={testIdWithKey(`AgentCommunityCheck_${key}`)}
        >
          <Icon name="refresh" size={18} color={ColorPalette.brand.link} />
          <ThemedText style={{ color: ColorPalette.brand.link }}>
            {t(checking ? 'Join.Checking' : 'Join.CheckNow')}
          </ThemedText>
        </Pressable>
      ) : null}

      {/* What the agent holds for this community, under it. */}
      {membership ? (
        <View style={styles.row}>
          <Icon name="card-account-details-outline" size={20} color={TextTheme.normal.color} />
          <View style={{ flex: 1 }}>
            {removal ? (
              // Ended by the community: when, and its reason when it gave one.
              <ThemedText testID={testIdWithKey(`AgentMembershipEnded_${key}`)}>
                {t('VtaLink.CardMembershipEnded', { date: localDate(removal.decidedAt) })}
                {removal.reason
                  ? ` ${t('Community.RemovedReason', { reason: removal.reason, interpolation: { escapeValue: false } })}`
                  : ''}
              </ThemedText>
            ) : (
              <ThemedText testID={testIdWithKey(`AgentMemberSince_${key}`)}>
                {t('MyAgent.MemberSince', { date: localDate(membership.grantedAt) })}
              </ThemedText>
            )}
            {heldBeforeLink && !removal ? (
              <ThemedText style={styles.muted} testID={testIdWithKey(`AgentMemberBeforeLink_${key}`)}>
                {t('MyAgent.MemberBeforeLink')}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : null}
      {/* The cards themselves, and whether the agent keeps them (226). */}
      {membership?.vmc ? (
        <CardKeptRow
          card={membership.vmc}
          kind="membership"
          handle={key}
          community={community}
          endedAt={removal?.decidedAt}
        />
      ) : null}
      {membership?.roleVec ? (
        <CardKeptRow
          card={membership.roleVec}
          kind="role"
          handle={key}
          community={community}
          endedAt={removal?.decidedAt}
        />
      ) : null}
      {persona ? (
        <View style={styles.row}>
          <Icon name="account-circle-outline" size={20} color={TextTheme.normal.color} />
          {/* The status line may already say "Your identity for X"; then this
              row says what the identity is for rather than saying it twice. */}
          <ThemedText style={{ flex: 1 }}>
            {model.statusKey === 'VtaLink.IdentityFor' ? t('VtaLink.IdentityShareRow') : words('VtaLink.IdentityFor')}
          </ThemedText>
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
