/**
 * The member-badges screens (docs/plans/member-badges-plan.md, What we build 2), on a2's real hooks over the fake
 * service: the Badges section on the community screen (offers with Accept and Decline, held badges, kudos), the badge
 * detail, and the badges row on another member's card. A community that doesn't serve badges, a wall the community
 * hides, a card opened by DID, and the release kill each show nothing. A badge is never called verified.
 */
import { useRoute } from '@react-navigation/native'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { MEMBER_BADGES } from '../badgesSwitch'
import { BadgesIds } from '../components/Badges.ids'
import { CommunityBadgesSection } from '../components/CommunityBadgesSection'
import { MemberBadgesRow, wallOrder } from '../components/MemberBadgesRow'
import { createFakeBadgeService, FAKE_BADGES } from '../fakeBadgeService'
import BadgeDetail from '../screens/BadgeDetail'
import type { BadgeService, MyBadges, WallBadge } from '../types'
import * as hooks from '../useBadges'
import { resetBadgeService, setBadgeServiceForTests } from '../useBadges'

// The shared mock runs a focus effect on every render; here it runs as focus does, once per change of its callback,
// so the real hooks read once on opening and again on refresh.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('../../../../__mocks__/@react-navigation/native')
  const { useEffect } = jest.requireActual('react')
  return { ...actual, useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) }
})

const COMMUNITY = FAKE_BADGES.helper.communityDid
const SHIPPED = { ...MEMBER_BADGES }
const id = (key: string) => testIdWithKey(key)

type Fake = ReturnType<typeof createFakeBadgeService>
function inject(fake: Fake, spy: Partial<Record<keyof BadgeService, jest.Mock>> = {}): Fake {
  const service = { ...fake, ...spy } as Fake
  setBadgeServiceForTests(service)
  return service
}

const section = () =>
  render(
    <BasicAppContext>
      <CommunityBadgesSection communityDid={COMMUNITY} />
    </BasicAppContext>
  )

afterEach(() => {
  Object.assign(MEMBER_BADGES, SHIPPED)
  resetBadgeService()
  jest.mocked(useRoute).mockReturnValue({ params: {} } as never)
})

describe('the Badges section on the community screen', () => {
  test('offers first, each with Accept and Decline and the note to this member, then held badges, then kudos', async () => {
    inject(createFakeBadgeService())
    const tree = section()
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.section))).toBeTruthy())
    expect(tree.getAllByTestId(id(BadgesIds.offer))).toHaveLength(1)
    expect(tree.getByText('Event organiser')).toBeTruthy()
    expect(tree.getByText('Badges.FromCommunityBy')).toBeTruthy() // the giver's name, when the directory shows it
    expect(tree.getByText('“For the meetup.”')).toBeTruthy()
    expect(tree.getByTestId(id(BadgesIds.accept))).toBeTruthy()
    expect(tree.getByTestId(id(BadgesIds.decline))).toBeTruthy()
    expect(tree.getAllByTestId(id(BadgesIds.held))).toHaveLength(1) // the kudos badge is not a held row
    expect(tree.getByText('Helper')).toBeTruthy()
    expect(tree.getByTestId(id(BadgesIds.kudosTotal))).toBeTruthy()
    expect(tree.getByText('Thanks! ×3')).toBeTruthy()
    expect(tree.queryByTestId(id(BadgesIds.onlyYou))).toBeNull()
  })

  test('a badge given more than once says how many; a wall nobody sees says so to its owner', async () => {
    const mine: MyBadges = {
      held: [
        {
          ...FAKE_BADGES.helper,
          count: 2,
          since: '2026-11-01T00:00:00Z',
          latestAt: '2026-11-12T00:00:00Z',
          pinned: false,
          hidden: true,
        },
      ],
      offers: [],
      visibility: 'nobody',
    }
    inject(createFakeBadgeService({ mine }))
    const tree = section()
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.heldCount))).toBeTruthy())
    expect(tree.getByText('×2')).toBeTruthy()
    expect(tree.getByText('Badges.EarnedTimes')).toBeTruthy()
    expect(tree.getByText('Badges.HiddenFromWall')).toBeTruthy()
    expect(tree.getByTestId(id(BadgesIds.onlyYou))).toBeTruthy()
    expect(tree.queryByTestId(id(BadgesIds.kudos))).toBeNull()
  })

  test.each([
    ['an empty answer (a community with badges switched off answers so)', { held: [], offers: [] }],
    ['an empty answer with a zero kudos total', { held: [], offers: [], kudosTotal: 0 }],
  ])('%s shows no section', async (_w, answer) => {
    const fake = inject(createFakeBadgeService({ mine: answer as MyBadges }))
    const mine = jest.spyOn(fake, 'mine')
    const tree = section()
    await waitFor(() => expect(mine).toHaveBeenCalled())
    await act(async () => undefined)
    expect(tree.queryByTestId(id(BadgesIds.section))).toBeNull()
  })

  test('kudos alone still show the section (control for the empty rows)', async () => {
    inject(createFakeBadgeService({ mine: { held: [], offers: [], kudosTotal: 4 } }))
    const tree = section()
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.kudosTotal))).toBeTruthy())
    expect(tree.queryByTestId(id(BadgesIds.held))).toBeNull()
  })

  test('a community that does not serve badges shows no section at all', async () => {
    const fake = inject(createFakeBadgeService({ mine: 'notServed' }))
    const mine = jest.spyOn(fake, 'mine')
    const tree = section()
    await waitFor(() => expect(mine).toHaveBeenCalled())
    expect(tree.queryByTestId(id(BadgesIds.section))).toBeNull()
  })

  test('the release kill shows no section and asks nothing, with a service in hand', async () => {
    const fake = inject(createFakeBadgeService())
    const mine = jest.spyOn(fake, 'mine')
    MEMBER_BADGES.remoteOff = true
    const tree = section()
    await act(async () => undefined)
    expect(tree.queryByTestId(id(BadgesIds.section))).toBeNull()
    expect(mine).not.toHaveBeenCalled()
  })

  test.each([
    ['accept', BadgesIds.accept, 'accepted'],
    ['decline', BadgesIds.decline, 'declined'],
  ] as const)(
    '%s calls the service once, even on a double tap, and reads the badges again',
    async (_w, button, log) => {
      const fake = createFakeBadgeService()
      let release: () => void = () => undefined
      const slow = new Promise<void>((r) => (release = r))
      const answer = jest.fn(async (c: string, awardId: string) => {
        await slow
        return fake[_w](c, awardId)
      })
      const mine = jest.fn(fake.mine)
      inject(fake, { [_w]: answer, mine })
      const tree = section()
      await waitFor(() => expect(tree.getByTestId(id(button))).toBeTruthy())
      expect(mine).toHaveBeenCalledTimes(1)
      fireEvent.press(tree.getByTestId(id(button)))
      fireEvent.press(tree.getByTestId(id(button)))
      await act(async () => release())
      await waitFor(() => expect(mine).toHaveBeenCalledTimes(2))
      expect(answer).toHaveBeenCalledTimes(1)
      expect(fake[log]).toEqual(['awd_2'])
      expect(answer).toHaveBeenCalledWith(COMMUNITY, 'awd_2')
    }
  )

  test('an answer that fails says so and does not read again; the offer can be answered again', async () => {
    const fake = createFakeBadgeService()
    const accept = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(undefined)
    const mine = jest.fn(fake.mine)
    inject(fake, { accept, mine })
    const tree = section()
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.accept))).toBeTruthy())
    fireEvent.press(tree.getByTestId(id(BadgesIds.accept)))
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.offerFailed))).toBeTruthy())
    expect(mine).toHaveBeenCalledTimes(1)
    fireEvent.press(tree.getByTestId(id(BadgesIds.accept)))
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(2))
    expect(accept).toHaveBeenCalledTimes(2)
  })
})

describe('each surface checks the kill itself, not only through the hooks', () => {
  test('the section hides while killed even if a hook hands it badges', () => {
    const fake = createFakeBadgeService()
    setBadgeServiceForTests(fake)
    const spy = jest.spyOn(hooks, 'useMyBadges').mockReturnValue({
      served: true,
      loading: false,
      refresh: () => undefined,
      badges: { held: [], offers: [], kudosTotal: 2 },
    })
    MEMBER_BADGES.remoteOff = true
    expect(section().queryByTestId(id(BadgesIds.section))).toBeNull()
    MEMBER_BADGES.remoteOff = false
    expect(section().queryByTestId(id(BadgesIds.section))).toBeTruthy() // control
    spy.mockRestore()
  })

  test('the member row hides while killed, or with no entry, even if a hook hands it a wall', () => {
    const wall: WallBadge[] = [{ ...FAKE_BADGES.helper, count: 1, pinned: false }]
    const spy = jest.spyOn(hooks, 'useMemberWall').mockReturnValue({ state: 'shown', wall })
    const row = (entryId?: string) =>
      render(
        <BasicAppContext>
          <MemberBadgesRow communityDid={COMMUNITY} entryId={entryId} />
        </BasicAppContext>
      )
    MEMBER_BADGES.remoteOff = true
    expect(row('entry-7').queryByTestId(id(BadgesIds.memberRow))).toBeNull()
    MEMBER_BADGES.remoteOff = false
    expect(row(undefined).queryByTestId(id(BadgesIds.memberRow))).toBeNull()
    expect(row('entry-7').queryByTestId(id(BadgesIds.memberRow))).toBeTruthy() // control
    // A wall the community stops showing hides at once, whatever was read before.
    spy.mockReturnValue({ state: 'hidden', wall })
    expect(row('entry-7').queryByTestId(id(BadgesIds.memberRow))).toBeNull()
    spy.mockRestore()
  })
})

describe("a badge's picture", () => {
  test('comes from images/get as a data URI; anything else, or no picture, is the plain tile', async () => {
    const fake = inject(createFakeBadgeService({ mine: { held: [], offers: [] } }))
    const image = jest.spyOn(fake, 'image')
    const mine: MyBadges = {
      held: [{ ...FAKE_BADGES.helper, count: 1, since: '2026-11-10T12:00:00Z', pinned: false, hidden: false }],
      offers: [],
    }
    jest.spyOn(fake, 'mine').mockResolvedValue(mine)
    const shown = section()
    await waitFor(() => expect(shown.getByTestId(id(BadgesIds.image))).toBeTruthy())
    expect(image).toHaveBeenCalledWith(COMMUNITY, 'bdg_helper', 'a'.repeat(64))
    shown.unmount()

    image.mockResolvedValue('https://community.example/badges/helper.png')
    const linked = section()
    await waitFor(() => expect(linked.getByTestId(id(BadgesIds.imageStandIn))).toBeTruthy())
    expect(linked.queryByTestId(id(BadgesIds.image))).toBeNull()
    linked.unmount()

    image.mockClear()
    jest.spyOn(fake, 'mine').mockResolvedValue({
      held: [{ ...FAKE_BADGES.organiser, count: 1, since: '2026-11-10T12:00:00Z', pinned: false, hidden: false }],
      offers: [],
    })
    const none = section()
    await waitFor(() => expect(none.getByTestId(id(BadgesIds.imageStandIn))).toBeTruthy())
    expect(image).not.toHaveBeenCalled()
  })
})

describe("the badges row on another member's card", () => {
  const row = (entryId?: string) =>
    render(
      <BasicAppContext>
        <MemberBadgesRow communityDid={COMMUNITY} entryId={entryId} />
      </BasicAppContext>
    )
  const wall: WallBadge[] = [
    { ...FAKE_BADGES.organiser, count: 1, pinned: false },
    { ...FAKE_BADGES.helper, count: 1, pinned: true, since: '2026-11-10T12:00:00Z' },
  ]

  test('shows what wall/show returns for this viewer, pinned first', async () => {
    const fake = inject(createFakeBadgeService({ wall }))
    const asked = jest.spyOn(fake, 'wall')
    const tree = row('entry-7')
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.memberRow))).toBeTruthy())
    expect(asked).toHaveBeenCalledWith(COMMUNITY, 'entry-7')
    expect(tree.getAllByTestId(id(BadgesIds.memberChip)).map((c) => c.props.accessibilityLabel)).toEqual([
      'Helper',
      'Event organiser',
    ]) // pinned first, as shown
    expect(wallOrder(wall).map((b) => b.badgeId)).toEqual(['bdg_helper', 'bdg_organiser'])
  })

  test.each([
    ['a wall the community hides', { wall: 'hidden' as const }],
    ['a community that does not serve badges', { wall: 'notServed' as const }],
    ['an empty wall', { wall: [] as WallBadge[] }],
  ])('%s shows no row', async (_w, overrides) => {
    const fake = inject(createFakeBadgeService(overrides))
    const asked = jest.spyOn(fake, 'wall')
    const tree = row('entry-7')
    await waitFor(() => expect(asked).toHaveBeenCalled())
    await act(async () => undefined)
    expect(tree.queryByTestId(id(BadgesIds.memberRow))).toBeNull()
  })

  test('a card opened by DID has no entry: no row, and no wall is asked for', async () => {
    const fake = inject(createFakeBadgeService({ wall }))
    const asked = jest.spyOn(fake, 'wall')
    const tree = row(undefined)
    await act(async () => undefined)
    expect(tree.queryByTestId(id(BadgesIds.memberRow))).toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })

  test('the release kill shows no row and asks nothing', async () => {
    const fake = inject(createFakeBadgeService({ wall }))
    const asked = jest.spyOn(fake, 'wall')
    MEMBER_BADGES.remoteOff = true
    const tree = row('entry-7')
    await act(async () => undefined)
    expect(tree.queryByTestId(id(BadgesIds.memberRow))).toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('the badge detail', () => {
  const open = (params: object) => {
    jest.mocked(useRoute).mockReturnValue({ params } as never)
    return render(
      <BasicAppContext>
        <BadgeDetail />
      </BasicAppContext>
    )
  }

  test('reads the badge from its community and shows what it is and when it was earned', async () => {
    const fake = inject(createFakeBadgeService())
    const show = jest.spyOn(fake, 'show').mockResolvedValue({ ...FAKE_BADGES.helper, criteria: 'Answer a question.' })
    const tree = open({
      communityDid: COMMUNITY,
      badgeId: 'bdg_helper',
      name: 'Helper',
      whose: 'mine',
      count: 1,
      since: '2026-11-10T12:00:00Z',
    })
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.detailDescription))).toBeTruthy())
    expect(show).toHaveBeenCalledWith(COMMUNITY, 'bdg_helper')
    expect(tree.getByText('Answer a question.')).toBeTruthy()
    expect(tree.getByTestId(id(BadgesIds.detailEarned))).toBeTruthy()
    expect(tree.getByTestId(id(BadgesIds.detailGiver))).toBeTruthy()
  })

  test("a read that fails keeps the row's name and offers Try again, which reads again", async () => {
    const fake = inject(createFakeBadgeService())
    const show = jest
      .spyOn(fake, 'show')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(FAKE_BADGES.helper)
    const tree = open({ communityDid: COMMUNITY, badgeId: 'bdg_helper', name: 'Helper', whose: 'theirs' })
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.detailReadFailed))).toBeTruthy())
    expect(tree.getByText('Helper')).toBeTruthy()
    fireEvent.press(tree.getByTestId(id(BadgesIds.detailTryAgain)))
    await waitFor(() => expect(tree.getByTestId(id(BadgesIds.detailDescription))).toBeTruthy())
    expect(show).toHaveBeenCalledTimes(2)
  })

  test('the release kill shows nothing and asks nothing', async () => {
    const fake = inject(createFakeBadgeService())
    const show = jest.spyOn(fake, 'show')
    MEMBER_BADGES.remoteOff = true
    const tree = open({ communityDid: COMMUNITY, badgeId: 'bdg_helper', name: 'Helper', whose: 'mine' })
    await act(async () => undefined)
    expect(tree.queryByTestId(id(BadgesIds.screen))).toBeNull()
    expect(show).not.toHaveBeenCalled()
  })
})

describe('the words', () => {
  test.each([
    ['en', en.Badges],
    ['fr', fr.Badges],
    ['pt-br', ptBr.Badges],
  ])('%s: a badge is never verified, checked or proven', (_lang, words) => {
    const all = Object.values(words as Record<string, string>)
      .join(' ')
      .toLowerCase()
    for (const banned of ['verif', 'vérifi', 'check', 'proven', 'prouv', 'comprova', 'confirm'])
      expect({ banned, found: all.includes(banned) }).toEqual({ banned, found: false })
    expect(Object.keys(words as object).sort()).toEqual(Object.keys(en.Badges).sort())
  })
})
