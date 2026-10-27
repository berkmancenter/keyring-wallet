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
