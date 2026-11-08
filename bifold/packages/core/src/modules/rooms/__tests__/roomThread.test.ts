import { type RoomPost } from '../roomPosts'
import { toInertText } from '../inertText'
import {
  arrivedLate,
  drawnInChat,
  byArrival,
  foldRoomRecords,
  isRemovedMessage,
  quotedWords,
  quoteOf,
  rewroteFrom,
} from '../roomThread'
import type { Identity } from '../types'

const noor = { did: 'did:example:noor' } as unknown as Identity
const ines = { did: 'did:example:ines' } as unknown as Identity
const me = { did: 'did:example:me' } as unknown as Identity

const post = (key: string, over: Partial<RoomPost> = {}): RoomPost => ({
  key,
  version: 1,
  author: noor,
  byAgent: false,
  mine: false,
  text: toInertText('words'),
  isChatMessage: false,
  retracted: false,
  pinned: false,
  unread: false,
  files: [],
  ...over,
})
const reaction = (key: string, on: string, value: string, over: Partial<RoomPost> = {}): RoomPost =>
  post(key, { kind: 'reaction', inReplyTo: { key: on }, text: toInertText(value), ...over })

describe('foldRoomRecords: reactions', () => {
  test("one chip per value, a count of people, and the phone's own marked", () => {
    const { reactions } = foldRoomRecords([
      reaction('r3', 'm', '👍', { author: me, mine: true }),
      reaction('r2', 'm', '👍', { author: ines }),
      reaction('r1', 'm', '😂', { author: noor }),
      post('m'),
    ])
    const tallies = reactions.get('m') ?? []
    expect(tallies.map((t) => [t.value, t.count, t.mine, t.others])).toEqual([
      ['😂', 1, false, [noor]],
      ['👍', 2, true, [ines]],
    ])
  })

  test('one author and one value count once, however many records carry them', () => {
    const { reactions } = foldRoomRecords([reaction('a', 'm', '👍'), reaction('b', 'm', '👍'), post('m')])
    expect(reactions.get('m')?.[0].count).toBe(1)
    expect(reactions.get('m')?.[0].others).toEqual([noor])
  })

  test('one author with two values counts in both: another app may write that', () => {
    const { reactions } = foldRoomRecords([
      reaction('a', 'm', '👍', { author: me, mine: true }),
      reaction('b', 'm', '😂', { author: me, mine: true }),
      post('m'),
    ])
    expect(reactions.get('m')?.map((t) => t.mine)).toEqual([true, true])
  })

  test('the two forms of an emoji are one value, shown fully qualified', () => {
    const { reactions } = foldRoomRecords([
      reaction('a', 'm', '❤', { author: noor }),
      reaction('b', 'm', '❤️', { author: ines }),
      post('m'),
    ])
    const tallies = reactions.get('m') ?? []
    expect(tallies).toHaveLength(1)
    expect(tallies[0].count).toBe(2)
    expect(tallies[0].shown).toBe('❤️')
  })

  test('emoji come first, then words, each in the order they came', () => {
    const { reactions } = foldRoomRecords([
      reaction('c', 'm', '👍', { author: me }),
      reaction('b', 'm', 'see you there', { author: ines }),
      reaction('a', 'm', 'agreed', { author: noor }),
      post('m'),
    ])
    expect(reactions.get('m')?.map((t) => t.shown)).toEqual(['👍', 'agreed', 'see you there'])
  })

  test.each([
    ['its target is not in hand', [reaction('r', 'gone', '👍')]],
    ['its target was withdrawn', [reaction('r', 'm', '👍'), post('m', { kind: 'message', text: toInertText('') })]],
    ['its target was retracted', [reaction('r', 'm', '👍'), post('m', { retracted: true })]],
    ['its target could not be read', [reaction('r', 'm', '👍'), post('m', { unread: true })]],
    ['its target is a reaction', [reaction('r', 'm', '👍'), reaction('m', 'x', '👍')]],
    ['its value is empty, so it was taken back', [reaction('r', 'm', '   '), post('m')]],
    ['its value is too long', [reaction('r', 'm', 'x'.repeat(65)), post('m')]],
    ['it names a reaction', [reaction('r', 'm', '👍', { answersReaction: true }), post('m')]],
    ['it has no author to count, as on a private room', [reaction('r', 'm', '👍', { author: undefined }), post('m')]],
  ])('no chip when %s', (_why, posts) => {
    expect(foldRoomRecords(posts).reactions.get('m')).toBeUndefined()
  })

  test('a note listed only by its title still takes its reactions; another unread record does not', () => {
    const note = post('m', { unread: true, title: toInertText('Onboarding') })
    expect(foldRoomRecords([reaction('r', 'm', '👍'), note]).reactions.get('m')).toHaveLength(1)
  })

  test('a target read only for a quote still takes its reactions', () => {
    const targets = new Map([['m', post('m')]])
    expect(foldRoomRecords([reaction('r', 'm', '👍')], targets).reactions.get('m')).toHaveLength(1)
  })
})

describe("foldRoomRecords: the member's own reactions, to change or take back", () => {
  test('every record of theirs, newest first, by what it answers; a chip still counts them once', () => {
    const { mine, reactions } = foldRoomRecords([
      reaction('r4', 'm', '❤️', { author: me, mine: true }),
      reaction('r3', 'm', '👍', { author: me, mine: true }),
      reaction('r2', 'm', '👍', { author: me, mine: true }),
      reaction('r1', 'm', '👍', { author: noor }),
      post('m'),
    ])
    expect(mine.get('m')).toEqual([
      { key: 'r4', value: '❤' },
      { key: 'r3', value: '👍' },
      { key: 'r2', value: '👍' },
    ])
    expect(reactions.get('m')?.find((t) => t.value === '👍')?.count).toBe(2)
  })

  test("another member's, a withdrawn one, and one on what can't be shown are not the member's to change", () => {
    const { mine } = foldRoomRecords([
      reaction('r3', 'gone', '👍', { author: me, mine: true }),
      reaction('r2', 'm', '', { author: me, mine: true }),
      reaction('r1', 'm', '👍', { author: noor }),
      post('m'),
      post('gone', { retracted: true }),
    ])
    expect(mine.get('m')).toBeUndefined()
    expect(mine.get('gone')).toBeUndefined()
  })
})

describe('foldRoomRecords: a new version may not change what a record is', () => {
  test('a message rewritten as a reaction is refused and not counted, the others stay', () => {
    const held = new Map([['m', { author: noor, kind: 'message' }]])
    const { refused, reactions } = foldRoomRecords(
      [reaction('m', 'other', '👍', { author: ines }), post('other')],
      new Map(),
      held
    )
    expect([...refused]).toEqual(['m'])
    expect(reactions.get('other')).toBeUndefined()
  })

  test('a message rewritten as a note is refused: any change of kind, not only to a reaction', () => {
    const held = new Map([['m', { author: noor, kind: 'message' }]])
    expect(foldRoomRecords([post('m', { kind: 'note' })], new Map(), held).refused.has('m')).toBe(true)
  })

  test('a reaction moved to another record is refused', () => {
    const held = new Map([['r', { author: noor, kind: 'reaction', reactsTo: 'a' }]])
    const { refused, reactions } = foldRoomRecords([reaction('r', 'b', '👍'), post('a'), post('b')], new Map(), held)
    expect(refused.has('r')).toBe(true)
    expect(reactions.get('b')).toBeUndefined()
  })

  test('with nothing held there is nothing to compare, and a same-kind version is fine', () => {
    expect(foldRoomRecords([post('m', { kind: 'message' })]).refused.size).toBe(0)
    const held = new Map([['m', { author: noor, kind: 'message' }]])
    expect(foldRoomRecords([post('m', { kind: 'message' })], new Map(), held).refused.size).toBe(0)
  })

  test('a retraction is no change of kind: a tombstone carries none', () => {
    const held = new Map([['m', { author: noor, kind: 'message' }]])
    expect(foldRoomRecords([post('m', { retracted: true })], new Map(), held).refused.size).toBe(0)
  })
})

describe('quoteOf', () => {
  const none = new Map<string, RoomPost>()
  const noneMissing = new Set<string>()
  const thread = { reactions: new Map(), refused: new Set<string>(), mine: new Map() }
  const reply = (over: Partial<RoomPost> = {}) => post('reply', { inReplyTo: { key: 't' }, ...over })

  test('a post that answers nothing has no quote', () => {
    expect(quoteOf(post('p'), [], none, noneMissing, thread)).toBeUndefined()
  })

  test('a target on the page is quoted', () => {
    const target = post('t')
    expect(quoteOf(reply(), [target], none, noneMissing, thread)).toEqual({
      available: true,
      target,
      note: false,
      changed: false,
    })
  })

  test('a target not read yet draws no quote; one that could not be read is not available', () => {
    expect(quoteOf(reply(), [], none, noneMissing, thread)).toEqual({ available: 'reading' })
    expect(quoteOf(reply(), [], none, new Set(['t']), thread)).toEqual({ available: false })
  })

  test.each([
    ['withdrawn', post('t', { kind: 'message', text: toInertText('') })],
    ['retracted', post('t', { retracted: true })],
    ['unreadable', post('t', { unread: true })],
  ])('a %s target is not available and shows nothing of it', (_why, target) => {
    expect(quoteOf(reply(), [target], none, noneMissing, thread)).toEqual({ available: false })
  })

  test('a refused target is not available', () => {
    const refused = { reactions: new Map(), refused: new Set(['t']), mine: new Map() }
    expect(quoteOf(reply(), [post('t')], none, noneMissing, refused)).toEqual({ available: false })
  })

  test('a note is marked as one, by its title', () => {
    const target = post('t', { title: toInertText('Onboarding decisions') })
    expect(quoteOf(reply(), [target], none, noneMissing, thread)).toMatchObject({ available: true, note: true })
    expect(quotedWords(target)).toBe('Onboarding decisions')
  })

  test('a photo with no caption quotes its name', () => {
    const target = post('t', {
      text: toInertText(''),
      files: [{ fileId: 'f', name: toInertText('hall.jpg'), mediaType: 'image/jpeg', size: 1 }],
    })
    expect(quotedWords(target)).toBe('hall.jpg')
  })

  describe('edited since', () => {
    const edited = post('t', { version: 5, editedAt: '2026-11-04T12:00:00Z' })

    test('only when the edit is later than the reply', () => {
      const later = reply({ writtenAt: '2026-11-04T11:00:00Z' })
      expect(quoteOf(later, [edited], none, noneMissing, thread)).toMatchObject({ changed: true })
      const after = reply({ writtenAt: '2026-11-04T13:00:00Z' })
      expect(quoteOf(after, [edited], none, noneMissing, thread)).toMatchObject({ changed: false })
    })

    test('never because a version moved', () => {
      const pinned = post('t', { version: 9 })
      const named = reply({ inReplyTo: { key: 't', version: 2 }, writtenAt: '2026-11-04T11:00:00Z' })
      expect(quoteOf(named, [pinned], none, noneMissing, thread)).toMatchObject({ changed: false })
    })

    test('not when the reply named the version it shows', () => {
      const named = reply({ inReplyTo: { key: 't', version: 5 }, writtenAt: '2026-11-04T11:00:00Z' })
      expect(quoteOf(named, [edited], none, noneMissing, thread)).toMatchObject({ changed: false })
    })
  })
})

describe('rewroteFrom', () => {
  test('a version by someone other than the first author names the first author', () => {
    expect(rewroteFrom(post('m', { author: ines }), { author: noor })).toBe(noor)
  })
  test("the host's first author counts for a record never seen before", () => {
    expect(rewroteFrom(post('m', { author: ines, createdBy: noor }), undefined)).toBe(noor)
  })
  test('the same author is an edit, and with nothing to compare nothing is said', () => {
    expect(rewroteFrom(post('m', { author: noor }), { author: noor })).toBeUndefined()
    expect(rewroteFrom(post('m', { author: noor }), undefined)).toBeUndefined()
    expect(rewroteFrom(post('m', { author: undefined }), { author: noor })).toBeUndefined()
  })
})

describe('isRemovedMessage', () => {
  test('only a message this screen saw', () => {
    const gone = post('m', { retracted: true })
    expect(isRemovedMessage(gone, { kind: 'message' })).toBe(true)
    expect(isRemovedMessage(gone, { kind: undefined })).toBe(true)
    expect(isRemovedMessage(gone, { kind: 'reaction' })).toBe(false)
    expect(isRemovedMessage(gone, { kind: 'note' })).toBe(false)
    expect(isRemovedMessage(gone, undefined)).toBe(false)
    expect(isRemovedMessage(post('m'), { kind: 'message' })).toBe(false)
  })
})

describe('arrivedLate', () => {
  const at = '2026-11-04T14:20:00Z'
  test('over 24 hours before it arrived, the claimed time is said', () => {
    expect(arrivedLate({ writtenAt: '2026-11-02T09:12:00Z', createdAt: at })).toEqual(new Date('2026-11-02T09:12:00Z'))
  })
  test('at exactly 24 hours and under, nothing is said', () => {
    expect(arrivedLate({ writtenAt: '2026-11-03T14:20:00Z', createdAt: at })).toBeUndefined()
    expect(arrivedLate({ writtenAt: '2026-11-04T11:20:00Z', createdAt: at })).toBeUndefined()
  })
  test('a claimed time in the future is never shown', () => {
    expect(arrivedLate({ writtenAt: '2026-11-09T00:00:00Z', createdAt: at })).toBeUndefined()
  })
  test('with no arrival time, or a bad one, nothing is said', () => {
    expect(arrivedLate({ writtenAt: '2026-11-02T09:12:00Z' })).toBeUndefined()
    expect(arrivedLate({ createdAt: at })).toBeUndefined()
    expect(arrivedLate({ writtenAt: 'soon', createdAt: at })).toBeUndefined()
  })
})

describe('byArrival', () => {
  const when = (iso: string) => ({ at: new Date(iso), createdAt: iso })
  test('newest arrival first once the host says when', () => {
    const late = when('2026-11-04T14:20:00Z')
    const early = when('2026-11-04T10:00:00Z')
    expect(byArrival([early, late])).toEqual([late, early])
  })
  test('with no arrival times the order stays exactly as it was', () => {
    const a = { at: new Date('2026-11-04T10:00:00Z') }
    const b = { at: new Date('2026-11-04T14:00:00Z') }
    expect(byArrival([a, b])).toEqual([a, b])
  })
})

describe('drawnInChat', () => {
  const none = { refused: new Set<string>() }
  test('a message and a note line are drawn; a reaction is not', () => {
    expect(drawnInChat(post('m'), none)).toBe(true)
    expect(drawnInChat(post('n', { title: toInertText('A note') }), none)).toBe(true)
    expect(drawnInChat(reaction('r', 'm', '👍'), none)).toBe(false)
  })
  test('a withdrawn message keeps its place', () => {
    expect(drawnInChat(post('m', { kind: 'message', text: toInertText('') }), none)).toBe(true)
  })
  test('a removed message is drawn only once this screen saw it', () => {
    const gone = post('m', { retracted: true })
    expect(drawnInChat(gone, none, { kind: 'message' })).toBe(true)
    expect(drawnInChat(gone, none)).toBe(false)
  })
  test('a refused version is never drawn', () => {
    expect(drawnInChat(post('m'), { refused: new Set(['m']) })).toBe(false)
  })
})
