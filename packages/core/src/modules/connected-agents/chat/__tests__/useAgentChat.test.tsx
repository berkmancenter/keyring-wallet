/**
 * The agent chat (backlog 2, fb-C4; plan §3.5, §7.9): the record before the send, the stop at 20 and its reset on a
 * reply, a paced send that waits and resumes, the refusal that spends the action, `versionMismatch` from fb-C2's
 * refusals, and replies and reactions as `keyring.chat/1` events stored under the chat's connection id.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { Agent } from '@credo-ts/core'
import React from 'react'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { newEventId } from '../../../chat/eventId'
import { ChatEventRecord } from '../../../chat/records/ChatEventRecord'
import { AgentConnectionStore } from '../../store'
import { agentRecord, FIXTURE_NOW } from '../../testing/fixtures'
import type { AgentConnection } from '../../types'
import type { CarrierResult } from '../carrier'
import type { AgentChatListener, ControlListener, ControlReceipt, LiveAgentConnection } from '../control'
import { ENVELOPE_TYPE, type SignedEnvelope } from '../envelope'
import {
  AGENT_CHAT_STOP_AFTER,
  type AgentChatEvents,
  AgentChatProvider,
  AgentChatService,
  agentChatView,
  DELIVERY_TAG,
  ENVELOPE_ID_TAG,
  useAgentChat,
} from '../useAgentChat'

const MINUTE = 60 * 1000
const K_C = 'did:key:z6MkKeyringChat'
const CONNECTION = 'agent-chat:did:key:z6MkNotesHelperFixture'

const NONE: ChatEventRecord[] = []

/** The chat module's storage, in memory: one array per chat, replaced when it changes. */
function memoryEvents(): AgentChatEvents & { byConnection: () => Map<string, ChatEventRecord[]> } {
  let byConnection = new Map<string, ChatEventRecord[]>()
  const listeners = new Set<() => void>()
  const put = async (record: ChatEventRecord) => {
    const kept = (byConnection.get(record.connectionId) ?? []).filter((e) => e.id !== record.id)
    byConnection = new Map(byConnection)
    byConnection.set(record.connectionId, [...kept, record])
    listeners.forEach((l) => l())
  }
  return {
    snapshot: (connectionId) => byConnection.get(connectionId) ?? NONE,
    all: () => byConnection,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    list: async (connectionId) => [...(byConnection.get(connectionId) ?? [])],
    save: put,
    update: put,
    byConnection: () => byConnection,
  }
}

function setup() {
  const agent = { genericRecords: memoryGenericRecords() } as unknown as Agent
  const store = new AgentConnectionStore(agent)
  const events = memoryEvents()
  const chatListeners = new Set<AgentChatListener>()
  const receiptListeners = new Set<ControlListener>()
  const calls: string[] = []
  let answer: () => CarrierResult = () => ({ result: 'sent', id: 'x' })
  const sendEnvelope = jest.fn(
    async (_record: AgentConnection, _type: string, payload: Record<string, unknown>, options?: { id?: string }) => {
      // What is stored at the moment of the send.
      const stored = (await events.list(CONNECTION)).find((e) => e.eventId === payload.eventId)
      calls.push(`send ${String(payload.eventId)} stored:${stored?.getTag(DELIVERY_TAG) ?? 'no'}`)
      return { ...answer(), envelopeId: options?.id ?? 'none' }
    }
  )
  const control = {
    sendEnvelope,
    onChat: (listener: AgentChatListener) => {
      chatListeners.add(listener)
      return () => chatListeners.delete(listener)
    },
    onReceipt: (listener: ControlListener) => {
      receiptListeners.add(listener)
      return () => receiptListeners.delete(listener)
    },
  }
  const timers: { run: () => void; ms: number }[] = []
  let now = FIXTURE_NOW
  const service = new AgentChatService({
    control: control as never,
    store,
    events,
    now: () => now,
    setTimer: (run, ms) => {
      timers.push({ run, ms })
      return timers.length
    },
    clearTimer: () => undefined,
  })
  const record = agentRecord({ chatDid: K_C, chatConnectionId: CONNECTION })

  /** The agent sends a `keyring.chat/1` event, as fb-C3 hands it over once checked. */
  const fromAgent = async (event: Record<string, unknown>) => {
    const current = ((await store.get(record.id)) ?? record) as LiveAgentConnection
    const envelope = { type: ENVELOPE_TYPE.chat, payload: { version: '1.0', profile: 'keyring.chat/1', ...event } }
    for (const listener of chatListeners) {
      await listener({ agentId: record.id, record: current, envelope: envelope as unknown as SignedEnvelope })
    }
  }
  const receipt = (r: ControlReceipt) => receiptListeners.forEach((l) => l(r))

  return {
    service,
    store,
    events,
    record,
    sendEnvelope,
    calls,
    timers,
    fromAgent,
    receipt,
    answerWith: (next: () => CarrierResult) => {
      answer = next
    },
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
    stored: () => events.list(CONNECTION),
  }
}

async function started(t: ReturnType<typeof setup>, overrides: Partial<AgentConnection> = {}) {
  await t.store.put({ ...t.record, ...overrides })
  await t.service.start()
  return t
}

const reply = (text = 'noted', extra: Record<string, unknown> = {}) => ({
  eventId: newEventId(),
  type: 'message',
  content: { format: 'text/plain', text },
  ...extra,
})

describe('sending', () => {
  it('stores the event, marked sending, before the send; marks it sent after; the payload is a keyring.chat/1 message', async () => {
    const t = await started(setup())
    const result = await t.service.send(t.record.id, 'What did I save about the trip?')
    expect(result).toMatchObject({ result: 'sent' })
    const [stored] = await t.stored()
    expect(t.calls).toEqual([`send ${stored.eventId} stored:sending`])
    expect(stored.getTag(DELIVERY_TAG)).toBe('sent')
    expect(stored.role).toBe('sent')
    expect(stored.connectionId).toBe(CONNECTION)
    const [record, type, payload, options] = t.sendEnvelope.mock.calls[0]
    expect(record.id).toBe(t.record.id)
    expect(type).toBe(ENVELOPE_TYPE.chat)
    expect(payload).toEqual({
      profile: 'keyring.chat/1',
      eventId: stored.eventId,
      type: 'message',
      clientTs: new Date(FIXTURE_NOW).toISOString(),
      content: { format: 'text/plain', text: 'What did I save about the trip?' },
    })
    expect(options).toEqual({ id: stored.getTag(ENVELOPE_ID_TAG) })
  })

  it('a reply carries inReplyTo; a reaction and its removal are events of their own', async () => {
    const t = await started(setup())
    const target = newEventId()
    await t.service.send(t.record.id, 'yes', { inReplyTo: target })
    await t.service.react(t.record.id, target, '👍')
    const reactionId = (await t.stored())[1].eventId
    await t.service.removeReaction(t.record.id, reactionId)
    const payloads = t.sendEnvelope.mock.calls.map((c) => c[2])
    expect(payloads[0]).toMatchObject({ type: 'message', inReplyTo: target })
    expect(payloads[1]).toMatchObject({ type: 'reaction', target, emoji: '👍' })
    expect(payloads[2]).toMatchObject({ type: 'redaction', target: reactionId })
  })

  it('refuses an empty message, and a reaction that is not one emoji of the set', async () => {
    const t = await started(setup())
    expect(() => t.service.send(t.record.id, '')).toThrow(/empty/)
    expect(() => t.service.react(t.record.id, newEventId(), 'not an emoji')).toThrow(/emoji/)
  })

  it('a send for an agent with no record is noRecord, and stores nothing', async () => {
    const t = setup()
    await t.service.start()
    expect(await t.service.send('did:key:z6MkGone', 'hello')).toEqual({ result: 'noRecord' })
    expect(t.events.byConnection().size).toBe(0)
  })

  it('a refused send (closed mediator) is refused, and is never offered again', async () => {
    const t = await started(setup())
    t.answerWith(() => ({ result: 'closedMediator', refused: 'send' }))
    const result = await t.service.send(t.record.id, 'hello')
    expect(result).toMatchObject({ result: 'refused' })
    const eventId = (result as { eventId: string }).eventId
    await expect(t.service.retry(t.record.id, eventId)).rejects.toThrow(/not a message to send again/)
    expect(t.sendEnvelope).toHaveBeenCalledTimes(1)
  })

  it('an unreachable send is notSent, and retry sends it again with the same envelope id', async () => {
    const t = await started(setup())
    t.answerWith(() => ({ result: 'unreachable', reason: 'transport' }))
    const first = await t.service.send(t.record.id, 'hello')
    expect(first).toMatchObject({ result: 'notSent' })
    t.answerWith(() => ({ result: 'sent', id: 'x' }))
    expect(await t.service.retry(t.record.id, (first as { eventId: string }).eventId)).toMatchObject({ result: 'sent' })
    const [a, b] = t.sendEnvelope.mock.calls
    expect(b[3]).toEqual(a[3])
    expect((await t.stored())[0].getTag(DELIVERY_TAG)).toBe('sent')
  })

  it('a send that throws before the carrier is notSent, not left sending', async () => {
    const t = await started(setup())
    t.sendEnvelope.mockRejectedValueOnce(new Error('the KMS is locked'))
    expect(await t.service.send(t.record.id, 'hello')).toMatchObject({ result: 'notSent' })
    expect((await t.stored())[0].getTag(DELIVERY_TAG)).toBe('notSent')
  })
})

describe('the stop at 20 (§3.5)', () => {
  it(`stops after ${AGENT_CHAT_STOP_AFTER} messages with no reply: the next is neither stored nor sent`, async () => {
    const t = await started(setup())
    for (let i = 0; i < AGENT_CHAT_STOP_AFTER; i++) {
      expect(await t.service.send(t.record.id, `m${i}`)).toMatchObject({ result: 'sent' })
    }
    expect(await t.service.send(t.record.id, 'one more')).toEqual({ result: 'stopped' })
    expect(await t.service.react(t.record.id, (await t.stored())[0].eventId, '👍')).toEqual({ result: 'stopped' })
    expect(t.sendEnvelope).toHaveBeenCalledTimes(AGENT_CHAT_STOP_AFTER)
    expect(await t.stored()).toHaveLength(AGENT_CHAT_STOP_AFTER)
    const view = agentChatView(await t.store.get(t.record.id), await t.stored(), {
      now: t.now(),
      versionMismatch: false,
    })
    expect(view).toMatchObject({ unanswered: AGENT_CHAT_STOP_AFTER, stopped: true, state: 'waiting' })
  })

  it('a reply resets it, and sending goes on', async () => {
    const t = await started(setup())
    for (let i = 0; i < AGENT_CHAT_STOP_AFTER; i++) await t.service.send(t.record.id, `m${i}`)
    t.advance(1000)
    await t.fromAgent(reply())
    const view = agentChatView(await t.store.get(t.record.id), await t.stored(), {
      now: t.now(),
      versionMismatch: false,
    })
    expect(view).toMatchObject({ unanswered: 0, stopped: false })
    t.advance(1000)
    expect(await t.service.send(t.record.id, 'thanks')).toMatchObject({ result: 'sent' })
  })

  it('control: one reply clears unanswered', async () => {
    const t = await started(setup())
    await t.service.send(t.record.id, 'a')
    await t.service.send(t.record.id, 'b')
    const before = agentChatView(undefined, await t.stored(), { now: t.now(), versionMismatch: false })
    expect(before.unanswered).toBe(2)
    t.advance(1000)
    await t.fromAgent(reply())
    expect(agentChatView(undefined, await t.stored(), { now: t.now(), versionMismatch: false }).unanswered).toBe(0)
  })

  it('a message that did not reach the mediator does not count', async () => {
    const t = await started(setup())
    t.answerWith(() => ({ result: 'unreachable', reason: 'transport' }))
    for (let i = 0; i < AGENT_CHAT_STOP_AFTER; i++) await t.service.send(t.record.id, `m${i}`)
    expect(agentChatView(undefined, await t.stored(), { now: t.now(), versionMismatch: false }).unanswered).toBe(0)
  })
})

describe('pacing (503 e.p.limits.queue.peer)', () => {
  it('a paced send waits for Retry-After, then resumes: every paced message goes, in order, with its envelope id', async () => {
    const t = await started(setup())
    t.answerWith(() => ({ result: 'paced', retryAt: t.now() + 30_000, retryAfterMs: 30_000 }))
    expect(await t.service.send(t.record.id, 'first')).toMatchObject({ result: 'paced' })
    t.advance(1000)
    expect(await t.service.send(t.record.id, 'second')).toMatchObject({ result: 'paced' })
    expect(t.timers).toHaveLength(1)
    expect(t.timers[0].ms).toBe(30_000)

    t.answerWith(() => ({ result: 'sent', id: 'x' }))
    t.advance(30_000)
    await act(async () => {
      t.timers[0].run()
    })
    await waitFor(async () => expect((await t.stored()).every((e) => e.getTag(DELIVERY_TAG) === 'sent')).toBe(true))
    const calls = t.sendEnvelope.mock.calls
    expect(calls.map((c) => (c[2].content as { text: string }).text)).toEqual(['first', 'second', 'first', 'second'])
    expect(calls[2][3]).toEqual(calls[0][3])
    expect(calls[3][3]).toEqual(calls[1][3])
  })

  it('control: a send that was not paced schedules nothing', async () => {
    const t = await started(setup())
    await t.service.send(t.record.id, 'hello')
    expect(t.timers).toHaveLength(0)
  })
})

describe('start: the repair after a crash', () => {
  it('a message left sending (a crash between the record and the send) is sent again with its envelope id', async () => {
    const t = setup()
    await t.store.put(t.record)
    // As a crash leaves it: stored, marked sending, never answered.
    const left = new ChatEventRecord({
      connectionId: CONNECTION,
      role: 'sent',
      eventId: newEventId(),
      eventType: 'message',
      content: { format: 'text/plain', text: 'lost?' },
      tags: { [DELIVERY_TAG]: 'sending', [ENVELOPE_ID_TAG]: 'urn:uuid:00000000-0000-4000-8000-0000000000aa' },
    })
    await t.events.save(left)
    expect(left.getTag(DELIVERY_TAG)).toBe('sending')

    await t.service.start()
    await waitFor(async () => expect((await t.stored())[0].getTag(DELIVERY_TAG)).toBe('sent'))
    expect(t.sendEnvelope.mock.calls[0][3]).toEqual({ id: left.getTag(ENVELOPE_ID_TAG) })
  })
})

describe('receiving', () => {
  it('stores a reply as received under the chat’s connection id, with its inReplyTo, and a reaction folds onto its message', async () => {
    const t = await started(setup())
    await t.service.send(t.record.id, 'question')
    const [mine] = await t.stored()
    t.advance(1000)
    await t.fromAgent(reply('answer', { inReplyTo: mine.eventId }))
    await t.fromAgent({ eventId: newEventId(), type: 'reaction', target: mine.eventId, emoji: '👍' })
    const view = agentChatView(undefined, await t.stored(), { now: t.now(), versionMismatch: false })
    expect(view.messages?.map((m) => [m.role, m.text, m.inReplyTo])).toEqual([
      ['sent', 'question', undefined],
      ['received', 'answer', mine.eventId],
    ])
    expect(view.messages?.[0].reactions).toEqual([expect.objectContaining({ author: 'received', emoji: '👍' })])
    expect(view.messages?.[0].delivery).toBe('sent')
  })

  it('a photo from the agent is kept as an unsupported attachment (no photos or files in P0)', async () => {
    const t = await started(setup())
    await t.fromAgent(
      reply('look', {
        attachments: [
          { id: 'a1', mediaType: 'image/png', byteCount: 3, width: 1, height: 1, data: { base64: 'AAAA' } },
        ],
      })
    )
    const [stored] = await t.stored()
    expect(stored.attachments).toEqual([{ unsupported: 'not-saved' }])
    expect(
      agentChatView(undefined, await t.stored(), { now: t.now(), versionMismatch: false }).messages?.[0]
    ).toMatchObject({
      text: 'look',
      unsupportedAttachment: true,
    })
  })

  it('drops a duplicate, a timer change and an event that does not parse', async () => {
    const t = await started(setup())
    const event = reply()
    await t.fromAgent(event)
    await t.fromAgent(event)
    await t.fromAgent({ eventId: newEventId(), type: 'timer', timer: { expiresIn: 3600, version: 1 } })
    await t.fromAgent({ eventId: 'not-a-ulid', type: 'message', content: { format: 'text/plain', text: 'x' } })
    expect(await t.stored()).toHaveLength(1)
  })
})

describe('state', () => {
  it('versionMismatch from fb-C2’s refusal: nothing is sent; anything accepted from the agent clears it', async () => {
    const t = await started(setup())
    t.receipt({ result: 'refused', agentId: t.record.id, refusal: 'versionMismatch', detail: 'major 2' })
    expect(t.service.versionMismatch(t.record.id)).toBe(true)
    expect(await t.service.send(t.record.id, 'hello')).toEqual({ result: 'versionMismatch' })
    expect(t.sendEnvelope).not.toHaveBeenCalled()
    expect(agentChatView(undefined, [], { now: t.now(), versionMismatch: true }).state).toBe('versionMismatch')

    t.receipt({ result: 'heartbeat', agentId: t.record.id, at: new Date(t.now()).toISOString() })
    expect(t.service.versionMismatch(t.record.id)).toBe(false)
  })

  it('a chat or heartbeat receipt tells the hooks, since its liveness is on the record by then; a refusal does not', async () => {
    const t = await started(setup())
    const told = jest.fn()
    t.service.subscribe(told)
    t.receipt({ result: 'chat', agentId: t.record.id })
    t.receipt({ result: 'heartbeat', agentId: t.record.id, at: new Date(t.now()).toISOString() })
    expect(told).toHaveBeenCalledTimes(2)
    t.receipt({ result: 'refused', agentId: t.record.id, refusal: 'repeated', detail: '' })
    expect(told).toHaveBeenCalledTimes(2)
  })

  it('control: another refusal is not a version mismatch', async () => {
    const t = await started(setup())
    t.receipt({ result: 'refused', agentId: t.record.id, refusal: 'stale', detail: '' })
    expect(t.service.versionMismatch(t.record.id)).toBe(false)
  })

  it('notConnected with no heartbeat or reply for 20 minutes; connected within', () => {
    const record = agentRecord()
    const at = (ms: number) => new Date(FIXTURE_NOW - ms).toISOString()
    const opts = { now: FIXTURE_NOW, versionMismatch: false }
    expect(agentChatView(record, [], opts).state).toBe('notConnected')
    expect(agentChatView({ ...record, lastHeartbeatAt: at(10 * MINUTE) }, [], opts).state).toBe('connected')
    expect(agentChatView({ ...record, lastReplyAt: at(21 * MINUTE) }, [], opts).state).toBe('notConnected')
    expect(agentChatView(undefined, [], opts).state).toBe('notConnected')
  })
})

describe('useAgentChat', () => {
  it('shows the chat, sends through the service, and its state follows', async () => {
    const t = await started(setup(), { lastHeartbeatAt: new Date(FIXTURE_NOW).toISOString() } as never)
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AgentChatProvider chat={t.service}>{children}</AgentChatProvider>
    )
    const { result } = renderHook(() => useAgentChat(t.record.id), { wrapper })
    await waitFor(() => expect(result.current.state).toBe('connected'))
    expect(result.current.messages).toEqual([])

    await act(async () => {
      await result.current.send('hello')
    })
    await waitFor(() => expect(result.current.messages?.map((m) => [m.text, m.delivery])).toEqual([['hello', 'sent']]))
    expect(result.current).toMatchObject({ unanswered: 1, stopped: false })

    act(() => t.receipt({ result: 'refused', agentId: t.record.id, refusal: 'versionMismatch', detail: '' }))
    await waitFor(() => expect(result.current.state).toBe('versionMismatch'))
  })

  it('throws outside an AgentChatProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => renderHook(() => useAgentChat('x'))).toThrow(/AgentChatProvider/)
  })
})
