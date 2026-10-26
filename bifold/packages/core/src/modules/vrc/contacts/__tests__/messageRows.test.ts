import { DidCommConnectionRecord, DidCommDidExchangeRole, DidCommDidExchangeState } from '@credo-ts/didcomm'

import { NO_CONTACT_LINKS } from '../contactLinks'
import { connectionToOpen, messageRows } from '../messageRows'

const connection = (id: string) =>
  new DidCommConnectionRecord({
    id,
    createdAt: new Date(Date.UTC(2026, 9, 15)),
    state: DidCommDidExchangeState.Completed,
    role: DidCommDidExchangeRole.Requester,
    theirLabel: 'Bob Backer',
  })

// Bob's three exchanges: three connections, three relationship DIDs, merged into the contact of the first.
const [a, b, c] = [connection('conn-a'), connection('conn-b'), connection('conn-c')]
const ada = connection('conn-ada')
const relationshipOf = new Map([
  ['conn-a', 'did:bob:1'],
  ['conn-b', 'did:bob:2'],
  ['conn-c', 'did:bob:3'],
  ['conn-ada', 'did:ada:1'],
])
const merged = new Map([
  ['did:bob:2', 'did:bob:1'],
  ['did:bob:3', 'did:bob:1'],
])
const activity = (times: Record<string, number>) => (conn: DidCommConnectionRecord) => times[conn.id] ?? 0

describe('one row per contact', () => {
  test("a merged contact's connections are one row, showing and opening the newest, carrying every id", () => {
    const rows = messageRows([a, b, c, ada], relationshipOf, merged, activity({ 'conn-b': 300, 'conn-c': 100 }))
    expect(rows.map((r) => r.connection.id)).toEqual(['conn-b', 'conn-ada'])
    expect(rows[0].connectionIds).toEqual(['conn-a', 'conn-b', 'conn-c'])
    expect(rows[1].connectionIds).toEqual(['conn-ada'])
  })

  test('separated again (no links): a row per connection', () => {
    const rows = messageRows([a, b, c], relationshipOf, NO_CONTACT_LINKS, activity({}))
    expect(rows.map((r) => r.connectionIds)).toEqual([['conn-a'], ['conn-b'], ['conn-c']])
  })

  test('the shown connection is one holding unread messages, though another is newer', () => {
    const rows = messageRows([a, b], relationshipOf, merged, activity({ 'conn-a': 100, 'conn-b': 200 }), (conn) =>
      conn.id === 'conn-a' ? 2 : 0
    )
    expect(rows[0].connection.id).toBe('conn-a')
    expect(rows[0].connectionIds).toEqual(['conn-a', 'conn-b'])
  })

  test('a tie keeps the earlier connection, so a row does not flip between equals', () => {
    const rows = messageRows([a, b], relationshipOf, merged, activity({ 'conn-a': 100, 'conn-b': 100 }))
    expect(rows[0].connection.id).toBe('conn-a')
  })

  test("rows keep the order of each contact's first connection", () => {
    const rows = messageRows([ada, a, b], relationshipOf, merged, activity({ 'conn-b': 900 }))
    expect(rows.map((r) => r.key)).toEqual(['contact:did:ada:1', 'contact:did:bob:1'])
  })
})

describe('never hidden', () => {
  test('a connection with no known relationship is its own row', () => {
    const stranger = connection('conn-x')
    const rows = messageRows([a, stranger, b], relationshipOf, merged, activity({}))
    expect(rows.map((r) => r.connectionIds)).toEqual([['conn-a', 'conn-b'], ['conn-x']])
  })

  test('before the relationships are read, every connection is its own row', () => {
    const rows = messageRows([a, b, c], undefined, merged, activity({}))
    expect(rows).toHaveLength(3)
  })
})

describe('which connection to open', () => {
  const at = (times: Record<string, number>) => (id: string) => times[id] ?? 0
  const unread = (counts: Record<string, number>) => (id: string) => counts[id] ?? 0

  test('none unread: the newest', () => {
    expect(connectionToOpen(['a', 'b', 'c'], at({ a: 1, b: 3, c: 2 }), unread({}))).toBe('b')
  })

  test('one unread: that one, whatever is newer', () => {
    expect(connectionToOpen(['a', 'b', 'c'], at({ a: 1, b: 3, c: 2 }), unread({ a: 1 }))).toBe('a')
  })

  test('several unread: the newest of those', () => {
    expect(connectionToOpen(['a', 'b', 'c'], at({ a: 1, b: 3, c: 2 }), unread({ a: 1, c: 5 }))).toBe('c')
  })

  test('a tie keeps the earlier', () => {
    expect(connectionToOpen(['a', 'b'], at({ a: 2, b: 2 }), unread({}))).toBe('a')
  })
})
