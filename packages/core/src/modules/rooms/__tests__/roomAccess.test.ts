/**
 * Which room access notice to say: access ending at 7 days and at 1, and access gone (removed, or past its end).
 * Each once; a room first met already gone says nothing; a renewal is said again when it nears its end; the rooms
 * gone are said before those ending. What is kept survives a relaunch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  ACCESS_KEPT_KEY,
  type AccessKept,
  accessNoticeFor,
  daysLeft,
  nextAccessNotice,
  resetAccessKept,
} from '../roomAccess'
import type { RoomSummary } from '../types'

const DAY = 86_400_000
// Noon, so whole days ahead stay on whole calendar days in any time zone.
const NOON = new Date(2026, 9, 30, 12, 0, 0)
const at = (days: number, from: Date = NOON) => new Date(from.getTime() + days * DAY)

const room = (roomId: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
  roomId,
  name: roomId as RoomSummary['name'],
  nameFrom: 'community',
  source: 'community',
  communityDid: 'did:webvh:QmLab:lab.example',
  tier: 'open',
  standing: 'member',
  ...over,
})
const until = (days: number) => at(days).toISOString()

/** Each listing in turn, through the kept lists, as the poll would hand them. */
function run(listings: [RoomSummary[], Date][]) {
  let kept: AccessKept = { known: [], said: [] }
  return listings.map(([rooms, now]) => {
    const result = accessNoticeFor(rooms, now, kept)
    kept = result.kept
    return result.notice
  })
}
const summary = (notice: ReturnType<typeof accessNoticeFor>['notice']) =>
  notice?.kind === 'gone'
    ? { gone: notice.rooms.map(({ room, ended }) => [room.roomId, ended]) }
    : notice?.kind === 'ending'
      ? { ending: notice.rooms.map(({ room, days }) => [room.roomId, days]) }
      : undefined

describe('access ending', () => {
  test('is said at 7 days, once, then at 1 day, once', () => {
    const planning = room('planning', { validUntil: until(5) })
    const said = run([
      [[planning], NOON],
      [[planning], at(1)],
      [[planning], at(4)],
      [[planning], at(4.1)],
    ])
    expect(said.map(summary)).toEqual([
      { ending: [['planning', 5]] },
      undefined,
      { ending: [['planning', 1]] },
      undefined,
    ])
  })

  test('a room first met with a day left says only that one', () => {
    const planning = room('planning', { validUntil: until(1) })
    expect(
      run([
        [[planning], NOON],
        [[planning], at(0.1)],
      ]).map(summary)
    ).toEqual([{ ending: [['planning', 1]] }, undefined])
  })

  test('more than 7 days left, or no end, says nothing', () => {
    expect(run([[[room('far', { validUntil: until(8) }), room('open-ended')], NOON]])).toEqual([undefined])
  })

  test('a renewal is said again when it nears its new end', () => {
    const first = room('planning', { validUntil: until(5) })
    const renewed = room('planning', { validUntil: until(40) })
    const said = run([
      [[first], NOON],
      [[renewed], at(1)],
      [[renewed], at(35)],
    ])
    expect(said.map(summary)).toEqual([{ ending: [['planning', 5]] }, undefined, { ending: [['planning', 5]] }])
  })
})

describe('access gone', () => {
  test('a room seen as a member and then removed is said once', () => {
    const member = room('planning')
    const removed = room('planning', { standing: 'removed' })
    expect(
      run([
        [[member], NOON],
        [[removed], at(1)],
        [[removed], at(2)],
      ]).map(summary)
    ).toEqual([undefined, { gone: [['planning', false]] }, undefined])
  })

  test('past its end it has ended, whichever the record says yet, and the removal after is not said again', () => {
    const member = room('planning', { validUntil: until(10) })
    const lapsed = { ...member }
    const removed = room('planning', { validUntil: until(10), standing: 'removed' })
    expect(
      run([
        [[member], NOON],
        [[lapsed], at(11)],
        [[removed], at(12)],
      ]).map(summary)
    ).toEqual([undefined, { gone: [['planning', true]] }, undefined])
  })

  test('a room first met already gone says nothing', () => {
    const removed = room('planning', { standing: 'removed' })
    const ended = room('board', { validUntil: until(-1) })
    expect(run([[[removed, ended], NOON]])).toEqual([undefined])
  })

  test('admitted again and removed again is said again', () => {
    const member = room('planning')
    const removed = room('planning', { standing: 'removed' })
    const said = run([
      [[member], NOON],
      [[removed], at(1)],
      [[member], at(2)],
      [[removed], at(3)],
    ])
    expect(said.map(summary)).toEqual([
      undefined,
      { gone: [['planning', false]] },
      undefined,
      { gone: [['planning', false]] },
    ])
  })

  test('the rooms gone are said before those ending, which wait for the next listing', () => {
    const board = room('board')
    const planning = room('planning', { validUntil: until(5) })
    const said = run([
      [[board], at(-1)],
      [[room('board', { standing: 'removed' }), planning], NOON],
      [[room('board', { standing: 'removed' }), planning], NOON],
    ])
    expect(said.map(summary)).toEqual([undefined, { gone: [['board', false]] }, { ending: [['planning', 5]] }])
  })
})

test("a room known only from the agent's own keys says nothing: it has no end and no standing", () => {
  const custody = room('held', { source: 'custody', validUntil: until(1) })
  expect(
    run([
      [[custody], NOON],
      [[{ ...custody, standing: 'removed' }], at(1)],
    ])
  ).toEqual([undefined, undefined])
})

test('days left are calendar days, and an end that is not a date has none', () => {
  const lateEvening = new Date(2026, 9, 30, 23, 0, 0)
  expect(daysLeft(new Date(2026, 9, 31, 1, 0, 0).toISOString(), lateEvening)).toBe(1)
  expect(daysLeft(new Date(2026, 9, 30, 23, 30, 0).toISOString(), lateEvening)).toBe(0)
  expect(daysLeft('soon', NOON)).toBeUndefined()
  expect(daysLeft(undefined, NOON)).toBeUndefined()
})

describe('kept on this phone', () => {
  beforeEach(async () => {
    resetAccessKept()
    await AsyncStorage.setItem(ACCESS_KEPT_KEY, '{}')
  })

  test('a relaunch says neither the same ending nor the same removal again, and keeps only hashes', async () => {
    await nextAccessNotice([room('planning')], NOON)
    expect(summary(await nextAccessNotice([room('planning', { standing: 'removed' })], at(1)))).toEqual({
      gone: [['planning', false]],
    })
    expect(summary(await nextAccessNotice([room('board', { validUntil: until(5) })], NOON))).toEqual({
      ending: [['board', 5]],
    })

    resetAccessKept()
    expect(await nextAccessNotice([room('planning', { standing: 'removed' })], at(2))).toBeUndefined()
    expect(await nextAccessNotice([room('board', { validUntil: until(5) })], at(1))).toBeUndefined()
    const raw = (await AsyncStorage.getItem(ACCESS_KEPT_KEY)) ?? ''
    expect(raw).not.toMatch(/planning|board/)
  })

  test('two listings arriving together say a notice once', async () => {
    const board = [room('board', { validUntil: until(5) })]
    const said = await Promise.all([nextAccessNotice(board, NOON), nextAccessNotice(board, NOON)])
    expect(said.filter(Boolean)).toHaveLength(1)
  })
})
