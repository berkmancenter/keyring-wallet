/**
 * Where this phone keeps the rooms it saw take replies or reactions (`recordsWereOn`): per room and member, by hash,
 * an epoch or none, capped, and read as empty when it can't be read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  keepRecordsOn,
  recordsWereOnAt,
  RECORDS_ON_KEPT_KEY,
  RECORDS_ON_KEPT_MAX,
  resetRecordsOnKept,
} from '../recordsWereOn'

const ROOM = 'did:webvh:room:one'
const OTHER_ROOM = 'did:webvh:room:two'
const ME = 'did:key:me'
const SOMEONE = 'did:key:someone'

const stored = async (): Promise<Record<string, unknown>> =>
  JSON.parse(((await AsyncStorage.getItem(RECORDS_ON_KEPT_KEY)) as string | undefined) ?? '{}')

beforeEach(async () => {
  await AsyncStorage.setItem(RECORDS_ON_KEPT_KEY, '{}')
  resetRecordsOnKept()
  jest.restoreAllMocks()
})

describe('rooms seen taking replies or reactions', () => {
  test('keeps the epoch per room and member, and reads it back after a relaunch', async () => {
    await keepRecordsOn(ROOM, ME, 3)
    resetRecordsOnKept()
    expect(await recordsWereOnAt(ROOM, ME)).toBe(3)
    expect(await recordsWereOnAt(ROOM, SOMEONE)).toBeUndefined()
    expect(await recordsWereOnAt(OTHER_ROOM, ME)).toBeUndefined()
  })

  test('an unknown epoch is kept as on, at no epoch', async () => {
    await keepRecordsOn(ROOM, ME, undefined)
    expect(await recordsWereOnAt(ROOM, ME)).toBeNull()
  })

  test('keeps no room ID in plain form', async () => {
    await keepRecordsOn(ROOM, ME, 3)
    const raw = (await AsyncStorage.getItem(RECORDS_ON_KEPT_KEY)) as string
    expect(raw).not.toContain(ROOM)
    expect(raw).not.toContain(ME)
    expect(Object.keys(await stored())).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)])
  })

  test('writes only on a change, and a later epoch replaces the earlier', async () => {
    const write = jest.spyOn(AsyncStorage, 'setItem')
    await keepRecordsOn(ROOM, ME, 3)
    await keepRecordsOn(ROOM, ME, 3)
    expect(write).toHaveBeenCalledTimes(1)
    await keepRecordsOn(ROOM, ME, 5)
    expect(write).toHaveBeenCalledTimes(2)
    expect(await recordsWereOnAt(ROOM, ME)).toBe(5)
  })

  test(`keeps at most ${RECORDS_ON_KEPT_MAX}, letting go of the room seen on longest ago`, async () => {
    for (let i = 0; i <= RECORDS_ON_KEPT_MAX; i++) await keepRecordsOn(`did:webvh:room:${i}`, ME, i)
    expect(Object.keys(await stored())).toHaveLength(RECORDS_ON_KEPT_MAX)
    expect(await recordsWereOnAt('did:webvh:room:0', ME)).toBeUndefined()
    expect(await recordsWereOnAt('did:webvh:room:1', ME)).toBe(1)
    expect(await recordsWereOnAt(`did:webvh:room:${RECORDS_ON_KEPT_MAX}`, ME)).toBe(RECORDS_ON_KEPT_MAX)
  })

  test('a room seen on again moves to the newest end, so the cap keeps it', async () => {
    await keepRecordsOn('did:webvh:room:a', ME, 1)
    for (let i = 0; i < RECORDS_ON_KEPT_MAX - 1; i++) await keepRecordsOn(`did:webvh:room:${i}`, ME, i)
    await keepRecordsOn('did:webvh:room:a', ME, 2)
    await keepRecordsOn('did:webvh:room:new', ME, 9)
    expect(await recordsWereOnAt('did:webvh:room:a', ME)).toBe(2)
    expect(await recordsWereOnAt('did:webvh:room:0', ME)).toBeUndefined()
  })

  test.each([
    ['nothing stored', undefined],
    ['text that is no JSON', '{not json'],
    ['a list', '[3]'],
  ])('%s reads as never seen on', async (_what, raw) => {
    if (raw === undefined) jest.spyOn(AsyncStorage, 'getItem').mockReturnValue(undefined as never)
    else await AsyncStorage.setItem(RECORDS_ON_KEPT_KEY, raw)
    resetRecordsOnKept()
    expect(await recordsWereOnAt(ROOM, ME)).toBeUndefined()
  })

  test('an entry that is no epoch is left out, and the others kept', async () => {
    await keepRecordsOn(ROOM, ME, 3)
    const good = await stored()
    await AsyncStorage.setItem(RECORDS_ON_KEPT_KEY, JSON.stringify({ ...good, bad1: 'three', bad2: -1, bad3: 1.5 }))
    resetRecordsOnKept()
    expect(await recordsWereOnAt(ROOM, ME)).toBe(3)
    await keepRecordsOn(OTHER_ROOM, ME, 4)
    // The bad entries are not written back.
    expect(Object.keys(await stored())).toHaveLength(2)
    expect(Object.values(await stored()).sort()).toEqual([3, 4])
  })

  test("a store that can't be written keeps it for this run", async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(() => {
      throw new Error('disk full')
    })
    await keepRecordsOn(ROOM, ME, 3)
    expect(await recordsWereOnAt(ROOM, ME)).toBe(3)
  })
})
