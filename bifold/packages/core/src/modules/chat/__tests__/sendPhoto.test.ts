import { DidCommMessageSender } from '@credo-ts/didcomm'
import { EventEmitter, InjectionSymbols } from '@credo-ts/core'
import { Buffer } from 'buffer'

import { MAX_IMAGE_BYTES } from '../media'
import type { PreparedPhoto } from '../media/prepare'
import { removeChatMedia, writeChatMedia } from '../media/store'
import { jpegHeader, paddedTo } from '../media/__tests__/fixtures/images'
import type { ChatEventMessage } from '../messages/ChatEventMessage'
import type { ChatEventRecord } from '../records/ChatEventRecord'
import { ChatPhotoRefusedError, sendChatPhoto, sendChatText } from '../send'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

// The order of the photo's write, the send and the record's save, across all three.
const mockOrder: string[] = []
jest.mock('../media/store', () => ({
  writeChatMedia: jest.fn(async (_c: string, eventId: string) => {
    mockOrder.push('write')
    return `${eventId}.jpg`
  }),
  removeChatMedia: jest.fn(async () => {
    mockOrder.push('remove')
  }),
}))
const write = writeChatMedia as jest.Mock
const remove = removeChatMedia as jest.Mock

function makeAgent(options: { rceVersion?: number; sendFails?: boolean }) {
  const stored: ChatEventRecord[] = []
  const sent: ChatEventMessage[] = []
  const basic: { connectionId: string; text: string }[] = []
  const registrations = new Map<unknown, { useFactory: (c: unknown) => unknown }>()
  const singletons = new Map<unknown, unknown>()
  const container = {
    isRegistered: (token: unknown) => registrations.has(token) || singletons.has(token),
    register: (token: unknown, provider: { useFactory: (c: unknown) => unknown }) => registrations.set(token, provider),
    resolve: (token: unknown): unknown => {
      if (singletons.has(token)) return singletons.get(token)
      const registration = registrations.get(token)
      if (registration) {
        const instance = registration.useFactory(container)
        singletons.set(token, instance)
        return instance
      }
      throw new Error(`fake container cannot resolve ${String(token)}`)
    },
  }
  singletons.set(InjectionSymbols.StorageService, {
    save: async (_ctx: unknown, record: ChatEventRecord) => {
      mockOrder.push('save')
      stored.push(record)
    },
    findByQuery: async () => [],
  })
  singletons.set(EventEmitter, { emit: jest.fn() })
  const messageSender = {
    sendMessage: jest.fn(async (outbound: { message: ChatEventMessage }) => {
      mockOrder.push('send')
      if (options.sendFails) throw new Error('mediator unreachable')
      sent.push(outbound.message)
    }),
  }
  singletons.set(DidCommMessageSender, messageSender)
  singletons.set(RelationshipDidRepository, {
    findByConnectionDid: async () =>
      options.rceVersion === undefined ? null : { counterpartyRceVersion: options.rceVersion },
  })
  const basicSend = jest.fn(async (connectionId: string, text: string) => {
    basic.push({ connectionId, text })
  })
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: { container, resolve: container.resolve },
    modules: {
      didcomm: {
        connections: { getById: async (id: string) => ({ id, theirDid: 'did:peer:them', did: 'did:peer:me' }) },
        basicMessages: { sendMessage: basicSend },
      },
    },
  }
  return { agent: agent as never, stored, sent, basic, messageSender, basicSend }
}

/** A JPEG of `byteCount` bytes whose header says 1600 × 1200, as prepareChatPhoto returns it. */
const photoOf = (byteCount: number, overrides: Partial<PreparedPhoto> = {}): PreparedPhoto => ({
  mediaType: 'image/jpeg',
  base64: Buffer.from(paddedTo(jpegHeader(1600, 1200), byteCount)).toString('base64'),
  byteCount,
  width: 1600,
  height: 1200,
  ...overrides,
})
const FALLBACK = '📷 Photo — update Keyring to see it'

beforeEach(() => {
  mockOrder.length = 0
  write.mockClear()
  remove.mockClear()
})

describe('sendChatPhoto, to a contact that speaks chat', () => {
  it('writes this phone’s copy, sends the photo in the message, then stores a record naming the file', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    const photo = photoOf(200_000)
    const outcome = await sendChatPhoto(fake.agent, 'conn-1', photo, { fallbackText: FALLBACK, caption: ' look ' })
    expect(outcome.carriedAs).toBe('chat')
    expect(mockOrder).toEqual(['write', 'send', 'save'])
    const event = fake.sent[0].event as Record<string, unknown>
    expect(event).toMatchObject({
      type: 'message',
      content: { format: 'text/plain', text: 'look' },
      attachments: [
        {
          id: 'a1',
          mediaType: 'image/jpeg',
          byteCount: 200_000,
          width: 1600,
          height: 1200,
          data: { base64: photo.base64 },
        },
      ],
    })
    expect(write).toHaveBeenCalledWith('conn-1', event.eventId, 'image/jpeg', photo.base64)
    expect(fake.stored[0].attachments).toEqual([
      {
        id: 'a1',
        mediaType: 'image/jpeg',
        byteCount: 200_000,
        width: 1600,
        height: 1200,
        file: `${event.eventId}.jpg`,
      },
    ])
    // What a refusal would resend in its place (notice.ts).
    expect(fake.stored[0].fallbackText).toBe(`${FALLBACK}\n\nlook`)
    expect(JSON.stringify(fake.stored[0])).not.toContain(photo.base64.slice(0, 40))
    expect(fake.basic).toHaveLength(0)
  })

  // No record is stored when the send fails, so nothing would ever lead a deletion to the file written for it.
  it('removes this phone’s copy again when the send fails, and stores nothing', async () => {
    const fake = makeAgent({ rceVersion: 6, sendFails: true })
    await expect(sendChatPhoto(fake.agent, 'conn-1', photoOf(200_000), { fallbackText: FALLBACK })).rejects.toThrow(
      'mediator unreachable'
    )
    const written = await write.mock.results[0].value
    expect(remove).toHaveBeenCalledWith('conn-1', written)
    expect(mockOrder).toEqual(['write', 'send', 'remove'])
    expect(fake.stored).toHaveLength(0)
  })

  it('reports the send’s own error even when removing the copy fails too', async () => {
    const fake = makeAgent({ rceVersion: 6, sendFails: true })
    remove.mockRejectedValueOnce(new Error('EACCES'))
    await expect(sendChatPhoto(fake.agent, 'conn-1', photoOf(200_000), { fallbackText: FALLBACK })).rejects.toThrow(
      'mediator unreachable'
    )
  })

  it('leaves the copy in place when the send succeeds', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    await sendChatPhoto(fake.agent, 'conn-1', photoOf(200_000), { fallbackText: FALLBACK })
    expect(remove).not.toHaveBeenCalled()
  })

  it('sends a photo of exactly the limit', async () => {
    const fake = makeAgent({ rceVersion: 6 })
    await sendChatPhoto(fake.agent, 'conn-1', photoOf(MAX_IMAGE_BYTES), { fallbackText: FALLBACK })
    expect(fake.messageSender.sendMessage).toHaveBeenCalledTimes(1)
  })
})

// An oversize message is accepted by the transport and dropped by the mediator with no error to the sender, so the
// sender's own check is the only one that can say no.
describe('sendChatPhoto refuses before anything is sent or written', () => {
  it.each([
    ['one byte over the limit', photoOf(MAX_IMAGE_BYTES + 1), 'too-large'],
    ['a byteCount that is not its bytes', { ...photoOf(200_000), byteCount: 199_999 }, 'byte-count-mismatch'],
    ['dimensions other than its header’s', photoOf(200_000, { width: 1601 }), 'dimension-mismatch'],
    [
      'a canvas over the cap',
      {
        ...photoOf(200_000),
        base64: Buffer.from(paddedTo(jpegHeader(5000, 10), 200_000)).toString('base64'),
        width: 5000,
        height: 10,
      },
      'too-many-pixels',
    ],
  ])('%s', async (_label, photo, reason) => {
    for (const rceVersion of [6, 5]) {
      const fake = makeAgent({ rceVersion })
      await expect(sendChatPhoto(fake.agent, 'conn-1', photo, { fallbackText: FALLBACK })).rejects.toEqual(
        new ChatPhotoRefusedError(reason as never)
      )
      expect(fake.messageSender.sendMessage).not.toHaveBeenCalled()
      expect(fake.basicSend).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(fake.stored).toHaveLength(0)
    }
  })
})

// Only a photo carries a stand-in: a refused text message resends its own text (notice.ts).
it('stores no fallbackText for a text message', async () => {
  const fake = makeAgent({ rceVersion: 6 })
  await sendChatText(fake.agent, 'conn-1', 'hello')
  expect(fake.stored[0].fallbackText).toBeUndefined()
})

describe('sendChatPhoto, to a contact without chat (271 and older)', () => {
  it('sends the fallback text as a plain message, with the caption after it, and writes nothing', async () => {
    const fake = makeAgent({ rceVersion: 5 })
    const outcome = await sendChatPhoto(fake.agent, 'conn-1', photoOf(200_000), {
      fallbackText: FALLBACK,
      caption: 'look',
    })
    expect(outcome).toEqual({ carriedAs: 'basic' })
    expect(fake.basic).toEqual([{ connectionId: 'conn-1', text: `${FALLBACK}\n\nlook` }])
    expect(fake.messageSender.sendMessage).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
