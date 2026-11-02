/**
 * What an offer calls its community (276.9): a notice read "offered a room in nity-a-vtc." for `…:community-a-vtc`.
 * The service filled a missing name with the DID's last 10 characters; now it leaves it out, and the screens say the
 * app's label for the community.
 */
import i18n from 'i18next'

import en from '../../../localization/en/en.json'
import { offerCommunity, offerCommunityAlone, offerRoom } from '../offerCommunity'
import { offeredWords } from '../roomNotices'
import type { RoomOffer } from '../types'

const COMMUNITY = 'did:webvh:QmScid123:vtc.example:community-a-vtc'
const offer = (communityName?: string): RoomOffer => ({
  offerId: 'offer:1',
  roomId: 'did:webvh:room:planning',
  roomName: 'Planning' as RoomOffer['roomName'],
  communityDid: COMMUNITY,
  ...(communityName ? { communityName: communityName as RoomOffer['communityName'] } : {}),
  tier: 'open',
  verbs: ['read', 'write'],
})

let t: (key: string, options?: object) => string
beforeAll(async () => {
  const i = i18n.createInstance()
  await i.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  t = i.t.bind(i) as typeof t
})

describe('offerCommunity', () => {
  test('a community that published no name is its handle in a sentence: whole, never cut', () => {
    expect(offerCommunity(offer(), t as never)).toBe('community-a-vtc')
  })

  test('standing alone (the offers row, the biometric prompt) it says the community has published no name', () => {
    expect(offerCommunityAlone(offer(), t as never)).toBe('community-a-vtc (no name published yet)')
    expect(offerCommunityAlone(offer('Keyring Lab'), t as never)).toBe('Keyring Lab')
  })

  test('the name the offer came with, when it has one (control)', () => {
    expect(offerCommunity(offer('Keyring Lab'), t as never)).toBe('Keyring Lab')
  })

  test('the notice names it the same way: "You\'ve been offered a room in community-a-vtc."', () => {
    expect(offeredWords([offer()], t as never).text1).toBe("You've been offered a room in community-a-vtc.")
  })
})

describe('offerRoom', () => {
  test('a room the community named none is what tells it apart, said to have no name yet', () => {
    const unnamed = {
      ...offer(),
      roomName: 'community-a-vtc' as RoomOffer['roomName'],
      roomNameFrom: 'roomId' as const,
    }
    expect(offerRoom(unnamed, t as never)).toBe('community-a-vtc (no name published yet)')
  })

  test('a named room is its name (control)', () => {
    expect(offerRoom(offer(), t as never)).toBe('Planning')
  })
})
