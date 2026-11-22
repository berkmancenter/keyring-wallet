/**
 * sharedConnectCarriage — how an encounter's documents travel with no Credo
 * connection (plan WP5 and WP14).
 *
 * Both carriages run on a `VtiMediatorSession` logged in as the encounter DID
 * (one session per DID: the mediator binds the cleartext sender to the
 * session's DID).
 *
 *  - TSP: relationship forming first (a routed `XRFI`, once, because the
 *    reference implementation drops application messages from a sender with no
 *    relationship), then the Trust Task envelope packed and sealed to the
 *    inviter's VID. Inbound frames are opened with the identity checks of
 *    `unpackTrustTaskFromPeer`, and the TSP sender must be the inviter.
 *  - DIDComm v2: the document is the body of a plaintext authcrypted to the
 *    inviter and forwarded through the mediator (`sendTo`), as the VTI
 *    community leg does.
 *
 * {@link chooseEncounterCarriage} builds the one the encounter record names.
 * Nothing here is wired to the flag-off app: it is reached only from the
 * shared-connect start, behind the developer flag.
 *
 * @module trust-tasks/module/sharedConnectCarriage
 */

import { utils } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import type { tsp } from '@bifold/trust-tasks'

import { SHARED_CONNECT_TSP_REVISION } from './sharedConnectDecisions'
import { ENCOUNTER_LOG_PREFIX, type EncounterRecord } from './sharedConnectEncounter'
import type { EncounterTransport } from './sharedConnect'
import { isTspFrameUnopenable } from './tspFrameUnopenable'
import {
  greetPeerOverTsp,
  packTrustTaskForPeer,
  tspSessionForManager,
  unpackTrustTaskFromPeer,
  type TspSessionIdentity,
} from './vtiTsp'
import { VtiMediatorSession, vtiClientIdentityFromDid, type VtiMediatorEndpoints } from './VtiMediatorTransport'

export interface EncounterCarriage extends EncounterTransport {
  /** Open the relay session. Inbound documents go to `onDocument`. */
  start(): Promise<void>
  stop(): Promise<void>
}

/** The carriage's TSP revision from the decision constant ('1.0' is the codec's 'v1'). */
export const encounterTspRevision = (): tsp.TspRevision | undefined =>
  SHARED_CONNECT_TSP_REVISION === '1.0' ? 'v1' : undefined

/** The mediator-session surface the carriages use, so tests can stand in for a relay. */
export interface EncounterRelaySession {
  start(): Promise<void>
  stop(): Promise<void>
  sendTspFrame(bytes: Uint8Array): Promise<void>
  sendTo(peerDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void>
}

type SessionHandlers = {
  onTspFrame: (bytes: Uint8Array) => Promise<void>
  onMessage: (plaintext: DidCommV2PlaintextMessage) => Promise<void>
}

export interface EncounterCarriageOptions {
  agent: Agent
  encounter: EncounterRecord
  mediator: VtiMediatorEndpoints
  onDocument: (document: Record<string, unknown>) => void | Promise<void>
  /** Test seams. */
  openSession?: (handlers: SessionHandlers) => Promise<EncounterRelaySession>
  tspIdentity?: () => Promise<TspSessionIdentity>
}

async function defaultOpenSession(options: EncounterCarriageOptions, handlers: SessionHandlers) {
  const identity = await vtiClientIdentityFromDid(options.agent, options.encounter.myVid)
  return new VtiMediatorSession(options.agent, identity, options.mediator, handlers) as EncounterRelaySession
}

/** TSP with relationship forming (WP5). */
export function createTspEncounterCarriage(options: EncounterCarriageOptions): EncounterCarriage {
  const { agent, encounter, mediator } = options
  const logger = agent.config.logger
  let session: EncounterRelaySession | undefined
  let identity: TspSessionIdentity | undefined
  let greeted = false

  const onTspFrame = async (bytes: Uint8Array) => {
    if (!identity) throw new Error(`${ENCOUNTER_LOG_PREFIX} frame before the TSP identity was ready`)
    let opened
    try {
      opened = await unpackTrustTaskFromPeer(identity, bytes, encounter.myVid)
    } catch (error) {
      // A frame that can never be opened is acknowledged and dropped by the session; anything else is left queued.
      if (isTspFrameUnopenable(error)) {
        logger.warn(`${ENCOUNTER_LOG_PREFIX} dropped an unopenable frame (${error.reason})`)
        return
      }
      throw error
    }
    if (!opened) return // a control frame (the invite's accept), not a Trust Task
    if (opened.unpacked.sender !== encounter.theirVid) {
      logger.warn(`${ENCOUNTER_LOG_PREFIX} dropped a frame from a sender that is not the inviter`)
      return
    }
    await options.onDocument(opened.plaintext.body as Record<string, unknown>)
  }

  return {
    async start() {
      identity = await (options.tspIdentity ?? (() => tspSessionForManager(agent, encounter.myVid)))()
      session = await (options.openSession
        ? options.openSession({ onTspFrame, onMessage: async () => undefined })
        : defaultOpenSession(options, { onTspFrame, onMessage: async () => undefined }))
      await session.start()
    },
    async send(document) {
      if (!session || !identity) throw new Error(`${ENCOUNTER_LOG_PREFIX} the relay session is not open`)
      const revision = encounterTspRevision()
      if (!greeted) {
        // The route back to us ends at our own VID, not at the mediator alone (Rev 3, section 5.3.3).
        const invite = await greetPeerOverTsp(
          identity,
          encounter.myVid,
          encounter.theirVid,
          [mediator.did, encounter.myVid],
          revision
        )
        await session.sendTspFrame(invite.bytes)
        greeted = true
      }
      const packed = await packTrustTaskForPeer(identity, encounter.myVid, encounter.theirVid, document, revision)
      await session.sendTspFrame(packed.bytes)
      logger.info(
        `${ENCOUNTER_LOG_PREFIX} sent a ${packed.revision} frame (${packed.bytes.length} bytes, type ${String(document.type).split('/').slice(-3).join('/')})`
      )
    },
    async stop() {
      await session?.stop()
      session = undefined
    },
  }
}

/** DIDComm v2 with no connection (WP14). */
export function createDidCommEncounterCarriage(options: EncounterCarriageOptions): EncounterCarriage {
  const { agent, encounter } = options
  let session: EncounterRelaySession | undefined

  const onMessage = async (plaintext: DidCommV2PlaintextMessage) => {
    if (plaintext.from !== encounter.theirVid) {
      agent.config.logger.warn(`${ENCOUNTER_LOG_PREFIX} dropped a message from a sender that is not the inviter`)
      return
    }
    const body = plaintext.body as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object') return
    // The identity rule (binding section 3): a document naming an issuer names the authenticated sender.
    if (typeof body.issuer === 'string' && body.issuer !== plaintext.from) return
    await options.onDocument(body)
  }

  return {
    async start() {
      session = await (options.openSession
        ? options.openSession({ onTspFrame: async () => undefined, onMessage })
        : defaultOpenSession(options, { onTspFrame: async () => undefined, onMessage }))
      await session.start()
    },
    async send(document) {
      if (!session) throw new Error(`${ENCOUNTER_LOG_PREFIX} the relay session is not open`)
      const now = Math.floor(Date.now() / 1000)
      await session.sendTo(encounter.theirVid, {
        id: `urn:uuid:${utils.uuid()}`,
        typ: 'application/didcomm-plain+json',
        type: String(document.type),
        from: encounter.myVid,
        to: [encounter.theirVid],
        ...(typeof document.threadId === 'string' ? { thid: document.threadId } : {}),
        created_time: now,
        expires_time: now + 900,
        body: document,
      } as DidCommV2PlaintextMessage)
    },
    async stop() {
      await session?.stop()
      session = undefined
    },
  }
}

/** The carriage the encounter record names: TSP, or the DIDComm v2 fallback. */
export function chooseEncounterCarriage(options: EncounterCarriageOptions): EncounterCarriage {
  return options.encounter.carriage === 'tsp'
    ? createTspEncounterCarriage(options)
    : createDidCommEncounterCarriage(options)
}
