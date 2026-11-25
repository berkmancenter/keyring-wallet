/**
 * A record is read out of its JSON, never drawn as it (IN-725). A note written in a community's web room with a title
 * and no text reached Keyring as a signed `SealedRecordBody` with no `body` member, which its schema allows, and the
 * whole of it, proof and all, was drawn as a chat bubble on the writer's own side.
 */
import { CHAT_PROFILE } from '../../chat/chatEvent'
import { toInertText } from '../inertText'
import { parseRead } from '../real/wire'
import { chatMessageBody, isCutRecordJson, isNote, isRecordJson, placeOf, postOf } from '../roomPosts'
import type { Note } from '../types'

const ROOM = 'did:webvh:QmRoom:dids.example:final-device'
const AUTHOR = 'did:webvh:QmAuthor:dids.example:airport-electric'
const b64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
const decode = (text: string) => Buffer.from(text, 'base64url').toString('utf8')

/** A sealed record's body as a writer signs it: the five members its schema requires, and whatever `over` adds. */
const sealed = (over: Record<string, unknown> = {}) => ({
  author: AUTHOR,
  key: 'note-1',
  proof: {
    cryptosuite: 'eddsa-jcs-2022',
    proofPurpose: 'assertionMethod',
    proofValue: 'z3hF…',
    type: 'DataIntegrityProof',
    verificationMethod: `${AUTHOR}#key-0`,
  },
  roomId: ROOM,
  version: 30,
  ...over,
})
const opened = (plaintext: unknown, text = JSON.stringify(plaintext)) =>
  parseRead({ key: 'note-1', version: 30, status: 'active', author: AUTHOR, plaintext: b64url(text) }, decode)!
const openRoom = (cleartext: Record<string, unknown>) =>
  parseRead({ key: 'note-1', version: 30, status: 'active', author: AUTHOR, cleartext }, decode)!

describe('a sealed record read out of its signed body', () => {
  it('a note with a title and no text is a note with that title and no words, never its JSON', () => {
    const record = opened(sealed({ title: 'Message 1' }))
    expect(record.title).toBe('Message 1')
    expect(record.body).toBe('')
    expect(record.notShown).toBeUndefined()
  })

  it('with words too, as before (control)', () => {
    const record = opened(sealed({ title: 'm2', body: 'The agenda' }))
    expect([record.title, record.body, record.notShown]).toEqual(['m2', 'The agenda', undefined])
  })

  it('words and no title: a message, as before (control)', () => {
    const record = opened(sealed({ body: 'Message written in Keyring' }))
    expect([record.title, record.body, record.notShown]).toEqual([undefined, 'Message written in Keyring', undefined])
  })

  it.each([
    ['only the members a body must have', {}],
    ['a description and tags, which this client shows nowhere', { description: 'About', tags: ['a'] }],
    ['a title that is not text', { title: 7 }],
  ])('%s: nothing to show, said as that, with no words and none of the record', (_, over) => {
    const record = opened(sealed(over))
    expect(record.notShown).toBe(true)
    expect(record.body).toBe('')
    expect(record.title).toBeUndefined()
  })

  it('what the author signed is still handed on for its check, whatever is shown', () => {
    expect(opened(sealed({ title: 'Message 1' })).signedText).toMatchObject({ author: AUTHOR, title: 'Message 1' })
    expect(opened(sealed()).signedText).toMatchObject({ author: AUTHOR })
  })
})

describe("an open room's record", () => {
  it('a title and no text is a note with that title', () => {
    const record = openRoom({ title: 'Minutes' })
    expect([record.title, record.body, record.notShown]).toEqual(['Minutes', '', undefined])
  })

  it('an object that is no record this client knows is not shown as text', () => {
    const record = openRoom({ weather: { high: 21 } })
    expect([record.body, record.notShown]).toEqual(['', true])
  })
})

describe('what is still shown as written', () => {
  it.each([
    ['plain words', 'See you at 6'],
    ['a number', '123'],
    ['a list', '[1,2,3]'],
    ['a quoted word', '"yes"'],
    ['something that only starts like JSON', '{not json'],
  ])('%s', (_, text) => {
    const record = opened(undefined, text)
    expect([record.body, record.notShown]).toEqual([text, undefined])
  })

  it("words that are themselves JSON, inside a record's body", () => {
    const record = opened(sealed({ body: '{"a":1}' }))
    expect([record.body, record.notShown]).toEqual(['{"a":1}', undefined])
  })

  it("this client's own chat event, where a body is one whole: left for the post to read", () => {
    const event = chatMessageBody('Hello', 'e1', new Date('2026-11-25T12:00:00Z'))
    const record = opened(undefined, event)
    expect(record.notShown).toBeUndefined()
    expect(record.body).toBe(event)
  })
})

// For a post's words, in the copy a phone keeps: a whole signed record is told by its own envelope and nothing wider.
describe('isRecordJson', () => {
  it.each([
    ['the reported record: proof, roomId, title, version', JSON.stringify(sealed({ title: 'Message 1' })), true],
    ['one with only what a body must have', JSON.stringify(sealed()), true],
    ['a roomId and a version, no proof', JSON.stringify({ roomId: ROOM, version: 3 }), true],
    ['a proof alone', JSON.stringify({ proof: { type: 'DataIntegrityProof' } }), true],
    ['leading white space', `  ${JSON.stringify(sealed())}`, true],
  ])('%s: a record', (_, text, is) => expect(isRecordJson(text)).toBe(is))

  // Words a person may type as a message: taken for a record, they would be dropped from the copy at every read, and
  // be missing from the room when the phone is offline (review of #1020).
  it.each([
    ['an empty object', '{}'],
    ['an object', '{"a":1}'],
    ['an object with a title', '{"title":"Minutes"}'],
    ['a roomId and no version', JSON.stringify({ roomId: ROOM })],
    ['a version and no roomId', '{"version":3}'],
    ['a proof that is not an object', '{"proof":"of concept"}'],
    ["this client's chat event", JSON.stringify({ profile: CHAT_PROFILE, type: 'message' })],
    ['plain words', 'See you at 6'],
    ['a list', '[1,2,3]'],
    ['a number', '123'],
    ['something that only starts like JSON', '{not json'],
    ['nothing', ''],
  ])('%s: words (control)', (_, text) => expect(isRecordJson(text)).toBe(false))
})

describe('isCutRecordJson, for words cut short that no longer parse', () => {
  const whole = JSON.stringify(sealed({ description: 'x'.repeat(200) }))
  it('the start of a signed record, told by a member it names', () => {
    expect(isCutRecordJson(whole.slice(0, whole.indexOf('"roomId"') + 12))).toBe(true)
    expect(isCutRecordJson(whole.slice(0, whole.indexOf('"proof"') + 10))).toBe(true)
  })

  it.each([
    ['a long story that starts with a brace', `{ ${'so it began '.repeat(20)}`],
    ['JSON a person typed, cut', '{"shopping":["eggs","flour","su'],
    ['words that name roomId without a brace first', 'the "roomId": field is the room'],
  ])('%s: words (control)', (_, text) => expect(isCutRecordJson(text)).toBe(false))
})

describe('as a post', () => {
  const note = (over: Partial<Note>): Note => ({
    key: 'note-1',
    version: 30,
    status: 'active',
    pinned: false,
    body: toInertText(''),
    flags: { containsLink: false, looksLikeInstruction: false },
    check: { verdict: 'consistent', detail: '' },
    ...over,
  })

  it('a title and no words is a note: a line in the chat that opens it, not a bubble', () => {
    const post = postOf(note({ title: toInertText('Message 1') }))
    expect(placeOf(post)).toBe('notes')
    expect(isNote(post)).toBe(true)
    expect(post.notShown).toBeUndefined()
  })

  it('one that cannot be shown says so, and has no words', () => {
    const post = postOf(note({ notShown: true }))
    expect(post.notShown).toBe(true)
    expect(String(post.text)).toBe('')
    expect(placeOf(post)).toBe('chat')
  })

  it('a removed one is only removed (control)', () => {
    expect(postOf(note({ notShown: true, status: 'retracted' })).notShown).toBeUndefined()
  })
})
