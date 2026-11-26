/**
 * A room's members (data rooms mock, Members). First the member's own access: what they can do, until when, and as
 * which identity. Below it, the community's list of who it admitted, where the member may see it: a room keeps no
 * member list of its own, so this is the community's record, and only the community adds or removes people. Last,
 * the way out: leaving the community takes the member out of all its rooms, and is done on the community's own
 * screen, where every case of leaving is already handled, rather than by a second, lesser path here.
 *
 * The community's list is read when the tab is first shown, and only where the service says it can be; a refusal
 * (only administrators may see it) is said in the rooms screens' usual words.
 *
 * @module rooms/components/RoomMembersTab
 */
import type { TFunction } from 'i18next'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { localDate } from '../../trust-tasks/screens/localTime'
import type { CommunityRoomMember, Identity, OperationStatus, Room, RoomsService, RoomVerb } from '../types'
import type { MyName } from '../useMyName'

import { roomHandle } from './RoomRow'
import { isComingSoon, RoomFeatureCard } from './RoomFeatureCard'
import { roomsStatusText } from './roomsStatusText'
import { useMemberWords } from './memberWords'
import { accessText, identityText } from './roomWords'

/** A member's role in words, from the most a member's rights allow. */
export const roleText = (t: TFunction, verbs: RoomVerb[]): string => {
  const can = new Set(verbs)
  if (can.has('admin')) return t('Rooms.RoleAdmin') as string
  if (can.has('curate')) return t('Rooms.RoleCurator') as string
  if (can.has('write')) return t('Rooms.RoleMember') as string
  return t('Rooms.RoleReader') as string
}

type Listing = { kind: 'reading' } | { kind: 'read'; members: CommunityRoomMember[] } | { kind: 'failed' }

export interface RoomMembersTabProps {
  service: RoomsService
  room: Room
  status: OperationStatus
  /** Opens the community's screen, where leaving it is done; none where the room's community is not known. */
  onLeave?: () => void
  /** The member's own name, from their profile: shown for them on this phone only. */
  me?: MyName
  /** Opens a member's sheet: their name, where it comes from, and the identity the room sees. */
  onOpenIdentity?: (identity: Identity) => void
}

export const RoomMembersTab: React.FC<RoomMembersTabProps> = ({
  service,
  room,
  status,
  onLeave,
  me,
  onOpenIdentity,
}) => {
  const { t } = useTranslation()
  const memberWords = useMemberWords()
  const { ColorPalette } = useTheme()
  const statusWords = roomsStatusText(t, status, 'listCommunityMembers')
  const [listing, setListing] = useState<Listing>({ kind: 'reading' })
  // A refusal the service gives when asked: its reason, in the same words as a status known beforehand.
  const [refusedWords, setRefusedWords] = useState<string>()
  const { communityDid, roomId } = room

  useEffect(() => {
    if (statusWords || !communityDid) return
    let live = true
    service.listCommunityMembers(communityDid, roomId).then(
      (members) => live && setListing({ kind: 'read', members }),
      (e: unknown) => {
        if (!live) return
        const reason = (e as { name?: string; reason?: OperationStatus['reason'] })?.reason
        if ((e as { name?: string })?.name === 'RoomsUnavailable' && reason)
          setRefusedWords(roomsStatusText(t, { status: 'unavailable', reason, detail: '' }, 'listCommunityMembers'))
        setListing({ kind: 'failed' })
      }
    )
    return () => {
      live = false
    }
  }, [service, communityDid, roomId, statusWords, t])

  const styles = StyleSheet.create({
    content: { padding: 16, gap: 16 },
    card: {
      gap: 10,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    fact: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
    // A least width, not a width: a label longer than its column ("Vous pouvez" at large text) widens it and the value
    // wraps below, rather than the label breaking mid-word.
    label: { minWidth: 84, flexShrink: 0, color: ColorPalette.grayscale.mediumGrey },
    // Narrower than this, a value of a few words stacks one to a line beside its label: it wraps below instead.
    value: { flex: 1, minWidth: 160 },
    unbroken: { minWidth: 220 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    idWords: { flex: 1 },
    unavailable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
  })

  const until = room.validUntil
    ? localDate(room.validUntil)
    : room.source === 'custody'
      ? (t('Rooms.DetailsNotLoaded') as string)
      : (t('Rooms.MembersNoEnd') as string)
  // An identity's short form ("did:webv…expose") has no space to break at, so it splits at its ellipsis: it needs room
  // for one line beside its label, or goes below.
  const fact = (label: string, value: string, testID: string, unbroken = false) => (
    <View style={styles.fact}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <ThemedText style={[styles.value, unbroken ? styles.unbroken : undefined]} testID={testIdWithKey(testID)}>
        {value}
      </ThemedText>
    </View>
  )

  const list = (() => {
    const unavailable = statusWords ?? (room.communityDid ? refusedWords : (t('Rooms.DetailsNotLoaded') as string))
    if (isComingSoon(status)) return <RoomFeatureCard status={status} feature="members" />
    // Calm, as the "Coming soon" cards are, but without their badge: this is not on its way.
    if (unavailable)
      return (
        <View style={styles.unavailable}>
          <Icon name="account-lock-outline" size={20} color={ColorPalette.grayscale.mediumGrey} />
          <ThemedText style={[styles.muted, { flex: 1 }]} testID={testIdWithKey('RoomMembersUnavailable')}>
            {unavailable}
          </ThemedText>
        </View>
      )
    if (listing.kind === 'reading')
      return (
        <ActivityIndicator
          color={ColorPalette.brand.primary}
          accessibilityLabel={t('Rooms.Reading')}
          testID={testIdWithKey('RoomMembersReading')}
        />
      )
    if (listing.kind === 'failed')
      return (
        <ThemedText style={styles.muted} testID={testIdWithKey('RoomMembersFailed')}>
          {t('Rooms.MembersFailed')}
        </ThemedText>
      )
    if (listing.members.length === 0)
      return (
        <ThemedText style={styles.muted} testID={testIdWithKey('RoomMembersNone')}>
          {t('Rooms.MembersNone')}
        </ThemedText>
      )
    return (
      <View testID={testIdWithKey('RoomMembersList')}>
        <ThemedText variant="caption" style={styles.muted}>
          {t('Rooms.MembersFromCommunity', {
            community: room.communityName ?? '',
            count: listing.members.length,
            interpolation: { escapeValue: false },
          })}
        </ThemedText>
        {listing.members.map((member) => {
          const you = member.identity.did === room.actingAs.did
          const words = you ? (me?.name ?? (t('Rooms.You') as string)) : memberWords(member.identity)
          return (
            <Pressable
              key={member.identity.did}
              style={styles.row}
              onPress={onOpenIdentity ? () => onOpenIdentity(member.identity) : undefined}
              disabled={!onOpenIdentity}
              accessibilityRole={onOpenIdentity ? 'button' : undefined}
              accessibilityLabel={`${words}${you && me?.name ? `, ${t('Rooms.You')}` : ''}, ${roleText(t, member.verbs)}`}
              testID={testIdWithKey(`RoomMember_${roomHandle(member.identity.did)}`)}
            >
              <Icon name="account-outline" size={22} color={ColorPalette.brand.primary} />
              <ThemedText style={styles.idWords}>
                {words}
                {you && me?.name ? <ThemedText style={styles.muted}>{` · ${t('Rooms.You')}`}</ThemedText> : null}
              </ThemedText>
              <ThemedText variant="caption" style={styles.muted}>
                {roleText(t, member.verbs)}
              </ThemedText>
            </Pressable>
          )
        })}
      </View>
    )
  })()

  return (
    <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('RoomMembers')}>
      <View style={styles.card} testID={testIdWithKey('RoomMembersYourAccess')}>
        <ThemedText variant="bold" accessibilityRole="header">
          {t('Rooms.MembersYourAccess')}
        </ThemedText>
        {fact(t('Rooms.MembersYouCan'), accessText(t, room), 'RoomMembersYouCan')}
        {fact(t('Rooms.MembersUntil'), until, 'RoomMembersUntil')}
        {fact(t('Rooms.MembersAs'), me?.name ?? identityText(room.actingAs), 'RoomMembersAs', true)}
      </View>
      <View style={{ gap: 6 }}>
        {list}
        <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('RoomMembersCaption')}>
          {t('Rooms.MembersCaption')}
        </ThemedText>
      </View>
      {onLeave && room.communityName ? (
        <View style={{ gap: 6 }}>
          <Button
            title={t('Rooms.MembersLeave', { community: room.communityName, interpolation: { escapeValue: false } })}
            buttonType={ButtonType.Secondary}
            onPress={onLeave}
            testID={testIdWithKey('RoomMembersLeave')}
          />
          <ThemedText variant="caption" style={styles.muted}>
            {t('Rooms.MembersLeaveHint')}
          </ThemedText>
        </View>
      ) : null}
    </ScrollView>
  )
}

export default RoomMembersTab
