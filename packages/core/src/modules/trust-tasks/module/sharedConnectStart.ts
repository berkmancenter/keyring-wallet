/**
 * sharedConnectStart — the two steps behind the shared-connect confirm screen
 * (plan WP3, WP4, WP10's expiry check):
 *
 *  1. {@link previewSharedConnect}: read the link and the inviter's DID
 *     document, offline, and say what the screen may show. Sends nothing.
 *  2. {@link startSharedConnect}: after the person taps Connect, check the
 *     link has not expired in the meantime, mint the encounter DID and keep
 *     the encounter record, then run the ceremony: open the relay session
 *     (TSP or the DIDComm v2 fallback) and send `propose`.
 *
 * Everything the screen shows from the link is either structural (a DID
 * prefix, a relay host parsed from the inviter's own document, an expiry) or
 * the sanitised `_label`, which the screen marks unverified. The link text is
 * never logged or returned.
 *
 * @module trust-tasks/module/sharedConnectStart
 */

import type { Agent } from '@credo-ts/core'

import { didPrefix } from './didPrefix'
import { chooseEncounterCarriage } from './sharedConnectCarriage'
import { SharedConnectSession } from './sharedConnect'
import { createEncounterDid, ENCOUNTER_LOG_PREFIX, saveEncounter, type EncounterRecord } from './sharedConnectEncounter'
import { resolveInviter, type InviterCarriage } from './sharedConnectInviter'
import { readTrigger, triggerAction, type TriggerUi } from './triggerLink'
import { resolveVtiMediator, type VtiMediatorEndpoints } from './VtiMediatorTransport'

/** What the confirm screen may show. Nothing here is the raw link. */
export interface SharedConnectPreview {
  /** The inviter's DID, in full, for the code that starts the ceremony. The screen shows `didShort`. */
  inviterDid: string
  didShort: string
  /** The sanitised `_label`, unverified; absent when none was sent or the label flag is off. */
  label?: string
  /** The host of the relay, when the inviter's service names an https URL; absent for a mediator named by DID. */
  relayHost?: string
  carriage: InviterCarriage
  /** `_exp`, seconds since the epoch. */
  exp: number
  /** The link's `_id`. */
  enactment: string
}

export type SharedConnectPreviewResult =
  | { kind: 'ready'; preview: SharedConnectPreview; endpoint: string }
  /** The link cannot be used; `ui` is the class of words to show (a reader outcome). */
  | { kind: 'refused'; ui: Exclude<TriggerUi, 'pass-on'> }

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** Read the link and the inviter's document. Sends nothing. */
export async function previewSharedConnect(
  agent: Agent,
  link: string,
  options: { now?: number } = {}
): Promise<SharedConnectPreviewResult> {
  const action = triggerAction(readTrigger(link, { now: options.now }))
  if (action.kind === 'say') return { kind: 'refused', ui: action.ui === 'pass-on' ? 'invalid' : action.ui }
  if (action.flow !== 'shared-connect') return { kind: 'refused', ui: 'update' }
  const trigger = action.trigger
  const resolution = await resolveInviter(agent, trigger.from)
  if (resolution.outcome === 'unresolved') return { kind: 'refused', ui: 'invalid' }
  if (resolution.outcome === 'no-common-transport') return { kind: 'refused', ui: 'unreachable' }
  return {
    kind: 'ready',
    endpoint: resolution.endpoint,
    preview: {
      inviterDid: trigger.from,
      didShort: didPrefix(trigger.from),
      ...(trigger.label ? { label: trigger.label } : {}),
      ...(resolution.relayHost ? { relayHost: resolution.relayHost } : {}),
      carriage: resolution.carriage,
      exp: trigger.exp as number,
      enactment: trigger.id,
    },
  }
}

export type SharedConnectStartResult =
  | { kind: 'started'; encounter: EncounterRecord }
  | { kind: 'refused'; ui: Exclude<TriggerUi, 'pass-on'> }
  | { kind: 'failed' }

/** The steps that reach out, injectable so the screen and the tests stay off the network. */
export interface SharedConnectStartDeps {
  resolveMediator: (agent: Agent, mediatorDid: string) => Promise<VtiMediatorEndpoints>
  createDid: typeof createEncounterDid
  save: typeof saveEncounter
  /** Open the carriage and run the ceremony for a saved encounter; resolves once `propose` is on its way. */
  run: (agent: Agent, encounter: EncounterRecord, mediator: VtiMediatorEndpoints) => Promise<void>
}

const sessions = new Map<string, SharedConnectSession>()
/** Starts under way or running, by enactment (the link's `_id`). */
const starting = new Map<string, Promise<SharedConnectStartResult>>()

/** The live session for an encounter, for retry and cancel from the screen. */
export const getSharedConnectSession = (enactment: string): SharedConnectSession | undefined => sessions.get(enactment)

async function runEncounter(agent: Agent, encounter: EncounterRecord, mediator: VtiMediatorEndpoints) {
  const live: { session?: SharedConnectSession } = {}
  const carriage = chooseEncounterCarriage({
    agent,
    encounter,
    mediator,
    onDocument: (document) => live.session?.handle(document),
  })
  const session = new SharedConnectSession(agent, encounter, carriage)
  live.session = session
  sessions.set(encounter.enactment, session)
  void session.finished.then(async () => {
    sessions.delete(encounter.enactment)
    await carriage.stop().catch(() => undefined)
  })
  try {
    await carriage.start()
    await session.start()
  } catch (error) {
    // Could not reach the relay or send: nothing was proposed that we can wait on.
    sessions.delete(encounter.enactment)
    await carriage.stop().catch(() => undefined)
    await session.cancel().catch(() => undefined)
    throw error
  }
}

const defaultDeps: SharedConnectStartDeps = {
  resolveMediator: resolveVtiMediator,
  createDid: createEncounterDid,
  save: saveEncounter,
  run: runEncounter,
}

/**
 * The person tapped Connect. The link is read again, so an expiry that passed
 * while the confirm screen was open is caught here (and an expired code is
 * never used), then the encounter DID is minted on the inviter's own mediator
 * (which avoids the cross-operator TSP failure, plan §3.3) and the encounter
 * is kept. Throws nothing the caller must handle: a failure is `failed`.
 */
export async function startSharedConnect(
  agent: Agent,
  link: string,
  options: { now?: number; deps?: Partial<SharedConnectStartDeps> } = {}
): Promise<SharedConnectStartResult> {
  const deps = { ...defaultDeps, ...options.deps }
  const now = options.now ?? nowSeconds()
  const previewed = await previewSharedConnect(agent, link, { now })
  if (previewed.kind === 'refused') return previewed
  const { preview, endpoint } = previewed
  // The relay must be a mediator named by DID: an https endpoint has no session to open yet (WP5).
  if (!endpoint.startsWith('did:')) return { kind: 'refused', ui: 'unreachable' }
  // One start per code: a second tap, or a second scan of the same code, while
  // the first is starting or its exchange runs, joins it. Two starts would mint
  // two encounter DIDs and send two proposes, and the inviter accepts one per `_id`.
  const key = preview.enactment
  const pending = starting.get(key)
  if (pending) return pending
  const attempt = startEncounter(agent, preview, endpoint, now, deps)
  starting.set(key, attempt)
  void attempt.then((result) => {
    const session = result.kind === 'started' ? sessions.get(key) : undefined
    if (session) void session.finished.then(() => starting.delete(key))
    else starting.delete(key)
  })
  return attempt
}

/** Mint the encounter DID, keep the record and run the ceremony. */
async function startEncounter(
  agent: Agent,
  preview: SharedConnectPreview,
  endpoint: string,
  now: number,
  deps: SharedConnectStartDeps
): Promise<SharedConnectStartResult> {
  try {
    const mediator = await deps.resolveMediator(agent, endpoint)
    const myVid = await deps.createDid(agent, mediator, { tsp: preview.carriage === 'tsp' })
    const encounter: EncounterRecord = {
      enactment: preview.enactment,
      myVid,
      theirVid: preview.inviterDid,
      carriage: preview.carriage,
      relay: endpoint,
      exp: preview.exp,
      state: 'confirmed',
      createdAt: new Date(now * 1000).toISOString(),
    }
    await deps.save(agent, encounter)
    await deps.run(agent, encounter, mediator)
    return { kind: 'started', encounter }
  } catch (error) {
    // The error's name only: its message may carry a DID or an endpoint the inviter chose.
    agent.config.logger.debug(
      `${ENCOUNTER_LOG_PREFIX} could not start an encounter with ${didPrefix(preview.inviterDid)}: ${
        error instanceof Error ? error.name : 'error'
      }`
    )
    return { kind: 'failed' }
  }
}
