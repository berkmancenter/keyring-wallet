/**
 * Replies and reactions, as the writer's rule allows them (`real/recordWrites.ts`, `sendRecord`): nothing is sealed or
 * sent unless the room's profile lists what a body uses, and a build where sending isn't switched on sends nothing.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { RecordMembersNotPermitted, RecordSendingOff, type RecordWrite } from '../real/recordWrites'
import { ROOMS_TASK } from '../real/wire'
import { NOTE_BODY_MAX, RoomsRefused, RoomsUnavailable } from '../types'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const HOST = COMMUNITY.did
const ROOM = 'did:webvh:room:attributed1'
const OPEN_ROOM = 'did:webvh:room:open1'
const PRIVATE_ROOM = 'did:webvh:room:private1'
const ME = COMMUNITY.personaDid
const SOMEONE = 'did:key:someone-else'
const NOW = 1_800_000_000_000
const NOW_ISO = new Date(NOW).toISOString()
const EARLIER = '2026-11-01T10:00:00.000Z'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

const ALL = ['kind', 'inReplyTo', 'writtenAt', 'editedAt']
const SERVED = [
  ROOMS_TASK.keysList02,
  ROOMS_TASK.keysBrowse,
  ROOMS_TASK.keysRead,
  ROOMS_TASK.keysAct06,
  ROOMS_TASK.keysSeal02,
  ROOMS_TASK.keysSeal03,
  ROOMS_TASK.keysProfileRead,
]

interface Prior {
  version: number
  author?: string
  status?: string
  body: Record<string, unknown>
}

interface Setup {
  served?: string[]
  /** What the room's profile lists; `undefined`: no profile. */
  listed?: string[]
  /** Overrides the profile task's answer. */
  profile?: () => unknown
  records?: Record<string, Prior>
  head?: number
  recordSending?: boolean
}

function setup(o: Setup = {}) {
  const state = { epoch: 3 }
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: state.epoch, earliestReadableEpoch: 0, member: ME }] }
      case ROOMS_TASK.keysBrowse:
        return { records: o.head ? [{ key: 'note/older', version: o.head }] : [] }
      case ROOMS_TASK.keysProfileRead:
        if (o.profile) return o.profile()
        return o.listed
          ? { roomId: ROOM, status: 'found', profile: { name: 'Room', recordMembers: o.listed } }
          : { roomId: ROOM, status: 'absent' }
      case ROOMS_TASK.keysSeal02:
      case ROOMS_TASK.keysSeal03:
        return { sealed: { ciphertext: `sealed:${String(payload.plaintext)}`, nonce: 'nonce', epoch: state.epoch } }
      case ROOMS_TASK.keysRead: {
        const record = o.records?.[String(payload.key)]
        if (!record) throw new Error('notFound')
        return {
          key: payload.key,
          version: record.version,
          status: record.status ?? 'active',
          author: record.author ?? ME,
          plaintext: b64url(JSON.stringify(record.body)),
        }
      }
      case ROOMS_TASK.keysAct06: {
        const document = payload.document as Record<string, unknown>
        return {
          principal: ME,
          document: {
            ...document,
            issuer: ME,
            payload: { ...(document.payload as Record<string, unknown>), presentation: { type: 'presentation' } },
            proof: { type: 'DataIntegrityProof' },
          },
        }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const communityTask = jest.fn(
    async (): Promise<unknown> => ({
      items: [
        { roomId: ROOM, host: HOST, visibility: 'attributed', actions: ['read', 'write'], state: 'admitted' },
        { roomId: OPEN_ROOM, host: HOST, visibility: 'open', actions: ['read', 'write'], state: 'admitted' },
        { roomId: PRIVATE_ROOM, host: HOST, visibility: 'private', actions: ['read', 'write'], state: 'admitted' },
      ],
    })
  )
  const sendCompleted = jest.fn(async (_did: string, _to: string, document: Record<string, unknown>) => {
    const payload = document.payload as { key: string; sealed?: { ciphertext: string } }
    return { key: payload.key, version: (o.head ?? 0) + 1, epoch: state.epoch }
  })
  let ids = 0
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => o.served ?? SERVED,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask,
    sendCompleted,
    newId: () => `opaque-${++ids}`,
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: unb64,
    encodeBase64Url: b64url,
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    recordSending: o.recordSending ?? true,
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b, undefined, { now: () => NOW })
  const tasks = (type: string) => agentTask.mock.calls.filter(([t]) => t === type)
  const sealedBody = () => {
    const [[type, payload]] = agentTask.mock.calls.filter(
      ([t]) => t === ROOMS_TASK.keysSeal02 || t === ROOMS_TASK.keysSeal03
    )
    return { type, body: JSON.parse(unb64(String(payload.plaintext))) as Record<string, unknown> }
  }
  return { service, agentTask, sendCompleted, state, tasks, sealedBody }
}

const expectNothingWritten = (s: ReturnType<typeof setup>) => {
  expect(s.tasks(ROOMS_TASK.keysSeal02)).toHaveLength(0)
  expect(s.tasks(ROOMS_TASK.keysSeal03)).toHaveLength(0)
  expect(s.sendCompleted).not.toHaveBeenCalled()
}

const send = (s: ReturnType<typeof setup>, write: RecordWrite) => s.service.sendRecord(ROOM, write)

describe('what a room lets its member write', () => {
  it('control: reads what the profile lists, and that the agent seals it', async () => {
    const s = setup({ listed: ['kind', 'writtenAt'] })
    expect(await s.service.recordFeaturesIn(ROOM)).toEqual({
      listed: ['kind', 'writtenAt'],
      canSeal: true,
      unresolved: false,
    })
  })

  it.each([
    ['no profile', { roomId: ROOM, status: 'absent' }],
    ['a cleared profile', { roomId: ROOM, status: 'cleared' }],
    ['a profile listing none', { roomId: ROOM, status: 'found', profile: { name: 'Room' } }],
    ['an answer that does not read', { status: 'found', profile: { recordMembers: 'kind' } }],
    ['a cleared profile that still names members', { status: 'cleared', profile: { recordMembers: ['kind'] } }],
    ['an absent profile that still names members', { status: 'absent', profile: { recordMembers: ['kind'] } }],
  ])('%s lists nothing', async (_, answer) => {
    const s = setup({ profile: () => answer })
    expect((await s.service.recordFeaturesIn(ROOM)).listed).toEqual([])
  })

  it('reads the profile once per room epoch, and again when the epoch moves', async () => {
    const s = setup({ listed: ['kind'] })
    await s.service.recordFeaturesIn(ROOM)
    await s.service.recordFeaturesIn(ROOM)
    expect(s.tasks(ROOMS_TASK.keysProfileRead)).toHaveLength(1)
    s.state.epoch = 4
    await s.service.recordFeaturesIn(ROOM)
    expect(s.tasks(ROOMS_TASK.keysProfileRead)).toHaveLength(2)
  })

  it('a lock forgets what it read', async () => {
    const s = setup({ listed: ['kind'] })
    await s.service.recordFeaturesIn(ROOM)
    s.service.dropOpenedRecords()
    await s.service.recordFeaturesIn(ROOM)
    expect(s.tasks(ROOMS_TASK.keysProfileRead)).toHaveLength(2)
  })

  it('a profile that could not be read permits none, says so, and is asked again', async () => {
    let fail = true
    const s = setup({
      profile: () => {
        if (fail) throw new Error('hostUnreachable')
        return { roomId: ROOM, status: 'found', profile: { name: 'Room', recordMembers: ['kind'] } }
      },
    })
    expect(await s.service.recordFeaturesIn(ROOM)).toEqual({ listed: [], canSeal: true, unresolved: true })
    fail = false
    expect((await s.service.recordFeaturesIn(ROOM)).listed).toEqual(['kind'])
  })

  it('an agent that serves neither says so, and is asked nothing', async () => {
    const s = setup({ served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal03 && t !== ROOMS_TASK.keysProfileRead) })
    expect(await s.service.recordFeaturesIn(ROOM)).toEqual({ listed: [], canSeal: false, unresolved: false })
    expect(s.tasks(ROOMS_TASK.keysProfileRead)).toHaveLength(0)
  })
})

describe('sending is off', () => {
  it('sends nothing, reads nothing, until it is switched on', async () => {
    const s = setup({ listed: ALL, recordSending: false })
    await expect(send(s, { type: 'message', body: 'hello' })).rejects.toBeInstanceOf(RecordSendingOff)
    await expect(send(s, { type: 'reaction', value: '👍', target: { key: 'm1' } })).rejects.toBeInstanceOf(
      RecordSendingOff
    )
    expect(s.agentTask).not.toHaveBeenCalled()
    expect(s.sendCompleted).not.toHaveBeenCalled()
  })

  it('says so up front, so a screen asks nothing of the room; on only where the backend says (control)', () => {
    const off = setup({ listed: ALL, recordSending: false })
    expect(off.service.recordSendingOn()).toBe(false)
    expect(off.agentTask).not.toHaveBeenCalled()
    expect(setup({ listed: ALL }).service.recordSendingOn()).toBe(true)
  })

  it('the real backend does not switch it on', () => {
    const source = readFileSync(join(__dirname, '../real/agentRoomsBackend.ts'), 'utf8')
    expect(source).toContain('resolveSender') // control: this is the file that builds the real backend
    expect(source).not.toContain('recordSending')
  })
})

describe('a message', () => {
  const PLAIN = { roomId: ROOM, key: 'opaque-1', version: 1, author: ME, body: 'hello' }

  it('with nothing listed is exactly today’s sealed post', async () => {
    const s = setup()
    await send(s, { type: 'message', body: 'hello' })
    expect(s.sealedBody().body).toEqual(PLAIN)
  })

  it('a plain body goes at seal 0.2 wherever the agent serves it, as today, and is refused where it serves no 0.2', async () => {
    const both = setup()
    await send(both, { type: 'message', body: 'hello' })
    expect(both.sealedBody()).toEqual({ type: ROOMS_TASK.keysSeal02, body: PLAIN })

    const older = setup({ served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal03) })
    await send(older, { type: 'message', body: 'hello' })
    expect(older.sealedBody()).toEqual({ type: ROOMS_TASK.keysSeal02, body: PLAIN })

    // As main refuses it: never written at 0.3 unwatched, and the version it needs is named.
    const only03 = setup({ served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal02) })
    await expect(send(only03, { type: 'message', body: 'hello' })).rejects.toBeInstanceOf(RoomsUnavailable)
    expectNothingWritten(only03)
    const caps = await only03.service.roomCapabilities(ROOM)
    expect(caps.write).toEqual({
      status: 'unavailable',
      reason: 'agentDoesNotServe',
      detail: `the agent does not serve ${ROOMS_TASK.keysSeal02}`,
    })
  })

  it('a note written the existing way still goes at seal 0.2 on an agent serving both, its body unchanged', async () => {
    const s = setup({ recordSending: false })
    const preview = await s.service.prepareWrite(ROOM, { title: 'Agenda', body: 'Bring seeds' })
    await s.service.confirmWrite(preview.token)
    expect(s.sealedBody().type).toBe(ROOMS_TASK.keysSeal02)
    expect(s.sealedBody().body).toEqual({
      roomId: ROOM,
      key: 'opaque-1',
      version: 1,
      author: ME,
      title: 'Agenda',
      body: 'Bring seeds',
    })
  })

  it('an agent serving no seal that signs as the member can’t write at all', async () => {
    const s = setup({ served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal02 && t !== ROOMS_TASK.keysSeal03) })
    await expect(send(s, { type: 'message', body: 'hello' })).rejects.toBeInstanceOf(RoomsUnavailable)
    expectNothingWritten(s)
  })

  it('carries what the room lists, and only that', async () => {
    const s = setup({ listed: ['kind'] })
    await send(s, { type: 'message', body: 'hello' })
    expect(s.sealedBody().body).toEqual({
      roomId: ROOM,
      key: 'opaque-1',
      version: 1,
      author: ME,
      body: 'hello',
      kind: 'message',
    })
    expect(s.sealedBody().type).toBe(ROOMS_TASK.keysSeal03)
  })

  it('carries when it was written, in the schema’s form', async () => {
    const s = setup({ listed: ['kind', 'writtenAt'] })
    await send(s, { type: 'message', body: 'hello' })
    expect(s.sealedBody().body.writtenAt).toBe(NOW_ISO)
    expect(NOW_ISO).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$/)
  })

  it('an agent that can’t seal the members sends it plain, even in a room that lists them', async () => {
    const s = setup({ listed: ALL, served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal03) })
    await send(s, { type: 'message', body: 'hello' })
    expect(s.sealedBody().type).toBe(ROOMS_TASK.keysSeal02)
    expect(s.sealedBody().body).not.toHaveProperty('kind')
  })

  it('a profile that can’t be read sends it plain', async () => {
    const s = setup({
      profile: () => {
        throw new Error('hostUnreachable')
      },
    })
    await send(s, { type: 'message', body: 'hello' })
    expect(s.sealedBody().body).not.toHaveProperty('kind')
  })
})

describe("a message's words", () => {
  // An empty message reads as a withdrawn one; a post's own path refuses both of these, and so does this one.
  it.each([
    ['empty', 'message', 'no text', ''],
    ['empty', 'message', 'only spaces and a line break', '  \n '],
    ['tooLong', 'message', 'one character over the limit', 'x'.repeat(NOTE_BODY_MAX + 1)],
    ['empty', 'edit', 'only a space', ' '],
    ['tooLong', 'edit', 'one character over the limit', 'x'.repeat(NOTE_BODY_MAX + 1)],
  ])('refused as %s: the %s, with %s, sends nothing', async (reason, type, _what, body) => {
    const s = setup({ listed: ALL })
    const write = (type === 'edit' ? { type, key: 'm9', body } : { type, body }) as RecordWrite
    await expect(send(s, write)).rejects.toMatchObject({ name: 'RoomsRefused', code: reason })
    expectNothingWritten(s)
    expect(s.agentTask).not.toHaveBeenCalled()
  })

  it('control: a message at exactly the limit goes', async () => {
    const s = setup({ listed: ALL })
    await send(s, { type: 'message', body: 'x'.repeat(NOTE_BODY_MAX) })
    expect(s.sendCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('a reply', () => {
  const reply: RecordWrite = { type: 'message', body: 'yes', inReplyTo: { key: 'm1', version: 2 } }

  it('names what it answers when the room lists it', async () => {
    const s = setup({ listed: ALL })
    await send(s, reply)
    expect(s.sealedBody().body).toMatchObject({ kind: 'message', inReplyTo: { key: 'm1', version: 2 }, body: 'yes' })
    expect(s.sealedBody().type).toBe(ROOMS_TASK.keysSeal03)
  })

  it('is refused, not sent without its target, when the room does not list it', async () => {
    const s = setup({ listed: ['kind', 'writtenAt'] })
    const error = await send(s, reply).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RecordMembersNotPermitted)
    expect((error as RecordMembersNotPermitted).refused).toEqual(['inReplyTo'])
    expectNothingWritten(s)
  })

  it('is refused by an agent that can’t seal it', async () => {
    const s = setup({ listed: ALL, served: SERVED.filter((t) => t !== ROOMS_TASK.keysSeal03) })
    await expect(send(s, reply)).rejects.toBeInstanceOf(RecordMembersNotPermitted)
    expectNothingWritten(s)
  })
})

describe('a reaction', () => {
  const like: RecordWrite = { type: 'reaction', value: '👍', target: { key: 'm1' } }

  it('is a record of kind reaction, its value in the body, under a key that says nothing', async () => {
    const s = setup({ listed: ALL })
    const { key } = await send(s, like)
    expect(s.sealedBody().body).toMatchObject({
      kind: 'reaction',
      inReplyTo: { key: 'm1' },
      body: '👍',
      writtenAt: NOW_ISO,
    })
    expect(key).toBe('opaque-1')
    expect(s.sealedBody().type).toBe(ROOMS_TASK.keysSeal03)
  })

  it.each([
    ['nothing listed', undefined, ['kind', 'inReplyTo', 'writtenAt']],
    ['only kind listed', ['kind'], ['inReplyTo', 'writtenAt']],
    ['all but when', ['kind', 'inReplyTo'], ['writtenAt']],
  ])('has no fallback with %s', async (_, listed, refused) => {
    const s = setup({ listed })
    const error = await send(s, like).catch((e: unknown) => e)
    expect((error as RecordMembersNotPermitted).refused).toEqual(refused)
    expectNothingWritten(s)
  })

  it('a profile that could not be read permits none', async () => {
    const s = setup({
      profile: () => {
        throw new Error('hostUnreachable')
      },
    })
    const error = await send(s, like).catch((e: unknown) => e)
    expect((error as RecordMembersNotPermitted).features.unresolved).toBe(true)
    expectNothingWritten(s)
  })

  it.each([
    ['empty', ''],
    ['white space', '   '],
    ['two lines', 'a\nb'],
    ['a form feed', 'a\fb'],
    ['over 64 code points', 'x'.repeat(65)],
  ])('a value that is %s is not sent', async (_, value) => {
    const s = setup({ listed: ALL })
    await expect(send(s, { type: 'reaction', value, target: { key: 'm1' } })).rejects.toBeInstanceOf(RangeError)
    expectNothingWritten(s)
  })
})

describe('a new version', () => {
  const REACTION: Prior = {
    version: 4,
    body: {
      roomId: ROOM,
      key: 'r1',
      version: 4,
      author: ME,
      kind: 'reaction',
      inReplyTo: { key: 'm1' },
      writtenAt: EARLIER,
      body: '👍',
    },
  }
  const MESSAGE: Prior = {
    version: 4,
    body: {
      roomId: ROOM,
      key: 'm9',
      version: 4,
      author: ME,
      kind: 'message',
      inReplyTo: { key: 'm1' },
      writtenAt: EARLIER,
      body: 'first',
    },
  }
  const records = { r1: REACTION, m9: MESSAGE }
  const putPayload = (s: ReturnType<typeof setup>) =>
    (s.sendCompleted.mock.calls[0][2] as { payload: Record<string, unknown> }).payload

  it('changing a reaction is one write to the same key, keeping its kind, target and time', async () => {
    const s = setup({ listed: ALL, records, head: 4 })
    await send(s, { type: 'changeReaction', key: 'r1', value: '❤️' })
    expect(s.sealedBody().body).toMatchObject({
      key: 'r1',
      version: 5,
      kind: 'reaction',
      inReplyTo: { key: 'm1' },
      writtenAt: EARLIER,
      editedAt: NOW_ISO,
      body: '❤️',
    })
    expect(putPayload(s)).toMatchObject({ key: 'r1', expectedVersion: 4 })
    expect(s.sendCompleted).toHaveBeenCalledTimes(1)
  })

  it('withdrawing a reaction is an empty version that keeps its target', async () => {
    const s = setup({ listed: ALL, records, head: 4 })
    await send(s, { type: 'withdraw', key: 'r1' })
    expect(s.sealedBody().body).toMatchObject({ key: 'r1', kind: 'reaction', inReplyTo: { key: 'm1' }, body: '' })
  })

  it('withdrawing a message is an empty version with no file', async () => {
    const s = setup({ listed: ALL, records, head: 4 })
    await send(s, { type: 'withdraw', key: 'm9' })
    const { body } = s.sealedBody()
    expect(body).toMatchObject({ key: 'm9', kind: 'message', inReplyTo: { key: 'm1' }, writtenAt: EARLIER, body: '' })
    expect(body).not.toHaveProperty('file')
  })

  it('an edit keeps when it was written and says when it was edited', async () => {
    const s = setup({ listed: ALL, records, head: 4 })
    await send(s, { type: 'edit', key: 'm9', body: 'second' })
    expect(s.sealedBody().body).toMatchObject({
      kind: 'message',
      writtenAt: EARLIER,
      editedAt: NOW_ISO,
      body: 'second',
    })
  })

  it('says it was edited only where the room lists that', async () => {
    const s = setup({ listed: ['kind', 'inReplyTo', 'writtenAt'], records, head: 4 })
    await send(s, { type: 'edit', key: 'm9', body: 'second' })
    expect(s.sealedBody().body).not.toHaveProperty('editedAt')
  })

  it('is refused when the room stopped listing what the record carries, rather than dropping it', async () => {
    const s = setup({ listed: ['kind'], records, head: 4 })
    await expect(send(s, { type: 'edit', key: 'm9', body: 'second' })).rejects.toBeInstanceOf(RecordMembersNotPermitted)
    expectNothingWritten(s)
  })

  it.each<[string, RecordWrite, string]>([
    ['someone else’s record', { type: 'edit', key: 'theirs', body: 'x' }, 'notYours'],
    ['a removed record', { type: 'withdraw', key: 'gone' }, 'retracted'],
    ['a value on a message', { type: 'changeReaction', key: 'm9', value: '👍' }, 'notThatKind'],
    ['an edit of a reaction', { type: 'edit', key: 'r1', body: 'x' }, 'notThatKind'],
    ['a withdrawal of a note', { type: 'withdraw', key: 'n1' }, 'notThatKind'],
    ['an edit of a record with no kind', { type: 'edit', key: 'n1', body: 'x' }, 'notThatKind'],
  ])('refuses %s', async (_, write, code) => {
    const s = setup({
      listed: ALL,
      head: 4,
      records: {
        ...records,
        theirs: { ...MESSAGE, author: SOMEONE },
        gone: { ...MESSAGE, status: 'retracted' },
        n1: { version: 4, body: { title: 'Note', body: 'text' } },
      },
    })
    const error = await send(s, write).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoomsRefused)
    expect((error as RoomsRefused).code).toBe(code)
    expectNothingWritten(s)
  })

  it('a value that would read as a withdrawal is not a change', async () => {
    const s = setup({ listed: ALL, records, head: 4 })
    await expect(send(s, { type: 'changeReaction', key: 'r1', value: ' ' })).rejects.toBeInstanceOf(RangeError)
    expectNothingWritten(s)
  })
})

describe('where it is built', () => {
  it('an open room is refused: this path is for attributed rooms', async () => {
    const s = setup({ listed: ALL })
    const error = await s.service.sendRecord(OPEN_ROOM, { type: 'message', body: 'hello' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RoomsRefused)
    expect((error as RoomsRefused).code).toBe('tierNotYet')
    expectNothingWritten(s)
  })

  it('a private room is refused before that, as any write there is', async () => {
    const s = setup({ listed: ALL })
    await expect(s.service.sendRecord(PRIVATE_ROOM, { type: 'message', body: 'hello' })).rejects.toBeInstanceOf(
      RoomsUnavailable
    )
    expectNothingWritten(s)
  })
})
