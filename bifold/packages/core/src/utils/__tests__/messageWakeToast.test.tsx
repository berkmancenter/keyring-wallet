/**
 * A tapped message notification, and the in-app message toast
 * (InAppMessageNotifier): a message that lands while the tap is being resolved
 * is not toasted for the chat the tap then opens, and a message for anyone
 * else still is. Before, the chat opened only after the toast had fired, so the
 * person saw a toast on top of the notification they had just tapped.
 */
import { RepositoryEventTypes } from '@credo-ts/core'
import { DidCommBasicMessageEventTypes } from '@credo-ts/didcomm'
import { useAgent } from '@bifold/react-hooks'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import InAppMessageNotifier from '../../components/InAppMessageNotifier'
import { ChatEventRecord } from '../../modules/chat/records/ChatEventRecord'
import { setActiveChatConnectionId } from '../activeChatTracker'
import { messageWakeHold, openMessageWake, type MessageWakeDeps } from '../messageWake'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn(), hide: jest.fn() } }))

type Handler = (event: { payload: { basicMessageRecord?: unknown; record?: unknown } }) => Promise<void>
const handlers: { type: string; handler: Handler }[] = []
const agent = {
  events: {
    on: (type: string, handler: Handler) => handlers.push({ type, handler }),
    off: jest.fn(),
  },
  modules: { didcomm: { connections: { findById: async (id: string) => ({ id, theirLabel: id }) } } },
  w3cCredentials: { getAll: async () => [] },
}
const received = (connectionId: string, content: string) => ({
  payload: {
    basicMessageRecord: {
      connectionId,
      content,
      role: 'receiver',
      createdAt: new Date(),
      metadata: { get: () => undefined },
    },
  },
})
/** A received v1 basic message: only the handlers for that event type hear it, as in Credo. */
const deliver = async (connectionId: string, content: string) => {
  for (const { type, handler } of [...handlers])
    if (type === DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged)
      await handler(received(connectionId, content))
}
/** A received keyring/chat message, stored: only the handlers for RecordSaved hear it, as in Credo. */
let chatEvents = 0
const deliverChat = async (connectionId: string, text: string) => {
  const record = new ChatEventRecord({
    connectionId,
    role: 'received',
    eventId: `0000000000${String(++chatEvents).padStart(16, '0')}`,
    eventType: 'message',
    content: { format: 'text/plain', text },
  })
  for (const { type, handler } of [...handlers])
    if (type === RepositoryEventTypes.RecordSaved) await handler({ payload: { record } })
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  handlers.length = 0
  ;(Toast.show as jest.Mock).mockClear()
  setActiveChatConnectionId(undefined)
  ;(useAgent as jest.Mock).mockReturnValue({ agent })
})

const wakeOpening = (opened: string | undefined, during: () => Promise<void>): MessageWakeDeps => ({
  openList: () => undefined,
  pickUpNow: during,
  nextMessage: () => ({ arrived: new Promise(() => undefined), cancel: () => undefined }),
  newestUnread: async () => opened,
  openChat: (id) => setActiveChatConnectionId(id),
  listFocus: { focused: () => true, blurs: () => 0, subscribe: () => () => undefined },
  sleep: async () => undefined,
  graceMs: 0,
})

describe('a wake tap and the in-app toast', () => {
  it('no toast for the message whose chat the tap opens; a toast for another contact', async () => {
    render(<InAppMessageNotifier />)
    // Every event a message arrives by is listened to: v1 and v2 basic messages, and a stored keyring/chat event.
    expect(handlers.map((h) => h.type).sort()).toEqual(
      [
        DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged,
        DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged,
        RepositoryEventTypes.RecordSaved,
      ].sort()
    )
    await act(async () => {
      await openMessageWake(
        wakeOpening('bob', async () => {
          // What the pickup brings, before the chat has opened.
          await deliver('bob', 'hi from bob')
          await deliver('ada', 'hi from ada')
          expect(Toast.show).not.toHaveBeenCalled()
        })
      )
      await flush()
    })
    const shown = (Toast.show as jest.Mock).mock.calls.map(([options]) => options.text2)
    expect(shown.filter((t: string) => t === 'hi from bob')).toHaveLength(0)
    expect(shown.filter((t: string) => t === 'hi from ada').length).toBeGreaterThan(0)
    expect(messageWakeHold.isHolding()).toBe(false)
  })

  // The same hold for a keyring/chat message as for a BasicMessage: no toast for the chat the tap opens.
  it('a chat message: no toast for the chat the tap opens; a toast for another contact', async () => {
    render(<InAppMessageNotifier />)
    await act(async () => {
      await openMessageWake(
        wakeOpening('bob', async () => {
          await deliverChat('bob', 'hi from bob')
          await deliverChat('ada', 'hi from ada')
          expect(Toast.show).not.toHaveBeenCalled()
        })
      )
      await flush()
    })
    const senders = (Toast.show as jest.Mock).mock.calls.map(([options]) => options.text1)
    expect(senders).not.toContain('bob')
    expect(senders).toContain('ada')
    expect(messageWakeHold.isHolding()).toBe(false)
  })

  it('a tap that settles on the list lets every waiting toast through', async () => {
    render(<InAppMessageNotifier />)
    await act(async () => {
      await openMessageWake(wakeOpening(undefined, () => deliver('bob', 'hi from bob')))
      await flush()
    })
    const shown = (Toast.show as jest.Mock).mock.calls.map(([options]) => options.text2)
    expect(shown).toContain('hi from bob')
  })

  it('with no tap pending, a message toasts at once, as before', async () => {
    render(<InAppMessageNotifier />)
    await act(async () => {
      await deliver('ada', 'hello')
      await flush()
    })
    expect(Toast.show).toHaveBeenCalledTimes(1)
  })
})
