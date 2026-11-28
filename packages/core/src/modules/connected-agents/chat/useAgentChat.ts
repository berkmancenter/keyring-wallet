/**
 * The agent chat (plan §3.5, §7.9; backlog 2, fb-C4): `useAgentChat(agentId)` for the agent chat view, over fb-C3's
 * control (`./control.ts`), which signs, carries and checks every document.
 *
 * **Where the events live (fb-C1's decision).** An agent chat's events are `modules/chat/` events, stored as
 * `ChatEventRecord`s under the record's `chatConnectionId` (`agent-chat:<record id>`) through the chat module's own
 * repository, so its storage, its fold (replies and reactions) and `mergeByTime` run unchanged. Only the send differs:
 * the event goes as the payload of a `keyring/chat/1.0` envelope through {@link AgentControl.sendEnvelope}, not as a
 * Credo message. Text, replies and reactions, as `keyring.chat/1` events; no photos or files in P0 (a received one is
 * kept as an unsupported attachment, so its message still arrives and says so).
 *
 * **The record goes first.** A send cannot be taken back, so the event is stored, marked `sending`, before it is handed
 * to the carrier, with the envelope id it will carry; the carrier's answer then marks it (`agentDelivery`, a tag on the
 * record):
 * - `sent`: at the mediator;
 * - `paced` (503 `e.p.limits.queue.peer`): waits for the `Retry-After` and is resent then, with the same envelope id,
 *   in order, and so is every message sent meanwhile;
 * - `refused` (`closedMediator`): the mediator refused it. A refusal spends the action (backlog 2's common rule):
 *   it is never resent and {@link AgentChatService.retry} does not offer it;
 * - `notSent` (`unreachable`, or the send failed before the carrier): offered again through `retry`, same envelope id.
 * A `sending` message found at start (a crash between the record and the send) is resent, with its envelope id; a copy
 * the agent already had is `repeated` there and does nothing.
 *
 * **The stop at 20 (§3.5, VTI-Q36).** The agent answers only while its session runs; the mediator queues at most 50 per
 * sender. `unanswered` counts the messages at the mediator (`sending` or `sent`) since the agent's last event; at 20,
 * `stopped` is true and nothing more is sent, not even a reaction or a paced message, until the agent sends something
 * ("Waiting for your session" is the view's). A paced message waiting does not count: it is not at the mediator.
 *
 * **`state`**, by precedence: `versionMismatch` (the agent's last document was refused for another major, fb-C2, and
 * nothing it sent has been accepted since: nothing is sent either; held for the app's session, so after a restart it
 * shows again at the agent's next document), `waiting` (stopped at 20), `notConnected` (no
 * heartbeat or reply for 20 minutes, fb-C3's `connectionState`), else `connected`.
 *
 * **Who mounts it (not wired here; fb-C4 writes no existing file).** One {@link AgentChatService} per app, built with
 * fb-C3's `AgentControl` and started after it, mounted with {@link AgentChatProvider} where both the agent chat screen
 * (R3) and `Messages.tsx` (for `useAgentMessageRows`) are below it: fb-W1's `ConnectedAgentsRoot`, or above it, at the
 * app's root. `start()` is the repair that resends a crash's `sending` messages and the paced ones: it must run once
 * the control has started.
 *
 * @module connected-agents/chat/useAgentChat
 */
import type { Agent } from '@credo-ts/core'
import React, { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'

import { CHAT_PROFILE, isUlid, MAX_TEXT_LENGTH, parseChatEvent } from '../../chat/chatEvent'
import { chatEventsStore } from '../../chat/chatEventsStore'
import { normalizeEmoji } from '../../chat/emoji/validate'
import { newEventId } from '../../chat/eventId'
import { foldChatEvents, type ChatReaction } from '../../chat/fold'
import { getChatEventRepository } from '../../chat/ChatModule'
import { ChatEventRecord, type ChatEventRole } from '../../chat/records/ChatEventRecord'
import { withKeyLock } from '../../trust-tasks/module/keyedRecords'
import type { AgentConnectionStore } from '../store'
import type { AgentConnection } from '../types'
import { agentChatConnectionId } from './chatIdentity'
import { type AgentChatEnvelope, type AgentControl, connectionState, type LiveAgentConnection } from './control'
import { ENVELOPE_TYPE, newEnvelopeId } from './envelope'

export const LOG_PREFIX = '[ConnectedAgents:AgentChat]'

/** Messages at the mediator with no reply before Keyring stops sending (§3.5; the mediator's own cap is 50). */
export const AGENT_CHAT_STOP_AFTER = 20

/** The tags an agent chat's sent event carries: its delivery and the envelope id it travels in. */
export const DELIVERY_TAG = 'agentDelivery'
export const ENVELOPE_ID_TAG = 'agentEnvelopeId'

export type AgentChatState = 'connected' | 'waiting' | 'notConnected' | 'versionMismatch'

/** Where a sent event stands. Absent on a received one. */
export type AgentChatDelivery = 'sending' | 'sent' | 'paced' | 'refused' | 'notSent'

/** One message as the view draws it. */
export interface AgentChatMessage {
  eventId: string
  role: ChatEventRole
  text?: string
  inReplyTo?: string
  /** ISO instant: when this phone sent or stored it. */
  at: string
  reactions: ChatReaction[]
  /** A photo or file the agent sent: not carried in P0, so the bubble says it is unsupported. */
  unsupportedAttachment: boolean
  delivery?: AgentChatDelivery
}

/** What a send came to. Each has its own words in the view; none is a generic failure. */
export type AgentChatSendResult =
  | { result: 'sent' | 'paced' | 'refused' | 'notSent'; eventId: string }
  /** Stopped at 20 with no reply: nothing was stored or sent. */
  | { result: 'stopped' }
  /** The agent speaks another major: nothing was stored or sent. */
  | { result: 'versionMismatch' }
  | { result: 'noRecord' }

/** The chat module's storage, as this part uses it: the app's {@link chatModuleEvents}, an in-memory one in tests. */
export interface AgentChatEvents {
  /** One chat's events as last read, or undefined until read (`chatEventsStore.chat`). The same array until it changes. */
  snapshot(connectionId: string): ChatEventRecord[] | undefined
  /** Every chat's events, or undefined until read (`chatEventsStore.all`). */
  all(): ReadonlyMap<string, ChatEventRecord[]> | undefined
  subscribe(listener: () => void): () => void
  /** One chat's events, read from storage. */
  list(connectionId: string): Promise<ChatEventRecord[]>
  save(record: ChatEventRecord): Promise<void>
  update(record: ChatEventRecord): Promise<void>
}

/** The chat module's repository and its read-once store, for `agent`. */
export function chatModuleEvents(agent: Agent): AgentChatEvents {
  chatEventsStore.attach(agent)
  const repository = () => getChatEventRepository(agent)
  return {
    snapshot: (connectionId) => chatEventsStore.chat(connectionId),
    all: () => chatEventsStore.all(),
    subscribe: (listener) => chatEventsStore.subscribe(listener),
    list: (connectionId) => repository().findByConnection(agent.context, connectionId),
    save: (record) => repository().save(agent.context, record),
    update: (record) => repository().update(agent.context, record),
  }
}

export interface AgentChatServiceDeps {
  control: Pick<AgentControl, 'sendEnvelope' | 'onChat' | 'onReceipt'>
  store: AgentConnectionStore
  events: AgentChatEvents
  logger?: { info(message: string): void }
  now?: () => number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** The chat's connection id for `record`: as fb-C1 makes it, whether or not it is written yet. */
export const chatConnectionOf = (record: Pick<AgentConnection, 'id' | 'chatConnectionId'>): string =>
  record.chatConnectionId ?? agentChatConnectionId(record.id)

const deliveryOf = (record: ChatEventRecord): AgentChatDelivery | undefined =>
  record.role === 'sent' ? (record.getTag(DELIVERY_TAG) as AgentChatDelivery | undefined) : undefined

const atMediator = (record: ChatEventRecord) => {
  const delivery = deliveryOf(record)
  return delivery === 'sending' || delivery === 'sent'
}

/** Messages at the mediator since the agent's last event (any type): what the stop at 20 counts. */
export function unansweredOf(events: readonly ChatEventRecord[]): number {
  let lastHeard = -Infinity
  for (const e of events) if (e.role === 'received') lastHeard = Math.max(lastHeard, e.sentTime.getTime())
  return events.filter(
    (e) => e.role === 'sent' && e.eventType === 'message' && atMediator(e) && e.sentTime.getTime() > lastHeard
  ).length
}

/** The chat as the view draws it, from the chat's events and the agent's record. */
export function agentChatView(
  record: LiveAgentConnection | undefined,
  events: readonly ChatEventRecord[] | undefined,
  options: { now: number; versionMismatch: boolean }
): { messages?: AgentChatMessage[]; state: AgentChatState; unanswered: number; stopped: boolean } {
  const unanswered = events ? unansweredOf(events) : 0
  const stopped = unanswered >= AGENT_CHAT_STOP_AFTER
  let messages: AgentChatMessage[] | undefined
  if (events) {
    const folded = foldChatEvents([...events])
    messages = folded.messages.map((m) => ({
      eventId: m.eventId,
      role: m.role,
      ...(m.content?.text !== undefined ? { text: m.content.text } : {}),
      ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
      at: m.sentTime.toISOString(),
      reactions: folded.reactions.get(m.eventId) ?? [],
      unsupportedAttachment: (m.attachments ?? []).some((a) => 'unsupported' in a),
      ...(deliveryOf(m) ? { delivery: deliveryOf(m) } : {}),
    }))
  }
  const state: AgentChatState = options.versionMismatch
    ? 'versionMismatch'
    : stopped
      ? 'waiting'
      : !record || connectionState(record, options.now) === 'notConnected'
        ? 'notConnected'
        : 'connected'
  return { messages, state, unanswered, stopped }
}

/** A sent event's `keyring.chat/1` body, rebuilt from its record: what its envelope carries, on a resend too. */
function eventOf(record: ChatEventRecord): Record<string, unknown> {
  return {
    profile: CHAT_PROFILE,
    eventId: record.eventId,
    type: record.eventType,
    ...(record.clientTs ? { clientTs: record.clientTs } : {}),
    ...(record.content ? { content: record.content } : {}),
    ...(record.inReplyTo ? { inReplyTo: record.inReplyTo } : {}),
    ...(record.target ? { target: record.target } : {}),
    ...(record.emoji ? { emoji: record.emoji } : {}),
  }
}

/**
 * Every agent chat on this phone: sending (the record first, then the envelope), receiving (fb-C3's checked chat
 * envelopes, stored as the chat module stores a received event), the stop at 20, pacing and the version state.
 */
export class AgentChatService {
  private readonly listeners = new Set<() => void>()
  private readonly mismatched = new Set<string>()
  private readonly pacedTimers = new Map<string, unknown>()
  private unsubscribe: (() => void)[] = []
  private version = 0

  public constructor(public readonly deps: AgentChatServiceDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Listen to the control and resend what a crash or a pace left. Idempotent. */
  public async start(): Promise<void> {
    if (this.unsubscribe.length > 0) return
    this.unsubscribe = [
      this.deps.control.onChat((message) => this.receive(message)),
      this.deps.control.onReceipt((receipt) => {
        if (!('agentId' in receipt)) return
        const before = this.mismatched.has(receipt.agentId)
        if (receipt.result === 'refused') {
          if (receipt.refusal === 'versionMismatch') this.mismatched.add(receipt.agentId)
        } else {
          // Anything else it sent was read at Keyring's major.
          this.mismatched.delete(receipt.agentId)
        }
        // A receipt comes once fb-C3 has acted, so a heartbeat's or a reply's liveness is on the record by now: the
        // hooks read it again. A refusal changes nothing on the record; only the version state may have moved.
        if (receipt.result !== 'refused' || before !== this.mismatched.has(receipt.agentId)) this.changed()
      }),
    ]
    for (const record of await this.deps.store.list()) {
      if (record.chatConnectionId) await this.resume(record.id, ['sending', 'paced']).catch(() => undefined)
    }
  }

  public stop(): void {
    this.unsubscribe.forEach((u) => u())
    this.unsubscribe = []
    for (const timer of this.pacedTimers.values()) (this.deps.clearTimer ?? clearTimeout)(timer as never)
    this.pacedTimers.clear()
  }

  /** Called whenever what a hook shows may have changed: an event, a delivery, the version state, liveness. */
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Changes with every {@link subscribe} call-out: for `useSyncExternalStore`. */
  public getVersion = (): number => this.version

  private changed(): void {
    this.version++
    for (const listener of [...this.listeners]) listener()
  }

  public versionMismatch(agentId: string): boolean {
    return this.mismatched.has(agentId)
  }

  // ---- sending ---------------------------------------------------------------------------------------------------

  /** Send a text message, optionally as a reply to `inReplyTo` (an event id). */
  public send(agentId: string, text: string, options: { inReplyTo?: string } = {}): Promise<AgentChatSendResult> {
    if (text.length === 0) throw new Error('chat: refusing to send an empty message')
    if (text.length > MAX_TEXT_LENGTH) throw new Error(`chat: message longer than ${MAX_TEXT_LENGTH} characters`)
    if (options.inReplyTo !== undefined && !isUlid(options.inReplyTo))
      throw new Error('chat: inReplyTo is not an event id')
    return this.sendEvent(agentId, (connectionId) => ({
      connectionId,
      eventType: 'message',
      content: { format: 'text/plain', text },
      ...(options.inReplyTo ? { inReplyTo: options.inReplyTo } : {}),
    }))
  }

  /** React to a message; replaces this phone's earlier reaction to it. */
  public react(agentId: string, targetEventId: string, emoji: string): Promise<AgentChatSendResult> {
    if (!isUlid(targetEventId)) throw new Error('chat: reaction target is not an event id')
    const reaction = normalizeEmoji(emoji)
    if (!reaction) throw new Error('chat: reaction is not one emoji of the pinned set')
    return this.sendEvent(agentId, (connectionId) => ({
      connectionId,
      eventType: 'reaction',
      target: targetEventId,
      emoji: reaction,
    }))
  }

  /** Remove this phone's reaction, by the reaction's own event id. */
  public removeReaction(agentId: string, reactionEventId: string): Promise<AgentChatSendResult> {
    if (!isUlid(reactionEventId)) throw new Error('chat: redaction target is not an event id')
    return this.sendEvent(agentId, (connectionId) => ({
      connectionId,
      eventType: 'redaction',
      target: reactionEventId,
    }))
  }

  /** Send a `notSent` message again, with its envelope id. A refused one is never offered again. */
  public retry(agentId: string, eventId: string): Promise<AgentChatSendResult> {
    return this.locked(agentId, async () => {
      const record = await this.deps.store.get(agentId)
      if (!record) return { result: 'noRecord' }
      const events = await this.deps.events.list(chatConnectionOf(record))
      const event = events.find((e) => e.role === 'sent' && e.eventId === eventId)
      if (!event || deliveryOf(event) !== 'notSent') throw new Error(`chat: ${eventId} is not a message to send again`)
      if (this.mismatched.has(agentId)) return { result: 'versionMismatch' }
      if (unansweredOf(events) >= AGENT_CHAT_STOP_AFTER) return { result: 'stopped' }
      return this.deliver(record, event)
    })
  }

  /** One send at a time per agent, so the count of 20 and the order hold. */
  private locked<T>(agentId: string, work: () => Promise<T>): Promise<T> {
    return withKeyLock(`connected-agents|agent-chat-send|${agentId}`, work)
  }

  private sendEvent(
    agentId: string,
    build: (connectionId: string) => Omit<ConstructorParameters<typeof ChatEventRecord>[0], 'role' | 'eventId'>
  ): Promise<AgentChatSendResult> {
    return this.locked(agentId, async () => {
      const record = await this.deps.store.get(agentId)
      if (!record) return { result: 'noRecord' }
      if (this.mismatched.has(agentId)) return { result: 'versionMismatch' }
      const connectionId = chatConnectionOf(record)
      if (unansweredOf(await this.deps.events.list(connectionId)) >= AGENT_CHAT_STOP_AFTER) return { result: 'stopped' }
      const sentAt = new Date(this.now)
      const event = new ChatEventRecord({
        ...build(connectionId),
        role: 'sent',
        eventId: newEventId(),
        clientTs: sentAt.toISOString(),
        sentTime: sentAt,
        tags: { [DELIVERY_TAG]: 'sending', [ENVELOPE_ID_TAG]: newEnvelopeId() },
      })
      // The record first: a send cannot be taken back.
      await this.deps.events.save(event)
      this.changed()
      return this.deliver(record, event)
    })
  }

  /** Hand one stored event to the control, with its envelope id, and mark what came of it. */
  private async deliver(record: AgentConnection, event: ChatEventRecord): Promise<AgentChatSendResult> {
    const envelopeId = event.getTag(ENVELOPE_ID_TAG) as string
    let delivery: Exclude<AgentChatDelivery, 'sending'>
    let retryAfterMs: number | undefined
    try {
      const result = await this.deps.control.sendEnvelope(record, ENVELOPE_TYPE.chat, eventOf(event), {
        id: envelopeId,
      })
      if (result.result === 'paced') retryAfterMs = result.retryAfterMs
      delivery =
        result.result === 'sent'
          ? 'sent'
          : result.result === 'paced'
            ? 'paced'
            : result.result === 'closedMediator'
              ? 'refused'
              : 'notSent'
    } catch (error) {
      this.deps.logger?.info(`${LOG_PREFIX} a send to ${record.id} failed: ${(error as Error)?.message}`)
      delivery = 'notSent'
    }
    event.setTag(DELIVERY_TAG, delivery)
    await this.deps.events.update(event)
    this.changed()
    if (retryAfterMs !== undefined) this.schedule(record.id, retryAfterMs)
    return { result: delivery, eventId: event.eventId }
  }

  /** After `ms`, resend the agent's paced messages. One timer per agent. */
  private schedule(agentId: string, ms: number): void {
    if (this.pacedTimers.has(agentId)) return
    const timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.pacedTimers.delete(agentId)
      void this.resume(agentId, ['paced']).catch(() => undefined)
    }, ms)
    this.pacedTimers.set(agentId, timer)
  }

  /**
   * Resend the agent's events marked `deliveries`, oldest first, with their envelope ids. Stops at the first that does
   * not go (paced again, which reschedules; the stop at 20; or a failure).
   */
  public resume(agentId: string, deliveries: readonly AgentChatDelivery[] = ['paced']): Promise<void> {
    return this.locked(agentId, async () => {
      const record = await this.deps.store.get(agentId)
      if (!record || this.mismatched.has(agentId)) return
      const events = await this.deps.events.list(chatConnectionOf(record))
      const waiting = events
        .filter((e) => e.role === 'sent' && deliveries.includes(deliveryOf(e) as AgentChatDelivery))
        .sort((a, b) => a.sentTime.getTime() - b.sentTime.getTime() || (a.eventId < b.eventId ? -1 : 1))
      for (const event of waiting) {
        // A `sending` one is already counted; a paced one is about to be.
        const others = events.filter((e) => e !== event)
        if (event.eventType === 'message' && unansweredOf(others) >= AGENT_CHAT_STOP_AFTER) return
        const result = await this.deliver(record, event)
        if (result.result !== 'sent') return
      }
    })
  }

  // ---- receiving -------------------------------------------------------------------------------------------------

  /**
   * A checked `keyring/chat/1.0` envelope from the agent (fb-C3): its payload parsed as a `keyring.chat/1` event and
   * stored as received under the chat's connection id. A duplicate, an event id this phone sent, an unparseable event
   * and a timer change (not in P0) are dropped. A store failure throws, so fb-C3 releases the id and the carrier
   * leaves the message queued. A reply lifts the stop at 20, so paced messages go again.
   */
  public async receive({ agentId, record, envelope }: AgentChatEnvelope): Promise<void> {
    const parsed = parseChatEvent(envelope.payload, { now: this.now })
    if (!parsed.ok) {
      this.deps.logger?.info(`${LOG_PREFIX} a chat event from ${agentId} was dropped: ${parsed.reason}`)
      return
    }
    const event = parsed.event
    if (event.type === 'timer') {
      this.deps.logger?.info(`${LOG_PREFIX} a timer change from ${agentId} was dropped: not carried in P0`)
      return
    }
    const connectionId = chatConnectionOf(record)
    const stored = await this.deps.events.list(connectionId)
    if (stored.some((e) => e.eventId === event.eventId)) return
    const wasStopped = unansweredOf(stored) >= AGENT_CHAT_STOP_AFTER
    await this.deps.events.save(
      new ChatEventRecord({
        connectionId,
        role: 'received',
        eventId: event.eventId,
        eventType: event.type,
        clientTs: event.clientTs,
        sentTime: new Date(this.now),
        ...(event.type === 'message'
          ? {
              content: event.content,
              inReplyTo: event.inReplyTo,
              // No photos or files in P0: the message is kept, and its bubble says the attachment is unsupported.
              ...(event.attachments ? { attachments: [{ unsupported: 'not-saved' as const }] } : {}),
            }
          : {}),
        ...(event.type === 'reaction' ? { target: event.target, emoji: event.emoji } : {}),
        ...(event.type === 'redaction' ? { target: event.target } : {}),
      })
    )
    this.mismatched.delete(agentId)
    this.changed()
    if (wasStopped || this.pacedTimers.has(agentId)) void this.resume(agentId, ['paced']).catch(() => undefined)
  }
}

const AgentChatContext = createContext<AgentChatService | undefined>(undefined)

/** Mounts the app's {@link AgentChatService} for {@link useAgentChat} and `useAgentMessageRows`. */
export const AgentChatProvider: React.FC<{ chat: AgentChatService; children?: React.ReactNode }> = ({
  chat,
  children,
}) => React.createElement(AgentChatContext.Provider, { value: chat }, children)

/** The mounted service, or undefined when none is (the flag off, or outside the root). */
export function useAgentChatService(): AgentChatService | undefined {
  return useContext(AgentChatContext)
}

/** How often the hook looks at the clock again, so "Not connected right now" appears without an event. */
export const LIVENESS_TICK_MS = 60 * 1000

const noSubscribe = () => () => undefined

export interface UseAgentChat {
  /** Undefined until the chat's events have been read (unknown is not empty). */
  messages?: AgentChatMessage[]
  send(text: string, options?: { inReplyTo?: string }): Promise<AgentChatSendResult>
  state: AgentChatState
  unanswered: number
  /** Stopped at 20 messages with no reply: "Waiting for your session" is the view's. */
  stopped: boolean
  react(targetEventId: string, emoji: string): Promise<AgentChatSendResult>
  removeReaction(reactionEventId: string): Promise<AgentChatSendResult>
  /** Offered only for a `notSent` message. */
  retry(eventId: string): Promise<AgentChatSendResult>
}

/** One agent's chat, for the agent chat view (R3). Must be below {@link AgentChatProvider}. */
export function useAgentChat(agentId: string): UseAgentChat {
  const chat = useAgentChatService()
  if (!chat) throw new Error('useAgentChat must be used inside an AgentChatProvider')
  const version = useSyncExternalStore(chat.subscribe, chat.getVersion)
  const [record, setRecord] = useState<LiveAgentConnection | undefined>()
  // Only to draw again: `now` is read on every render.
  const [, setTick] = useState(0)
  useEffect(() => {
    let live = true
    void chat.deps.store.get(agentId).then(
      (r) => live && setRecord(r),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [chat, agentId, version])
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), LIVENESS_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const connectionId = record ? chatConnectionOf(record) : undefined
  const subscribeEvents = useCallback(
    (listener: () => void) => (connectionId ? chat.deps.events.subscribe(listener) : noSubscribe()),
    [chat, connectionId]
  )
  const events = useSyncExternalStore(subscribeEvents, () =>
    connectionId ? chat.deps.events.snapshot(connectionId) : undefined
  )
  const view = agentChatView(record, record ? events : undefined, {
    now: (chat.deps.now ?? Date.now)(),
    versionMismatch: chat.versionMismatch(agentId),
  })
  const send = useCallback(
    (text: string, options?: { inReplyTo?: string }) => chat.send(agentId, text, options),
    [chat, agentId]
  )
  const react = useCallback((target: string, emoji: string) => chat.react(agentId, target, emoji), [chat, agentId])
  const removeReaction = useCallback((id: string) => chat.removeReaction(agentId, id), [chat, agentId])
  const retry = useCallback((id: string) => chat.retry(agentId, id), [chat, agentId])
  return { ...view, send, react, removeReaction, retry }
}
