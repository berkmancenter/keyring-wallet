/**
 * The Wallet's badge card (docs/plans/member-badges-plan.md, Wallet): what its face and details say, where its picture
 * comes from (the member's own community, by digest, never a URL), and the kill.
 *
 * The view is built by hand in the shape of `badgeCardView` (trust-tasks/module/badgeCredentials, the credential
 * lane's), from upstream's credential (VTI vtc-service `badges/credential.rs`); the service is the badges client's fake.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'

import { BasicAppContext } from '../../../../../__tests__/helpers/app'
import en from '../../../../localization/en/en.json'
import fr from '../../../../localization/fr/fr.json'
import ptBr from '../../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../../utils/testable'
import type { BadgeCardView } from '../../../trust-tasks/module/badgeCredentials'
import { communityTarget } from '../../../trust-tasks/module/vtiCommunityLink'
import { unnamedRef } from '../../../trust-tasks/screens/communityName'
import { localDate } from '../../../trust-tasks/screens/localTime'
import { MEMBER_BADGES } from '../../badgesSwitch'
import { createFakeBadgeService } from '../../fakeBadgeService'
import type { BadgeService } from '../../types'
import { resetBadgeService, setBadgeServiceForTests } from '../../useBadges'
import BadgeCardDetails from '../BadgeCardDetails'
import BadgeCardPass from '../BadgeCardPass'
import { badgeCardFace, earnedDatesOf } from '../badgeCardFace'

jest.mock('react-native-localize', () => {})

const id = testIdWithKey
const COMMUNITY = 'did:webvh:QmScid:example.org:communities:makers'
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const SHA = 'b'.repeat(64)

type View = BadgeCardView
const badge = (over: Partial<View> = {}): View => ({
  badgeKey: `${COMMUNITY}|urn:vtc:badge:bdg_helper`,
  achievementId: 'urn:vtc:badge:bdg_helper',
  name: 'Helper',
  description: 'Answered a newcomer’s question.',
  communityDid: COMMUNITY,
  communityName: 'Makers',
  issuedAt: '2026-11-10T12:00:00Z',
  validUntil: '2027-11-10T12:00:00Z',
  evidence: [{ note: 'Thanks for the help at the meetup.', acceptedAt: '2026-11-10T12:00:00Z' }],
  badgeId: 'bdg_helper',
  imageSha256: SHA,
  ...over,
})

/** The fake service, with each call counted. */
function service(over: Partial<BadgeService> = {}) {
  const fake = { ...createFakeBadgeService(), ...over }
  const show = jest.spyOn(fake, 'show')
  const image = jest.spyOn(fake, 'image').mockImplementation(over.image ?? (async () => PIXEL))
  setBadgeServiceForTests(fake)
  return { show, image }
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
  })
async function card(view: View) {
  const tree = render(
    <BasicAppContext>
      <BadgeCardPass view={view} />
    </BasicAppContext>
  )
  await settle()
  return tree
}
const text = (tree: ReturnType<typeof render>, testID: string) =>
  [tree.getByTestId(testID).props.children].flat().join('')

beforeEach(() => {
  MEMBER_BADGES.on = true
  MEMBER_BADGES.remoteOff = false
})
afterEach(() => {
  resetBadgeService()
  MEMBER_BADGES.on = true
  MEMBER_BADGES.remoteOff = false
  jest.restoreAllMocks()
})

/** A `t` that says what it was asked: the key and its values, as the real one would interpolate them. */
const t = ((key: string, options: Record<string, unknown> = {}) => {
  const { interpolation: _i, ...values } = options
  return Object.keys(values).length ? `${key} ${JSON.stringify(values)}` : key
}) as unknown as TFunction

describe('the face', () => {
  it('says its name, the community as giver, and when it was earned', () => {
    const face = badgeCardFace(badge(), t)
    expect(face.name).toBe('Helper')
    expect(face.community).toBe('Makers')
    expect(face.from).toBe('BadgeCard.From {"community":"Makers"}')
    expect(face.earned).toBe(`BadgeCard.Earned {"date":"${localDate('2026-11-10T12:00:00Z')}"}`)
    expect(face.validUntil).toBe(localDate('2027-11-10T12:00:00Z'))
    expect(face.accessibilityLabel).toBe(['BadgeCard.Kind', 'Helper', face.from, face.earned].join(', '))
  })

  it("names the giver by the credential's issuer, else the name the community published, else its handle", () => {
    expect(badgeCardFace(badge(), t, 'Makers Guild').community).toBe('Makers')
    expect(badgeCardFace(badge({ communityName: undefined }), t, 'Makers Guild').community).toBe('Makers Guild')
    expect(badgeCardFace(badge({ communityName: '  ' }), t, ' ').community).toBe(unnamedRef(COMMUNITY))
  })

  it('says how many times when there are several awards, and lists each, latest first', () => {
    const face = badgeCardFace(
      badge({ evidence: [{ acceptedAt: '2026-10-01T09:00:00Z' }, { acceptedAt: '2026-11-12T09:00:00Z' }] }),
      t
    )
    expect(face.earned).toBe('BadgeCard.EarnedTimes {"count":2}')
    expect(face.earnedDates).toEqual([localDate('2026-11-12T09:00:00Z'), localDate('2026-10-01T09:00:00Z')])
  })

  it('falls back to the issue date when no award says when it was accepted, and says nothing without either', () => {
    expect(earnedDatesOf(badge({ evidence: [{ note: 'x' }] }))).toEqual(['2026-11-10T12:00:00Z'])
    const none = badgeCardFace(badge({ evidence: [], issuedAt: undefined, validUntil: 'not a date' }), t)
    expect(none.earned).toBeUndefined()
    expect(none.validUntil).toBeUndefined()
  })

  it('on the card: Badge, the name, the giver line and the earned line', async () => {
    service()
    jest.spyOn(communityTarget, 'publishedNameOf').mockReturnValue(undefined)
    const tree = await card(badge())
    expect(tree.getByText('BadgeCard.Kind')).toBeTruthy()
    expect(text(tree, id('BadgeCardName'))).toBe('Helper')
    expect(text(tree, id('BadgeCardFrom'))).toBe('BadgeCard.From')
    expect(text(tree, id('BadgeCardEarned'))).toBe('BadgeCard.Earned')
  })
})

describe('the picture', () => {
  it("is asked of the badge's community by the digest the credential names, once, and drawn", async () => {
    const { show, image } = service()
    const tree = await card(badge())
    expect(image.mock.calls).toEqual([[COMMUNITY, 'bdg_helper', SHA]])
    expect(show).not.toHaveBeenCalled()
    expect(tree.getByTestId(id('BadgeCardPicture')).props.source).toEqual({ uri: PIXEL })
  })

  it('without a digest, asks the badge for its digest first, then the picture', async () => {
    const { show, image } = service()
    await card(badge({ imageSha256: undefined }))
    expect(show.mock.calls).toEqual([[COMMUNITY, 'bdg_helper']])
    // The fake's Helper badge names digest 'a'×64.
    expect(image.mock.calls).toEqual([[COMMUNITY, 'bdg_helper', 'a'.repeat(64)]])
  })

  it('never draws a location: an answer that is not a data URI leaves the mark', async () => {
    service({ image: async () => 'https://makers.example.org/badges/bdg_helper/image' })
    const tree = await card(badge())
    expect(tree.queryByTestId(id('BadgeCardPicture'))).toBeNull()
    expect(tree.getByTestId(id('BadgeCardPictureMark'))).toBeTruthy()
  })

  it('without a badge id, asks nothing and draws the mark', async () => {
    const { show, image } = service()
    const tree = await card(badge({ badgeId: undefined }))
    expect(show).not.toHaveBeenCalled()
    expect(image).not.toHaveBeenCalled()
    expect(tree.getByTestId(id('BadgeCardPictureMark'))).toBeTruthy()
  })
})

describe('the details', () => {
  it("show what it is for, who gave it, its dates, and the givers' notes, said to be the holder's only", async () => {
    service()
    const tree = await card(badge())
    fireEvent.press(tree.getByTestId(id('BadgeCardOpen')))
    expect(text(tree, id('BadgeCardDetailsName'))).toBe('Helper')
    expect(text(tree, id('BadgeCardDescription'))).toBe('Answered a newcomer’s question.')
    expect(text(tree, id('BadgeCardGivenBy'))).toBe('Makers')
    expect(text(tree, id('BadgeCardEarnedOn'))).toBe(localDate('2026-11-10T12:00:00Z'))
    expect(text(tree, id('BadgeCardValidUntil'))).toBe(localDate('2027-11-10T12:00:00Z'))
    expect(tree.getByText('Thanks for the help at the meetup.')).toBeTruthy()
    expect(tree.getByText('BadgeCard.NotesPrivate')).toBeTruthy()
  })

  it('without a note, has no notes section', async () => {
    service()
    const tree = await card(badge({ evidence: [{ acceptedAt: '2026-11-10T12:00:00Z', note: ' ' }] }))
    fireEvent.press(tree.getByTestId(id('BadgeCardOpen')))
    expect(tree.queryByTestId(id('BadgeCardNotes'))).toBeNull()
  })
})

describe('the kill', () => {
  it.each([
    ['remoteOff', { on: true, remoteOff: true }],
    ['not on', { on: false, remoteOff: false }],
  ])('%s: no card, and nothing asked', async (_name, value) => {
    const { show, image } = service()
    Object.assign(MEMBER_BADGES, value)
    const tree = await card(badge())
    expect(tree.queryByTestId(id('BadgeCard'))).toBeNull()
    expect(show).not.toHaveBeenCalled()
    expect(image).not.toHaveBeenCalled()
  })

  it('reaches details already open: they draw nothing', () => {
    MEMBER_BADGES.remoteOff = true
    const tree = render(
      <BasicAppContext>
        <BadgeCardDetails view={badge()} onClose={() => undefined} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(id('BadgeCardDetails'))).toBeNull()
  })
})

describe('the words', () => {
  it.each([
    ['en', en],
    ['fr', fr],
    ['pt-BR', ptBr],
  ])('%s: a badge is never called verified, checked or proven', (_lang, words) => {
    const all = Object.values((words as unknown as Record<string, Record<string, string>>).BadgeCard).join(' ')
    expect(all).not.toMatch(/verif|vérif|check|vérifi|prouv|prov|comprov|confirm/i)
    expect(Object.keys((words as unknown as Record<string, object>).BadgeCard).sort()).toEqual(
      Object.keys(en.BadgeCard).sort()
    )
  })
})
