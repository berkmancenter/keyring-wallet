/**
 * A tapped message notification resolved after the tap (utils/messageWake.ts):
 * which chat it opens, in what order, and that a person who has moved on by
 * then stays where they are.
 */
import type { DidCommBasicMessageRecord } from '@credo-ts/didcomm'

import { addExcludedNotificationConnectionId, clearExcludedNotificationConnectionIds } from '../../hooks/notifications'
import type { ChatEventRecord } from '../../modules/chat/records/ChatEventRecord'
import { BasicMessageMetadata } from '../../types/metadata'
import {
  messageWakeFetching,
  messageWakeHold,
  newestUnreadAcross,
  newestUnreadConnection,
  openMessageWake,
  type MessageWakeDeps,
  type MessagesListFocus,
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

/** A stored keyring/chat event, as the chat repository returns one. */
const chatEvent = (
  connectionId: string,
  at: string,
  opts: { seen?: boolean; role?: 'received' | 'sent'; eventType?: string } = {}
) =>
  ({
    type: 'ChatEventRecord',
    connectionId,
    role: opts.role ?? 'received',
    eventType: opts.eventType ?? 'message',
    createdAt: new Date(at),
    metadata: { get: (key: string) => (key === '_keyring/chatSeen' && opts.seen ? { at } : undefined) },
  }) as unknown as ChatEventRecord

describe('which chat a tap opens, BasicMessages and keyring/chat messages together', () => {
  afterEach(() => clearExcludedNotificationConnectionIds())

  it('a keyring/chat message newer than any BasicMessage: its chat', () => {
    expect(
      newestUnreadAcross([message('ada', '2026-10-20T10:00:00Z')], [chatEvent('cal', '2026-10-20T10:05:00Z')])
    ).toBe('cal')
  })

  it('a BasicMessage newer than any keyring/chat message: its chat', () => {
    expect(
      newestUnreadAcross([message('ada', '2026-10-20T10:09:00Z')], [chatEvent('cal', '2026-10-20T10:05:00Z')])
    ).toBe('ada')
  })

  it('reads keyring/chat as the badge does: a seen message, a reaction or one this phone sent is not unread', () => {
    const events = [
      chatEvent('cal', '2026-10-20T10:01:00Z'),
      chatEvent('dee', '2026-10-20T10:02:00Z', { seen: true }),
      chatEvent('eve', '2026-10-20T10:03:00Z', { eventType: 'reaction' }),
      chatEvent('fay', '2026-10-20T10:04:00Z', { role: 'sent' }),
    ]
    expect(newestUnreadAcross([], events)).toBe('cal')
  })

  it('a connection left out of notifications is not picked, for either kind', () => {
    addExcludedNotificationConnectionId('cal')
    addExcludedNotificationConnectionId('ada')
    expect(
      newestUnreadAcross(
        [message('ada', '2026-10-20T10:09:00Z'), message('bob', '2026-10-20T10:00:00Z')],
        [chatEvent('cal', '2026-10-20T10:05:00Z')]
      )
    ).toBe('bob')
  })

  it('none when nothing of either kind is unread', () => {
    expect(
      newestUnreadAcross(
        [message('ada', '2026-10-20T10:00:00Z', { seen: true })],
        [chatEvent('cal', '2026-10-20T10:05:00Z', { seen: true })]
      )
    ).toBeUndefined()
    expect(newestUnreadAcross([], [])).toBeUndefined()
  })
})

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

  it('the relationship-DID announcement a new contact sends is not unread chat', () => {
    const messages = [
      message('ada', '2026-10-20T10:00:00Z'),
      message('new', '2026-10-20T10:07:00Z', {
        content: 'This is my relationship DID: vrc:relationshipDid:did:peer:2.abc vrc:rceVersion:4',
      }),
    ]
    expect(newestUnreadConnection(messages)).toBe('ada')
  })

  it('none when nothing is unread', () => {
    expect(newestUnreadConnection([message('ada', '2026-10-20T10:00:00Z', { seen: true })])).toBeUndefined()
    expect(newestUnreadConnection([])).toBeUndefined()
  })
})

describe('resolving a tap', () => {
  /** The Messages list's report of its own focus, driven by the test. */
  const listFocus = (initially = true) => {
    let focused = initially
    let blurs = 0
    const listeners = new Set<() => void>()
    const notify = () => listeners.forEach((l) => l())
    const focus: MessagesListFocus = {
      focused: () => focused,
      blurs: () => blurs,
      subscribe: (l) => {
        listeners.add(l)
        return () => {
          listeners.delete(l)
        }
      },
    }
    return {
      focus,
      take: () => {
        focused = true
        notify()
      },
      leave: () => {
        focused = false
        blurs += 1
        notify()
      },
    }
  }

  const deps = (over: Partial<MessageWakeDeps> = {}, list = listFocus()) => {
    const calls: string[] = []
    let arrive: () => void = () => undefined
    const d: MessageWakeDeps = {
      openList: jest.fn(() => calls.push('list')),
      pickUpNow: jest.fn(async () => {
        calls.push('pickup')
      }),
      nextMessage: jest.fn(() => ({ arrived: new Promise<void>((resolve) => (arrive = resolve)), cancel: jest.fn() })),
      newestUnread: jest.fn(async () => 'bob'),
      openChat: jest.fn((id: string) => calls.push(`chat:${id}`)),
      listFocus: list.focus,
      sleep: async () => undefined,
      graceMs: 0,
      ...over,
    }
    return { d, calls, list, move: () => list.leave(), arrive: () => arrive() }
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

  /** Someone answering one of this phone's invitations, driven by the test. */
  const invitations = () => {
    let answer: () => void = () => undefined
    let latest: string | undefined
    return {
      nextConnection: jest.fn(() => ({
        arrived: new Promise<void>((resolve) => (answer = resolve)),
        latest: () => latest,
        cancel: jest.fn(),
      })),
      answer: (connectionId: string) => {
        latest = connectionId
        answer()
      },
    }
  }

  describe('with a relationship exchange in play (a shared link opened later)', () => {
    it('a proposal waiting for consent: stays on the list for the consent sheet, opens no chat', async () => {
      const { d, calls } = deps({ consentPending: () => true })
      await expect(openMessageWake(d)).resolves.toBe('consent')
      expect(calls).toEqual(['list', 'pickup'])
      expect(d.newestUnread).not.toHaveBeenCalled()
    })

    it('an exchange signing or witnessing on this phone: pushes nothing over it', async () => {
      const { d, calls } = deps({ exchangeWorking: () => true })
      await expect(openMessageWake(d)).resolves.toBe('exchange')
      expect(calls).toEqual(['list', 'pickup'])
    })

    it('someone answers an invitation: their chat opens at once, ahead of older unread chat', async () => {
      const invites = invitations()
      const handle = deps({ nextConnection: invites.nextConnection })
      handle.d.pickUpNow = jest.fn(() => {
        invites.answer('new-contact')
        return new Promise<void>(() => undefined)
      })
      await expect(openMessageWake(handle.d)).resolves.toBe('newContact')
      expect(handle.d.openChat).toHaveBeenCalledWith('new-contact')
      expect(handle.d.newestUnread).not.toHaveBeenCalled()
    })

    it('the chat it opened for a new contact gets no toast', async () => {
      const invites = invitations()
      const handle = deps({ nextConnection: invites.nextConnection })
      let releasedWith: string | undefined = 'not released'
      handle.d.pickUpNow = jest.fn(async () => {
        messageWakeHold.after((opened) => (releasedWith = opened))
        invites.answer('new-contact')
      })
      await openMessageWake(handle.d)
      expect(releasedWith).toBe('new-contact')
    })

    it('their proposal arriving with the answer: consent comes first, no chat is pushed over it', async () => {
      const invites = invitations()
      let consent = false
      const handle = deps({ nextConnection: invites.nextConnection, consentPending: () => consent })
      handle.d.pickUpNow = jest.fn(async () => {
        invites.answer('new-contact')
        consent = true
      })
      await expect(openMessageWake(handle.d)).resolves.toBe('consent')
      expect(handle.d.openChat).not.toHaveBeenCalled()
    })

    it('a person who moved on is still not moved, whatever arrived', async () => {
      const invites = invitations()
      const handle = deps({ nextConnection: invites.nextConnection, consentPending: () => true })
      handle.d.pickUpNow = jest.fn(async () => {
        invites.answer('new-contact')
        handle.move()
      })
      await expect(openMessageWake(handle.d)).resolves.toBe('moved')
      expect(handle.d.openChat).not.toHaveBeenCalled()
    })

    it('stops listening for answers once the tap is resolved', async () => {
      const invites = invitations()
      const { d } = deps({ nextConnection: invites.nextConnection })
      await openMessageWake(d)
      const listening = invites.nextConnection.mock.results[0].value
      expect(listening.cancel).toHaveBeenCalled()
    })
  })

  describe('with a continuity question ("Is this you?") waiting', () => {
    it('opens the chat that holds it, ahead of newer plain unread chat', async () => {
      const { d, calls } = deps({ continuityPending: () => 'alice' })
      await expect(openMessageWake(d)).resolves.toBe('continuity')
      expect(calls).toEqual(['list', 'pickup', 'chat:alice'])
      expect(d.newestUnread).not.toHaveBeenCalled()
    })

    it('the question arriving during the pickup ends the wait at once and opens its chat', async () => {
      let ask: () => void = () => undefined
      let waiting: string | undefined
      const handle = deps({
        nextContinuityPrompt: jest.fn(() => ({
          arrived: new Promise<void>((resolve) => (ask = resolve)),
          cancel: jest.fn(),
        })),
        continuityPending: () => waiting,
      })
      handle.d.pickUpNow = jest.fn(() => {
        waiting = 'alice'
        ask()
        return new Promise<void>(() => undefined)
      })
      await expect(openMessageWake(handle.d)).resolves.toBe('continuity')
      expect(handle.d.openChat).toHaveBeenCalledWith('alice')
    })

    it('a proposal waiting for consent still comes first', async () => {
      const { d, calls } = deps({ consentPending: () => true, continuityPending: () => 'alice' })
      await expect(openMessageWake(d)).resolves.toBe('consent')
      expect(calls).toEqual(['list', 'pickup'])
    })
  })

  it('stays on the list when nothing is unread', async () => {
    const { d, calls } = deps({ newestUnread: jest.fn(async () => undefined) })
    await expect(openMessageWake(d)).resolves.toBe('list')
    expect(calls).toEqual(['list', 'pickup'])
  })

  it('does not move a person who went anywhere while the messages came in', async () => {
    const handle = deps()
    handle.d.pickUpNow = jest.fn(async () => {
      handle.move()
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

  // VTRM-RFH2 (build 265): on a cold or background tap the list took focus
  // late, and the check that read navigation state never saw it.
  it('waits for the list to say it has focus, however late, then opens the chat', async () => {
    const list = listFocus(false)
    const handle = deps(
      { sleep: (ms: number) => (ms >= 1000 ? new Promise<void>(() => undefined) : Promise.resolve()) },
      list
    )
    handle.d.openList = jest.fn(() => {
      setTimeout(() => list.take(), 1500)
    })
    jest.useFakeTimers()
    try {
      const run = openMessageWake(handle.d)
      await jest.advanceTimersByTimeAsync(1500)
      await expect(run).resolves.toBe('chat')
    } finally {
      jest.useRealTimers()
    }
  })

  it('only a move the person makes after the list took focus counts, not the focus arriving', async () => {
    const list = listFocus(false)
    const handle = deps({}, list)
    handle.d.openList = jest.fn(() => {
      // Mounting late: no focus, then focus. Not a move.
      setTimeout(() => list.take(), 0)
    })
    handle.d.sleep = (ms: number) => (ms >= 1000 ? new Promise<void>(() => undefined) : Promise.resolve())
    await expect(openMessageWake(handle.d)).resolves.toBe('chat')
  })

  it('a list that never takes focus: nothing opens, and the toasts are let go', async () => {
    const list = listFocus(false)
    const handle = deps({}, list)
    let releasedWith: string | undefined = 'not released'
    handle.d.openList = jest.fn(() => {
      // A message lands while the tap is waiting for the list.
      messageWakeHold.after((opened) => (releasedWith = opened))
    })
    await expect(openMessageWake(handle.d)).resolves.toBe('notShown')
    expect(handle.d.pickUpNow).not.toHaveBeenCalled()
    expect(handle.d.openChat).not.toHaveBeenCalled()
    expect(messageWakeFetching.get()).toBe(false)
    expect(messageWakeHold.isHolding()).toBe(false)
    expect(releasedWith).toBeUndefined()
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
