/**
 * A tapped message notification resolved after the tap (utils/messageWake.ts):
 * which chat it opens, in what order, and that a person who has moved on by
 * then stays where they are.
 */
import type { DidCommBasicMessageRecord } from '@credo-ts/didcomm'

import { BasicMessageMetadata } from '../../types/metadata'
import {
  focusedRouteName,
  messageWakeFetching,
  messageWakeHold,
  newestUnreadConnection,
  openMessageWake,
  type MessageWakeDeps,
} from '../messageWake'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const message = (connectionId: string, at: string, opts: { seen?: boolean; content?: string } = {}) =>
  ({
    connectionId,
    content: opts.content ?? 'hello',
    createdAt: new Date(at),
    role: 'receiver',
    metadata: {
      get: (key: string) => (key === BasicMessageMetadata.customMetadata && opts.seen ? { seen: true } : undefined),
    },
  }) as unknown as DidCommBasicMessageRecord

describe('which chat a tap opens', () => {
  it('the connection whose unread message is newest, whoever has more of them', () => {
    const messages = [
      message('ada', '2026-10-20T10:00:00Z'),
      message('ada', '2026-10-20T10:01:00Z'),
      message('bob', '2026-10-20T10:02:00Z'),
    ]
    expect(newestUnreadConnection(messages)).toBe('bob')
  })

  it('reads as the Messages badge does: a seen message or a protocol message is not unread', () => {
    const messages = [
      message('ada', '2026-10-20T10:00:00Z'),
      message('bob', '2026-10-20T10:05:00Z', { seen: true }),
      message('cal', '2026-10-20T10:06:00Z', { content: '{"@type":"https://didcomm.org/x"}' }),
    ]
    expect(newestUnreadConnection(messages)).toBe('ada')
  })

  it('none when nothing is unread', () => {
    expect(newestUnreadConnection([message('ada', '2026-10-20T10:00:00Z', { seen: true })])).toBeUndefined()
    expect(newestUnreadConnection([])).toBeUndefined()
  })
})

describe('the screen in front', () => {
  it('follows the focused route down through nested navigators', () => {
    const state = {
      index: 0,
      routes: [
        {
          name: 'TabStack',
          state: {
            index: 1,
            routes: [
              { name: 'Contacts' },
              { name: 'MessageStack', state: { index: 0, routes: [{ name: 'Messages' }] } },
            ],
          },
        },
      ],
    }
    expect(focusedRouteName(state)).toBe('Messages')
    expect(focusedRouteName(undefined)).toBeUndefined()
  })
})

describe('resolving a tap', () => {
  const deps = (over: Partial<MessageWakeDeps> = {}) => {
    const calls: string[] = []
    let key = 'messages'
    let arrive: () => void = () => undefined
    const d: MessageWakeDeps = {
      openList: jest.fn(() => calls.push('list')),
      pickUpNow: jest.fn(async () => {
        calls.push('pickup')
      }),
      nextMessage: jest.fn(() => ({ arrived: new Promise<void>((resolve) => (arrive = resolve)), cancel: jest.fn() })),
      newestUnread: jest.fn(async () => 'bob'),
      openChat: jest.fn((id: string) => calls.push(`chat:${id}`)),
      onList: () => key === 'messages',
      sleep: async () => undefined,
      graceMs: 0,
      ...over,
    }
    return { d, calls, move: (to: string) => (key = to), arrive: () => arrive() }
  }

  it('shows the list first, picks up, then opens the newest unread chat', async () => {
    const { d, calls } = deps()
    await expect(openMessageWake(d)).resolves.toBe('chat')
    expect(calls).toEqual(['list', 'pickup', 'chat:bob'])
  })

  it('says it is fetching while it does, and stops saying so after', async () => {
    const seen: boolean[] = []
    const unsubscribe = messageWakeFetching.subscribe(() => seen.push(messageWakeFetching.get()))
    const { d } = deps()
    await openMessageWake(d)
    unsubscribe()
    expect(seen).toEqual([true, false])
    expect(messageWakeFetching.get()).toBe(false)
  })

  it('stays on the list when nothing is unread', async () => {
    const { d, calls } = deps({ newestUnread: jest.fn(async () => undefined) })
    await expect(openMessageWake(d)).resolves.toBe('list')
    expect(calls).toEqual(['list', 'pickup'])
  })

  it('does not move a person who went anywhere while the messages came in', async () => {
    const handle = deps()
    handle.d.pickUpNow = jest.fn(async () => {
      handle.move('contacts')
    })
    await expect(openMessageWake(handle.d)).resolves.toBe('moved')
    expect(handle.d.openChat).not.toHaveBeenCalled()
  })

  it('a message that lands first opens its chat without waiting for the whole pickup', async () => {
    const handle = deps()
    handle.d.pickUpNow = jest.fn(() => {
      handle.arrive()
      return new Promise<void>(() => undefined)
    })
    await expect(openMessageWake(handle.d)).resolves.toBe('chat')
  })

  it('waits for the list to be in front before it judges a move, then sees one', async () => {
    // The navigation to the list lands a little later than it is asked for.
    let key = 'contacts'
    const handle = deps({ onList: () => key === 'messages' })
    handle.d.openList = jest.fn(() => {
      setTimeout(() => (key = 'messages'), 30)
    })
    handle.d.sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    handle.d.pickUpNow = jest.fn(async () => {
      key = 'contacts'
    })
    await expect(openMessageWake(handle.d)).resolves.toBe('moved')
    expect(handle.d.openChat).not.toHaveBeenCalled()
  })

  it('a list that never comes to the front: nothing is opened', async () => {
    const handle = deps({ onList: () => false })
    await expect(openMessageWake(handle.d)).resolves.toBe('moved')
    expect(handle.d.pickUpNow).not.toHaveBeenCalled()
    expect(messageWakeFetching.get()).toBe(false)
  })

  // A second tap within the window used to start a second run, whose end
  // released the first one's hold on the toasts while it was still under way.
  it('a second tap while one is under way joins it: one run, held until it settles', async () => {
    let finish: () => void = () => undefined
    const handle = deps()
    handle.d.pickUpNow = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    // The long wait never ends by itself here: only the pickup ends this run.
    handle.d.sleep = (ms: number) => (ms >= 1000 ? new Promise<void>(() => undefined) : Promise.resolve())
    const first = openMessageWake(handle.d)
    await Promise.resolve()
    const second = openMessageWake({ ...handle.d, openList: jest.fn(), pickUpNow: jest.fn(async () => undefined) })
    expect(second).toBe(first)
    await new Promise((resolve) => setImmediate(resolve))
    expect(messageWakeHold.isHolding()).toBe(true)
    expect(handle.d.openList).toHaveBeenCalledTimes(1)
    finish()
    await expect(first).resolves.toBe('chat')
    await expect(second).resolves.toBe('chat')
    expect(messageWakeHold.isHolding()).toBe(false)
    // And the next tap after it starts a run of its own.
    const third = deps()
    await expect(openMessageWake(third.d)).resolves.toBe('chat')
    expect(third.d.openList).toHaveBeenCalledTimes(1)
  })

  it('a pickup that fails still settles, and on what is there', async () => {
    const { d } = deps({ pickUpNow: jest.fn(async () => Promise.reject(new Error('mediator down'))) })
    await expect(openMessageWake(d)).resolves.toBe('chat')
  })
})
