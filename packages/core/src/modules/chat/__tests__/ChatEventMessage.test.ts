import { JsonTransformer } from '@credo-ts/core'

import { CHAT_PROFILE } from '../chatEvent'
import type { ChatOutgoingMessageEvent } from '../chatEvent'
import { CHAT_EVENT_MESSAGE_TYPE, ChatEventMessage } from '../messages/ChatEventMessage'

const event: ChatOutgoingMessageEvent = {
  profile: CHAT_PROFILE,
  type: 'message',
  eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9V',
  content: { format: 'text/plain', text: 'hi' },
}

describe('ChatEventMessage', () => {
  it('carries the plan’s message type', () => {
    expect(new ChatEventMessage({ event }).type).toBe(CHAT_EVENT_MESSAGE_TYPE)
    expect(CHAT_EVENT_MESSAGE_TYPE).toBe('https://keyring.berkmancenter.org/chat/1.0/event')
  })

  it('round-trips over DIDComm v1 with the event as its own member', () => {
    const sent = new ChatEventMessage({ id: 'chat-message-0001', event })
    const json = JsonTransformer.toJSON(sent) as Record<string, unknown>
    expect(json['@type']).toBe(CHAT_EVENT_MESSAGE_TYPE)
    expect(json['@id']).toBe('chat-message-0001')
    expect(json.event).toEqual(event)

    const received = JsonTransformer.fromJSON(json, ChatEventMessage)
    expect(received.event).toEqual(event)
  })

  it('packs to a v2 plaintext with the event one level under body', () => {
    expect(new ChatEventMessage({ id: 'chat-message-0002', event }).toV2Plaintext()).toEqual({
      id: 'chat-message-0002',
      type: CHAT_EVENT_MESSAGE_TYPE,
      body: { event },
    })
  })

  it('reads the event back from a v2 body Credo has spread onto the message', () => {
    // Credo normalises a v2 plaintext by spreading `body` next to @type/@id.
    const normalised = { '@type': CHAT_EVENT_MESSAGE_TYPE, '@id': 'chat-message-0003', event }
    const received = JsonTransformer.fromJSON(normalised, ChatEventMessage)
    expect(received.id).toBe('chat-message-0003')
    expect(received.event).toEqual(event)
  })

  it('refuses to pack an inbound instance with no event', () => {
    expect(() => new ChatEventMessage().toV2Plaintext()).toThrow('no event')
  })
})

describe('ChatEventMessage @id', () => {
  it('is the event id, so a problem report threaded to it finds the stored event', () => {
    const event = { profile: 'keyring.chat/1', type: 'message', eventId: '01JB3XKX6F8Q2W4E5R6T7Y8Z9V' } as never
    expect(new ChatEventMessage({ event }).id).toBe('01JB3XKX6F8Q2W4E5R6T7Y8Z9V')
  })

  it('falls back to a generated id when the event has no valid id', () => {
    const message = new ChatEventMessage({ event: { type: 'message', eventId: 'nope' } as never })
    expect(message.id).not.toBe('nope')
    expect(message.id.length).toBeGreaterThanOrEqual(8)
  })
})
