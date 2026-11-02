/**
 * Words for a room's people and rights, shared by the room screen's parts. An identity is never a name:
 * the community's words for it when given, else a short form of its DID. A member's rights are said as
 * what they can do; rights not known yet are said as that, never as "no access".
 *
 * @module rooms/components/roomWords
 */
import type { TFunction } from 'i18next'

import type { Identity, RoomSummary } from '../types'

/** "…river-stone", or the DID's last characters when the community gave no words. */
export const identityText = (identity: Identity): string =>
  identity.identityWords ?? `${identity.did.slice(0, 8)}…${identity.did.slice(-6)}`

/**
 * Another member as a person reads them: the member's own name for them when they gave one ("River (named by you)",
 * always marked as theirs), else the name the member wrote on their own directory card ("River (their own name)",
 * marked as theirs, since a self-chosen name can claim anything), else the community's words when given, else
 * "Member …saddle", the DID's last letters so two members without a name can be told apart. The DID itself is kept
 * for the member's sheet.
 */
export const memberText = (t: TFunction, identity: Identity, petname?: string, directoryName?: string): string =>
  petname
    ? (t('Rooms.PetnameLabel', { name: petname, interpolation: { escapeValue: false } }) as string)
    : directoryName
      ? (t('Rooms.DirectoryNameLabel', { name: directoryName, interpolation: { escapeValue: false } }) as string)
      : (identity.identityWords ??
        (t('Rooms.MemberTail', { tail: identity.did.slice(-6), interpolation: { escapeValue: false } }) as string))

/** What this member can do in the room, in one line. */
export const accessText = (t: TFunction, room: Pick<RoomSummary, 'verbs' | 'source'>): string => {
  if (room.source === 'custody' || room.verbs === undefined) return t('Rooms.DetailsNotLoaded') as string
  const can = new Set(room.verbs)
  if (can.has('admin')) return t('Rooms.AccessAdmin') as string
  if (can.has('curate')) return t('Rooms.AccessCurate') as string
  if (can.has('write')) return t('Rooms.AccessWrite') as string
  if (can.has('read')) return t('Rooms.AccessRead') as string
  return t('Rooms.AccessNone') as string
}

const TIER_HINT = {
  open: 'Rooms.TierOpenHint',
  attributed: 'Rooms.TierAttributedHint',
  private: 'Rooms.TierPrivateHint',
} as const

/** Who can read what is posted, for the tier; nothing for a tier not known yet. */
export const tierHint = (t: TFunction, tier: RoomSummary['tier']): string | undefined =>
  tier === 'unknown' ? undefined : (t(TIER_HINT[tier]) as string)
