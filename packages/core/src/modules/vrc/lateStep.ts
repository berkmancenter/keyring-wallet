import type { Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { vrcFlowStore } from './witnessStatusStore'

/**
 * A remote VRC step that arrives late waits for both people (IN-448, 277.7).
 *
 * Pickup only runs while Keyring is open, so on a remote exchange each phone
 * can find the other's message long after it was sent: the inviter picked up
 * an acceptance 49 min late and the ceremony moved on by itself, then the
 * other phone answered 62 min after that and a Face ID prompt started with
 * nobody expecting it. Both sides were left in a step the other wasn't in.
 *
 * So a step that arrives late is HELD on this phone: nothing it would start
 * goes out (the relationship DID, the opening of the ceremony, the signing
 * after an acceptance) until both people say they are here. "Here" is a
 * ready-check answered within READY_WINDOW_MS; an answer that comes later is
 * itself late, and the person is asked again rather than signed for.
 *
 * Late is measured on the mediator's clock: its pickup status says when the
 * oldest queued message arrived (`oldest_received_time`). With other queued
 * messages that can overstate a wait, never understate it.
 *
 * @module vrc/lateStep
 */

/** A step found this long after it was sent is held (10 minutes, as approved on the IN-448 mock). */
export const LATE_STEP_MS = 10 * 60_000
/**
 * A ready-check and its answer must both happen within this, or it counts as nobody there. It gates the RELEASE,
 * not the signing: once released, the held steps run as an ordinary ceremony with no clock on them, so a slow
 * Face ID after release finishes as it does today.
 */
export const READY_WINDOW_MS = 2 * 60_000
/** A pickup status older than this says nothing about the message being processed now. */
const STATUS_FRESH_MS = 60_000

/** The connection metadata key that keeps a hold across an app restart. */
export const LATE_HOLD_METADATA_KEY = 'vrcLateHold'

let lastStatus: { at: number; oldest?: number } | undefined

/** Record a pickup status (DidCommStatusV2Message): when the oldest queued message reached the mediator. */
export function noteQueueStatus(oldest: Date | string | undefined, now: number = Date.now()): void {
  const at = oldest === undefined ? undefined : new Date(oldest).getTime()
  lastStatus = { at: now, oldest: at !== undefined && Number.isFinite(at) ? at : undefined }
}

/** How long the message being processed now waited on the mediator, as far as the last status says; 0 if unknown. */
export function queueWaitMs(now: number = Date.now()): number {
  if (!lastStatus || now - lastStatus.at > STATUS_FRESH_MS || lastStatus.oldest === undefined) return 0
  return Math.max(0, now - lastStatus.oldest)
}

/** For tests: forget the last status. */
export function resetQueueStatus(): void {
  lastStatus = undefined
}

/** Whole minutes for the person, never "0 min". */
export const minutesOf = (ms: number): number => Math.max(1, Math.round(ms / 60_000))

/** Why a step is held: a connection completed late, or an acceptance of our proposal came late. */
export type HeldReason = 'connected' | 'accepted'

export interface HeldStep {
  connectionId: string
  reason: HeldReason
  /** How long the step had waited when it was found. */
  waitedMs: number
  heldAt: number
  /** 'held': asking the person here; 'asking': a ready-check is out to the other phone. */
  phase: 'held' | 'asking'
  /** The person put it aside ("Not now", "Stop for now"); the chat offers it again. */
  dismissed: boolean
  check?: { id: string; sentAt: number }
  /** What the last answer was, for the words: the other person said not now, or said ready too late. */
  note?: 'notNow' | 'lateReady'
}

/** A ready-check from the other phone, waiting on this person. */
export interface PeerCheck {
  connectionId: string
  checkId: string
  waitedMs: number
  receivedAt: number
}

/** What a ready answer did to the hold it answered. */
export type AnswerOutcome = 'release' | 'late' | 'notNow' | 'stale'

class LateStepStore extends EventEmitter {
  private holds = new Map<string, HeldStep>()
  private pending = new Map<string, Array<() => Promise<void>>>()
  private peerChecks = new Map<string, PeerCheck>()

  private changed(connectionId: string) {
    this.emit('change', connectionId)
  }

  /** Hold this connection's steps. A second hold on the same connection keeps the first and the longer wait. */
  hold(step: Pick<HeldStep, 'connectionId' | 'reason' | 'waitedMs'> & { now?: number }): void {
    const existing = this.holds.get(step.connectionId)
    if (existing) {
      this.holds.set(step.connectionId, { ...existing, waitedMs: Math.max(existing.waitedMs, step.waitedMs) })
    } else {
      this.holds.set(step.connectionId, {
        connectionId: step.connectionId,
        reason: step.reason,
        waitedMs: step.waitedMs,
        heldAt: step.now ?? Date.now(),
        phase: 'held',
        dismissed: false,
      })
    }
    this.changed(step.connectionId)
  }

  isHeld(connectionId: string): boolean {
    return this.holds.has(connectionId)
  }

  get(connectionId: string): HeldStep | undefined {
    return this.holds.get(connectionId)
  }

  /** Keep `step` for when the hold is released; false when nothing is held, so the caller runs it now. */
  defer(connectionId: string, step: () => Promise<void>): boolean {
    if (!this.holds.has(connectionId)) return false
    this.pending.set(connectionId, [...(this.pending.get(connectionId) ?? []), step])
    return true
  }

  /** A ready-check went out for this hold. */
  asked(connectionId: string, checkId: string, now: number = Date.now()): void {
    const held = this.holds.get(connectionId)
    if (!held) return
    this.holds.set(connectionId, {
      ...held,
      phase: 'asking',
      dismissed: false,
      check: { id: checkId, sentAt: now },
      note: undefined,
    })
    this.changed(connectionId)
  }

  /** The ready-check `checkId` was not sent after all: the hold asks the person here again, as before it. */
  notAsked(connectionId: string, checkId: string): void {
    const held = this.holds.get(connectionId)
    if (!held || held.phase !== 'asking' || held.check?.id !== checkId) return
    this.holds.set(connectionId, { ...held, phase: 'held', check: undefined })
    this.changed(connectionId)
  }

  /** The person put the hold aside; with `stopAsking`, an outstanding check no longer counts. */
  dismiss(connectionId: string, stopAsking = false): void {
    const held = this.holds.get(connectionId)
    if (!held) return
    this.holds.set(connectionId, {
      ...held,
      dismissed: true,
      ...(stopAsking ? { phase: 'held' as const, check: undefined } : {}),
    })
    this.changed(connectionId)
  }

  /** The chat offers the hold again. */
  reopen(connectionId: string): void {
    const held = this.holds.get(connectionId)
    if (!held) return
    this.holds.set(connectionId, { ...held, dismissed: false })
    this.changed(connectionId)
  }

  /**
   * The other phone answered a ready-check. Ready within the window releases the hold; ready later, or not now,
   * leaves it held for the person to ask again; an answer to a check that is not the current one changes nothing.
   */
  answered(connectionId: string, checkId: string, ready: boolean, now: number = Date.now()): AnswerOutcome {
    const held = this.holds.get(connectionId)
    if (!held || held.phase !== 'asking' || held.check?.id !== checkId) return 'stale'
    if (ready && now - held.check.sentAt <= READY_WINDOW_MS) return 'release'
    const note = ready ? 'lateReady' : 'notNow'
    this.holds.set(connectionId, { ...held, phase: 'held', check: undefined, dismissed: false, note })
    this.changed(connectionId)
    return ready ? 'late' : 'notNow'
  }

  /** End the hold and hand back the steps it kept, in the order they were kept. */
  release(connectionId: string): Array<() => Promise<void>> {
    const steps = this.pending.get(connectionId) ?? []
    this.holds.delete(connectionId)
    this.pending.delete(connectionId)
    this.changed(connectionId)
    return steps
  }

  setPeerCheck(check: PeerCheck): void {
    this.peerChecks.set(check.connectionId, check)
    this.emit('peerCheck', check)
    this.changed(check.connectionId)
  }

  getPeerCheck(connectionId: string): PeerCheck | undefined {
    return this.peerChecks.get(connectionId)
  }

  /** The first ready-check waiting on this person: what the global sheet shows. */
  getAnyPeerCheck(): PeerCheck | undefined {
    return this.peerChecks.values().next().value
  }

  /** With `checkId`, only that check: one that came in since is kept. */
  clearPeerCheck(connectionId: string, checkId?: string): void {
    if (checkId !== undefined && this.peerChecks.get(connectionId)?.checkId !== checkId) return
    this.peerChecks.delete(connectionId)
    this.emit('peerCheck', undefined)
    this.changed(connectionId)
  }

  /** Forget everything about a connection (the exchange was stopped). */
  clear(connectionId: string): void {
    this.holds.delete(connectionId)
    this.pending.delete(connectionId)
    this.peerChecks.delete(connectionId)
    this.emit('peerCheck', undefined)
    this.changed(connectionId)
  }

  /** For tests. */
  reset(): void {
    this.holds.clear()
    this.pending.clear()
    this.peerChecks.clear()
  }
}

export const lateStepStore = new LateStepStore()

// ---- the messages ------------------------------------------------------------
//
// JSON basic messages, like the witness protocol's: the basic-message handler
// takes them out of the chat. A phone without this release shows them as text.

export const READY_CHECK_TYPE = 'vrc-ready-check'
export const READY_ANSWER_TYPE = 'vrc-ready'
export const STOP_TYPE = 'vrc-stop'

export type LateStepMessage =
  | { kind: 'check'; checkId: string; waitedMs: number }
  | { kind: 'answer'; checkId: string; ready: boolean }
  | { kind: 'stop' }

export const readyCheckMessage = (checkId: string, waitedMs: number): string =>
  JSON.stringify({ type: READY_CHECK_TYPE, checkId, waitedMs: Math.round(waitedMs) })
export const readyAnswerMessage = (checkId: string, ready: boolean): string =>
  JSON.stringify({ type: READY_ANSWER_TYPE, checkId, ready })
export const stopMessage = (): string => JSON.stringify({ type: STOP_TYPE })

/** One of this module's messages, from an already-parsed basic message; undefined for anything else. */
export function lateStepMessageOf(parsed: unknown): LateStepMessage | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const m = parsed as { type?: unknown; checkId?: unknown; waitedMs?: unknown; ready?: unknown }
  if (m.type === STOP_TYPE) return { kind: 'stop' }
  if (typeof m.checkId !== 'string' || !m.checkId) return undefined
  if (m.type === READY_CHECK_TYPE)
    return { kind: 'check', checkId: m.checkId, waitedMs: typeof m.waitedMs === 'number' ? m.waitedMs : 0 }
  if (m.type === READY_ANSWER_TYPE && typeof m.ready === 'boolean')
    return { kind: 'answer', checkId: m.checkId, ready: m.ready }
  return undefined
}

// ---- the actions ---------------------------------------------------------------

const LOG = '[VRC:LateStep]'
const newCheckId = (): string => `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function send(agent: Agent, connectionId: string, content: string): Promise<void> {
  await agent.modules.didcomm.basicMessages.sendMessage(connectionId, content)
}

/** What a kept hold remembers: enough to hold it again and know what it was holding. */
export interface KeptHold {
  waitedMs: number
  heldAt: number
  reason?: HeldReason
  /** For an 'accepted' hold: the exchange whose VRC is still to deliver, and whether it was an upgrade. */
  exchangeId?: string
  upgrade?: boolean
  /** Set when the hold ended. The marker is kept, never deleted: a restart reads a released one as nothing held. */
  releasedAt?: number
}

/** Remember a hold on the connection, so a restart holds it again rather than losing the step. */
export async function keepHold(
  agent: Agent,
  connectionId: string,
  waitedMs: number,
  extra: Pick<KeptHold, 'reason' | 'exchangeId' | 'upgrade'> = {}
): Promise<void> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  const kept: KeptHold = { waitedMs, heldAt: Date.now(), ...extra }
  connection.metadata.set(LATE_HOLD_METADATA_KEY, kept as unknown as Record<string, unknown>)
  await agent.modules.didcomm.connections.update(connection)
}

/** Mark the kept hold released (overwritten, not removed: nothing stored is deleted, and a rollback reads it too). */
async function markHoldReleased(agent: Agent, connectionId: string): Promise<void> {
  const connection = await agent.modules.didcomm.connections.findById(connectionId)
  const kept = connection?.metadata.get(LATE_HOLD_METADATA_KEY) as KeptHold | null | undefined
  if (!connection || !kept || kept.releasedAt !== undefined) return
  connection.metadata.set(LATE_HOLD_METADATA_KEY, { ...kept, releasedAt: Date.now() } as unknown as Record<
    string,
    unknown
  >)
  await agent.modules.didcomm.connections.update(connection)
}

/** A kept hold that still holds: present and not released. */
export const isLiveHold = (kept: KeptHold | null | undefined): kept is KeptHold =>
  Boolean(kept) && (kept as KeptHold).releasedAt === undefined

/** Release the hold: run what it kept, in order. Both people are here. */
export async function releaseHold(agent: Agent, connectionId: string): Promise<void> {
  const steps = lateStepStore.release(connectionId)
  agent.config.logger.info(`${LOG} released on ${connectionId}: running ${steps.length} held step(s)`)
  await markHoldReleased(agent, connectionId).catch((e: Error) =>
    agent.config.logger.warn(`${LOG} could not mark the kept hold released on ${connectionId}: ${e.message}`)
  )
  for (const step of steps) {
    await step().catch((e: Error) =>
      agent.config.logger.warn(`${LOG} a held step failed on ${connectionId}: ${e.message}`)
    )
  }
}

/** "Check X is ready": a ready-check to the other phone. */
export async function askPeerReady(agent: Agent, connectionId: string): Promise<void> {
  const held = lateStepStore.get(connectionId)
  if (!held) return
  const checkId = newCheckId()
  // Marked before the send, so an answer that comes back before the send resolves still finds its check.
  lateStepStore.asked(connectionId, checkId)
  try {
    await send(agent, connectionId, readyCheckMessage(checkId, held.waitedMs))
  } catch (e) {
    // Not sent: the card doesn't say "Asked" for a check the other phone never got. It offers the ask again.
    lateStepStore.notAsked(connectionId, checkId)
    throw e
  }
  agent.config.logger.info(`${LOG} ready-check ${checkId} sent on ${connectionId}`)
}

/** This person's answer to the other phone's ready-check. Ready also releases this phone's own hold, if any. */
export async function answerPeerCheck(agent: Agent, connectionId: string, ready: boolean): Promise<void> {
  const check = lateStepStore.getPeerCheck(connectionId)
  if (!check) return
  // Cleared once the answer is sent: if the send fails, the sheet still asks, and nothing here pretends it answered.
  await send(agent, connectionId, readyAnswerMessage(check.checkId, ready))
  lateStepStore.clearPeerCheck(connectionId, check.checkId)
  agent.config.logger.info(
    `${LOG} answered ready-check ${check.checkId} on ${connectionId}: ${ready ? 'ready' : 'not now'}`
  )
  if (ready && lateStepStore.isHeld(connectionId)) await releaseHold(agent, connectionId)
}

/** "Stop this exchange": tell the other phone, and end the flow here. */
export async function stopExchange(agent: Agent, connectionId: string): Promise<void> {
  lateStepStore.clear(connectionId)
  await markHoldReleased(agent, connectionId).catch(() => undefined)
  vrcFlowStore.clearFlow(connectionId, 'cancelled')
  await send(agent, connectionId, stopMessage())
  agent.config.logger.info(`${LOG} exchange stopped on ${connectionId}`)
}

/** A late-step message from the other phone (the basic-message handler calls this; it is not shown in chat). */
export async function handleLateStepMessage(
  agent: Agent,
  connectionId: string,
  message: LateStepMessage,
  now: number = Date.now()
): Promise<void> {
  if (message.kind === 'check') {
    lateStepStore.setPeerCheck({ connectionId, checkId: message.checkId, waitedMs: message.waitedMs, receivedAt: now })
    agent.config.logger.info(`${LOG} ready-check ${message.checkId} received on ${connectionId}`)
    return
  }
  if (message.kind === 'stop') {
    lateStepStore.clear(connectionId)
    await markHoldReleased(agent, connectionId).catch(() => undefined)
    vrcFlowStore.clearFlow(connectionId, 'cancelled')
    agent.config.logger.info(`${LOG} the other phone stopped the exchange on ${connectionId}`)
    return
  }
  const outcome = lateStepStore.answered(connectionId, message.checkId, message.ready, now)
  agent.config.logger.info(`${LOG} answer to ${message.checkId} on ${connectionId}: ${outcome}`)
  if (outcome === 'release') await releaseHold(agent, connectionId)
}
