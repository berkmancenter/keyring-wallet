/**
 * Which refused posts are offered again and which are said once, with why: a refusal no retry passes (a reason found
 * on this phone that will not pass, or an agent or host refusing as not retryable) stops "Tap to try again". A tester
 * tapped one for an hour on 277.8, each tap refused the same way (11-03).
 */
import type { TFunction } from 'i18next'

import en from '../../../localization/en/en.json'
import { holdsTwoAuthorities, permanentRefusal, postRefusalText, postRefusalWhy } from '../postRefusal'
import { RoomsRefused, RoomsUnavailable } from '../types'

const AGENT_WORDS =
  'the agent would not sign and seal the note as the member: conflict: this VTA holds more than one AuthorityCredential ' +
  'issued by room `did:webvh:QmRoom:first.example:room-dids:9381` to one persona'

// The key, and the reason it was given, so a test reads which words were chosen.
const t = ((key: string, o?: { why?: string }) => (o?.why ? `${key}[${o.why}]` : key)) as unknown as TFunction

describe('which refusals no retry passes', () => {
  test('a reason found on this phone that will not pass', () => {
    expect(permanentRefusal(new RoomsUnavailable('write', 'noRight', 'no write'))).toEqual({ reason: 'noRight' })
    expect(permanentRefusal(new RoomsUnavailable('write', 'tierNotYet', 'sealed'))).toEqual({ reason: 'tierNotYet' })
  })

  test('the agent or the community not reached may pass: offered again (control)', () => {
    expect(permanentRefusal(new RoomsUnavailable('write', 'agentUnknown', 'not asked'))).toBeUndefined()
    expect(permanentRefusal(new RoomsUnavailable('write', 'communityUnreachable', 'no answer'))).toBeUndefined()
  })

  test('a room whose details went missing since it was opened is offered again: its community did not answer, or the session was held', () => {
    expect(permanentRefusal(new RoomsUnavailable('write', 'detailsNotLoaded', 'no host'))).toBeUndefined()
  })

  test('an agent or host refusing as not retryable, with two authority credentials named', () => {
    expect(permanentRefusal(new RoomsRefused('write', 'conflict', false, AGENT_WORDS))).toEqual({
      code: 'conflict',
      twoAuthorities: true,
    })
    expect(permanentRefusal(new RoomsRefused('write', 'forbidden', false, 'refused: forbidden'))).toEqual({
      code: 'forbidden',
      twoAuthorities: false,
    })
  })

  test('a retryable refusal, or no answer at all, is offered again (control)', () => {
    expect(permanentRefusal(new RoomsRefused('write', 'rateLimited', true, 'slow down'))).toBeUndefined()
    expect(permanentRefusal(new Error('agent unreachable'))).toBeUndefined()
  })

  test('two authority credentials are told by the agent’s words, not by a code (conflict is any conflict)', () => {
    expect(holdsTwoAuthorities(AGENT_WORDS)).toBe(true)
    expect(holdsTwoAuthorities('conflict: the note moved on')).toBe(false)
  })
})

describe('what the post says', () => {
  test('no right to write: the room’s own words for it', () => {
    expect(postRefusalText(t, { reason: 'noRight' })).toBe('Rooms.PostNotSentWhy[Rooms.NoRightWrite]')
  })

  test('two authority credentials: says it is fixed at the agent, not here', () => {
    expect(postRefusalText(t, { code: 'conflict', twoAuthorities: true })).toBe(
      'Rooms.PostNotSentWhy[Rooms.PostTwoAuthorities]'
    )
  })

  test('any other refusal: that the room did not take it (control for the line above)', () => {
    expect(postRefusalText(t, { code: 'forbidden', twoAuthorities: false })).toBe(
      'Rooms.PostNotSentWhy[Rooms.PostNotTaken]'
    )
  })
})

describe('in English, as the member reads it', () => {
  const rooms = en.Rooms as Record<string, string>
  const real = ((key: string, o?: { why?: string }) =>
    (rooms[key.replace('Rooms.', '')] ?? key).replace('{{why}}', o?.why ?? '')) as unknown as TFunction
  const refusal = { code: 'conflict', twoAuthorities: true }
  const why =
    "Your agent holds two memberships for this room and won't pick one. This needs fixing at your agent, not here."

  test('the post itself stands alone, so it says "Not sent." and why', () => {
    expect(postRefusalText(real, refusal)).toBe(`Not sent. ${why}`)
  })

  test('a notice has already said it did not send, so it says why alone (control for the line above)', () => {
    expect(postRefusalWhy(real, refusal)).toBe(why)
  })
})
