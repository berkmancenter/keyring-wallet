/**
 * Rooms in the Messages list, the list's own rules: people and rooms in one list newest first, a chip per community
 * that has a room, what each chip shows, and search by name within the chip.
 */
import {
  ALL,
  communityChips,
  itemsForChip,
  mergeByTime,
  sameChip,
  searchItems,
  type RoomListRow,
} from '../../src/components/listItems/messagesListItems'

const at = (hhmm: string) => new Date(`2026-10-30T${hhmm}:00Z`)
type Person = { key: string; name: string; at: number }
const person = (key: string, name: string, hhmm: string): Person => ({ key, name, at: at(hhmm).getTime() })
const room = (key: string, roomName: string, communityDid: string, communityName?: string, hhmm?: string) =>
  ({ key, roomName, communityDid, communityName, lastActivityAt: hhmm ? at(hhmm) : undefined }) satisfies RoomListRow

const LAB = 'did:webvh:lab'
const VTC = 'did:webvh:vtc'
const people = [person('contact:sam', 'Sam Okafor', '09:41'), person('contact:ana', 'Ana Ribeiro', '08:00')]
const rooms = [
  room('r-open', 'Keyring lab open', LAB, 'Keyring Lab', '08:30'),
  room('r-plan', 'Planning', LAB, 'Keyring Lab', '09:52'),
  room('r-desk', 'Welcome desk', VTC, 'Test VTC', '07:00'),
  room('r-new', 'Fresh room', VTC, 'Test VTC'),
]
const items = mergeByTime(people, (p) => p.at, rooms)
const keys = (list: { key: string }[]) => list.map((i) => i.key)

describe('mergeByTime', () => {
  test('people and rooms in one list, newest first; a room with nothing in it yet last', () => {
    expect(keys(items)).toEqual([
      'room:r-plan',
      'contact:sam',
      'room:r-open',
      'contact:ana',
      'room:r-desk',
      'room:r-new',
    ])
  })

  test('room keys never collide with a contact or connection key', () => {
    const clash = mergeByTime([person('r-plan', 'A person', '10:00')], (p) => p.at, [room('r-plan', 'Planning', LAB)])
    expect(new Set(keys(clash)).size).toBe(2)
  })

  test('equal times keep people before rooms, each in their own order', () => {
    const same = mergeByTime([person('p1', 'One', '09:00'), person('p2', 'Two', '09:00')], (p) => p.at, [
      room('a', 'A', LAB, undefined, '09:00'),
      room('b', 'B', LAB, undefined, '09:00'),
    ])
    expect(keys(same)).toEqual(['p1', 'p2', 'room:a', 'room:b'])
  })
})

describe('communityChips', () => {
  test('one per community with a room, A to Z ignoring case and accents, nameless last', () => {
    const chips = communityChips([
      ...rooms,
      room('x', 'X', 'did:webvh:nameless'),
      room('y', 'Y', 'did:webvh:eco', 'École ouverte'),
    ])
    expect(chips.map((c) => c.communityDid)).toEqual(['did:webvh:eco', LAB, VTC, 'did:webvh:nameless'])
  })

  test("a community's name is taken from any of its rooms that knows it", () => {
    const chips = communityChips([room('a', 'A', LAB), room('b', 'B', LAB, 'Keyring Lab')])
    expect(chips).toEqual([{ communityDid: LAB, communityName: 'Keyring Lab' }])
  })

  test('no rooms, no community chips', () => {
    expect(communityChips([])).toEqual([])
  })
})

describe('itemsForChip', () => {
  test('All shows everything, in order', () => {
    expect(itemsForChip(items, ALL)).toEqual(items)
  })

  test('People shows the conversations only', () => {
    expect(keys(itemsForChip(items, { kind: 'people' }))).toEqual(['contact:sam', 'contact:ana'])
  })

  test('a community shows only its rooms, never people', () => {
    expect(keys(itemsForChip(items, { kind: 'community', communityDid: LAB }))).toEqual(['room:r-plan', 'room:r-open'])
  })

  test('sameChip tells chips apart by kind and community', () => {
    expect(sameChip(ALL, { kind: 'all' })).toBe(true)
    expect(sameChip({ kind: 'community', communityDid: LAB }, { kind: 'community', communityDid: VTC })).toBe(false)
    expect(sameChip({ kind: 'people' }, ALL)).toBe(false)
  })
})

describe('searchItems', () => {
  const name = (p: Person) => p.name

  test('a room matches by its name or its community name; a person by name; never message text', () => {
    expect(keys(searchItems(items, name, 'lab'))).toEqual(['room:r-plan', 'room:r-open'])
    expect(keys(searchItems(items, name, 'plan'))).toEqual(['room:r-plan'])
    expect(keys(searchItems(items, name, 'ana'))).toEqual(['contact:ana'])
  })

  test('every word must appear: "lab plan" finds Planning in Keyring Lab only', () => {
    expect(keys(searchItems(items, name, 'lab plan'))).toEqual(['room:r-plan'])
  })

  test('within the chip: People never finds a room', () => {
    expect(keys(searchItems(itemsForChip(items, { kind: 'people' }), name, 'lab'))).toEqual([])
  })

  test('a blank query keeps every item, in order', () => {
    expect(searchItems(items, name, '  ')).toEqual(items)
  })
})
