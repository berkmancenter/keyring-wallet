import { JsonTransformer } from '@credo-ts/core'
import { DidCommMessageSender } from '@credo-ts/didcomm'

import { counterpartySpeaksChat } from '../capability'
import { expiredIds, forgetExpired, MAX_EXPIRED_KEPT, recordExpired } from '../expired'
import { ChatEventRecord } from '../records/ChatEventRecord'
import { sendChatText, setChatTimer } from '../send'
import { chatEventsShown } from '../shown'
import { MAX_TIMER_VERSION } from '../chatEvent'
import { nextTimerVersion, timerOf } from '../timer'

const mockRecords: ChatEventRecord[] = []
const mockUpdate = jest.fn(async (_ctx: unknown, _record: ChatEventRecord) => undefined)
jest.mock('../ChatModule', () => ({
  getChatEventRepository: () => ({
    findByConnection: async (_ctx: unknown, connectionId: string) =>
      mockRecords.filter((r) => r.connectionId === connectionId),
    findEvent: async (_ctx: unknown, connectionId: string, role: string, eventId: string) =>
      mockRecords.find((r) => r.connectionId === connectionId && r.role === role && r.eventId === eventId) ?? null,
    save: async (_ctx: unknown, record: ChatEventRecord) => {
      mockRecords.push(record)
    },
    update: mockUpdate,
  }),
}))
jest.mock('../capability', () => ({ counterpartySpeaksChat: jest.fn(async () => true) }))

const mockStore = new Map<string, unknown>()
jest.mock('../../../services/storage', () => ({
  PersistentStorage: {
    fetchValueForKey: async (k: string) => mockStore.get(k),
    storeValueForKey: async (k: string, v: unknown) => void mockStore.set(k, v),
    removeValueForKey: async (k: string) => void mockStore.delete(k),
  },
}))

const sent: { event: Record<string, unknown> }[] = []
const agent = {
  context: {},
  modules: { didcomm: { connections: { getById: async (id: string) => ({ id }) } } },
  dependencyManager: {
    container: {
      resolve: (token: unknown) => {
        if (token === DidCommMessageSender)
          return {
            sendMessage: async (o: { message: { event: Record<string, unknown> } }) => void sent.push(o.message),
          }
        throw new Error('unexpected token')
      },
    },
  },
} as never

const T0 = new Date('2026-10-25T12:00:00.000Z')
const WEEK = 604800

const timerEvent = (eventId: string, version: number, expiresIn: number, role: 'sent' | 'received' = 'received') =>
  new ChatEventRecord({ connectionId: 'c1', role, eventId, eventType: 'timer', timer: { expiresIn, version } })
const received = (eventId: string, expiresIn?: number) =>
  new ChatEventRecord({
    connectionId: 'c1',
    role: 'received',
    eventId,
    eventType: 'message',
    content: { format: 'text/plain', text: 'hi' },
    ...(expiresIn ? { expiresIn } : {}),
  })

beforeEach(() => {
  mockRecords.length = 0
  sent.length = 0
  mockStore.clear()
  jest.clearAllMocks()
  jest.useFakeTimers({ now: T0 })
})
afterEach(() => jest.useRealTimers())

describe('the chat timer', () => {
  test('a chat never set has no timer', () => {
    expect(timerOf([received('01JB0000000000000000000001')])).toBeNull()
  })

  test('the highest version wins, ties broken by eventId, whatever order the events arrived in', () => {
    const a = timerEvent('01JB0000000000000000000001', 2, 3600, 'sent')
    const b = timerEvent('01JB0000000000000000000002', 3, 86400)
    const c = timerEvent('01JB0000000000000000000003', 3, WEEK)
    for (const order of [
      [a, b, c],
      [c, b, a],
      [b, a, c],
    ]) {
      expect(timerOf(order)).toEqual({ expiresIn: WEEK, version: 3, eventId: c.eventId, setBy: 'received' })
    }
    expect(nextTimerVersion([a, b, c])).toBe(4)
  })

  test('turning it off is a timer of 0, which wins like any other change', () => {
    expect(
      timerOf([timerEvent('01JB0000000000000000000001', 1, WEEK), timerEvent('01JB0000000000000000000002', 2, 0)])
        ?.expiresIn
    ).toBe(0)
  })

  test('setChatTimer sends the next version, and refuses a value the setting does not offer', async () => {
    mockRecords.push(timerEvent('01JB0000000000000000000009', 4, 3600))
    const outcome = await setChatTimer(agent, 'c1', WEEK)
    expect(outcome.carriedAs).toBe('chat')
    expect(sent[0].event).toMatchObject({ type: 'timer', timer: { expiresIn: WEEK, version: 5 } })
    await expect(setChatTimer(agent, 'c1', 1234)).rejects.toThrow('not a timer choice')
  })

  test('a peer timer at the version cap does not lock the setting: this phone still changes it, and its change wins', async () => {
    mockRecords.push(timerEvent('01JB0000000000000000000001', MAX_TIMER_VERSION, 3600))
    const outcome = await setChatTimer(agent, 'c1', WEEK)
    expect(outcome.carriedAs).toBe('chat')
    expect(sent[0].event).toMatchObject({ type: 'timer', timer: { expiresIn: WEEK, version: MAX_TIMER_VERSION } })
    // Both phones hold both events; the tie on version goes to the later eventId, which is this phone's change.
    expect(timerOf(mockRecords)).toMatchObject({ expiresIn: WEEK, setBy: 'sent' })
  })

  test('a contact without chat cannot be given a timer: nothing is sent', async () => {
    ;(counterpartySpeaksChat as jest.Mock).mockResolvedValueOnce(false)
    expect((await setChatTimer(agent, 'c1', WEEK)).carriedAs).toBe('not-sent')
    expect(sent).toHaveLength(0)
  })
})

describe('messages under a timer', () => {
  test('a message carries the timer it was sent with, and the sender starts its clock at send', async () => {
    mockRecords.push(timerEvent('01JB0000000000000000000001', 1, WEEK))
    const outcome = await sendChatText(agent, 'c1', 'hello')
    expect(sent[0].event).toMatchObject({ type: 'message', expiresIn: WEEK })
    const record = (outcome as { record: ChatEventRecord }).record
    expect(record.expiresIn).toBe(WEEK)
    expect(record.expiresAt).toEqual(new Date(T0.getTime() + WEEK * 1000))
  })

  test('a later timer change does not touch a message already sent', async () => {
    mockRecords.push(timerEvent('01JB0000000000000000000001', 1, WEEK))
    const first = ((await sendChatText(agent, 'c1', 'one')) as { record: ChatEventRecord }).record
    mockRecords.push(timerEvent('01JB0000000000000000000002', 2, 3600))
    const second = ((await sendChatText(agent, 'c1', 'two')) as { record: ChatEventRecord }).record
    expect([first.expiresIn, second.expiresIn]).toEqual([WEEK, 3600])
  })

  test('with the timer off, a message carries no expiry', async () => {
    mockRecords.push(timerEvent('01JB0000000000000000000001', 1, 0))
    await sendChatText(agent, 'c1', 'plain')
    expect(sent[0].event.expiresIn).toBeUndefined()
  })
})

describe("the recipient's clock starts at first display (D4)", () => {
  test('not when the message arrives, but when it is first shown', async () => {
    const m = received('01JB0000000000000000000001', WEEK)
    mockRecords.push(m)
    expect(m.expiresAt).toBeUndefined()
    jest.setSystemTime(new Date(T0.getTime() + 3 * 3600 * 1000)) // read three hours after it arrived
    await chatEventsShown(agent, 'c1', [m.eventId])
    expect(m.expiresAt).toEqual(new Date(T0.getTime() + 3 * 3600 * 1000 + WEEK * 1000))
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  test('a second report changes nothing; an untimed message and an unknown id are left alone', async () => {
    const m = received('01JB0000000000000000000001', WEEK)
    const untimed = received('01JB0000000000000000000002')
    mockRecords.push(m, untimed)
    await chatEventsShown(agent, 'c1', [m.eventId])
    const first = m.expiresAt
    jest.setSystemTime(new Date(T0.getTime() + 60_000))
    await chatEventsShown(agent, 'c1', [m.eventId, untimed.eventId, '01JB0000000000000000000099'])
    expect(m.expiresAt).toEqual(first)
    expect(untimed.expiresAt).toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  test('a failed write rejects, so the screen reports the message again', async () => {
    mockRecords.push(received('01JB0000000000000000000001', WEEK))
    mockUpdate.mockRejectedValueOnce(new Error('the store could not be written'))
    await expect(chatEventsShown(agent, 'c1', ['01JB0000000000000000000001'])).rejects.toThrow('could not be written')
  })

  test('expiresAt survives a storage round trip as a Date', () => {
    const m = received('01JB0000000000000000000001', WEEK)
    m.expiresAt = new Date(T0.getTime() + WEEK * 1000)
    const back = JsonTransformer.deserialize(JsonTransformer.serialize(m), ChatEventRecord)
    expect(back.expiresAt).toBeInstanceOf(Date)
    expect(back.expiresAt?.getTime()).toBe(m.expiresAt.getTime())
  })
})

describe('expired originals', () => {
  test('are remembered per chat, newest kept, and forgotten when the chat is cleared', async () => {
    await recordExpired('c1', ['A', 'B'])
    await recordExpired('c1', ['B', 'C'])
    expect([...(await expiredIds(agent, 'c1'))]).toEqual(['A', 'B', 'C'])
    expect((await expiredIds(agent, 'c2')).size).toBe(0)
    await recordExpired(
      'c1',
      Array.from({ length: MAX_EXPIRED_KEPT }, (_, i) => `X${i}`)
    )
    const kept = await expiredIds(agent, 'c1')
    expect(kept.size).toBe(MAX_EXPIRED_KEPT)
    expect(kept.has('A')).toBe(false)
    await forgetExpired('c1')
    expect((await expiredIds(agent, 'c1')).size).toBe(0)
  })
})
