/**
 * What an offer calls its community and its room.
 *
 * Its community, in a sentence ("You've been offered a room in …", "… offers you a room"): the name it came with,
 * else the app's label for the community in a sentence (`communityLabelOf`): its published name, or its handle. Where
 * the name stands alone, with nothing around it to say the community has published none, {@link offerCommunityAlone}
 * says so: the offers row's "community · Until …" line, and the biometric prompt that confirms an accept. Never a cut
 * of its DID: the offer said "nity-a-vtc" for `…:community-a-vtc` (276.9).
 *
 * @module rooms/offerCommunity
 */
import type { TFunction } from 'i18next'

import { communityLabelAloneOf, communityLabelOf } from '../trust-tasks/screens/communityName'

import { roomTitle } from './components/RoomRow'
import type { RoomOffer } from './types'

export const offerCommunity = (offer: Pick<RoomOffer, 'communityDid' | 'communityName'>, t: TFunction): string =>
  (offer.communityName ? String(offer.communityName) : '') || communityLabelOf(offer.communityDid, t)

/** The same, standing alone: an unnamed community is "<handle> (no name published yet)". */
export const offerCommunityAlone = (offer: Pick<RoomOffer, 'communityDid' | 'communityName'>, t: TFunction): string =>
  (offer.communityName ? String(offer.communityName) : '') || communityLabelAloneOf(offer.communityDid, t)

/** The offered room's name, or what tells it apart, said to be no name (`roomTitle`), as a room's. */
export const offerRoom = (offer: Pick<RoomOffer, 'roomName' | 'roomNameFrom'>, t: TFunction): string =>
  roomTitle(t, { name: offer.roomName, nameFrom: offer.roomNameFrom ?? 'community' })
