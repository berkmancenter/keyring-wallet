/**
 * vtiTsp — TSP on the VTI peer leg (applicant ↔ vetter): the persona's TSP
 * identity, a VID resolver for the DIDs a VTI stack publishes, the Trust
 * Task envelope round trip, and the record of what each peer was seen to
 * speak.
 *
 * The persona (`did:webvh`, minted by the VTA, keys borrowed into Askar) is
 * the VID on both ends; a message is TSP Rev 3 direct, sealed HPKE-Base to
 * the peer's `keyAgreement` key and signed with the persona's borrowed
 * Ed25519 key. It rides the same authenticated mediator socket the DIDComm
 * v2 leg uses, as a binary frame (`VtiMediatorSession.sendTspFrame`).
 *
 * **Which carriage the peer leg uses is a build-time choice**
 * (`tsp_rev3_subtask.md` §2.3): {@link setPeerLegCarriage} is called once
 * from the app's container setup, from configuration baked into the build,
 * and defaults to DIDComm so an unconfigured build behaves as before. It is
 * not a user setting and it is not negotiated per message. A wallet reads
 * both carriages regardless — an inbound TSP frame is unpacked whenever the
 * session holds a TSP identity — so a fleet can be switched one side at a
 * time.
 *
 * @module trust-tasks/module/vtiTsp
 */

import type { Agent } from '@credo-ts/core'
import { getPublicJwkFromVerificationMethod, Kms } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { tsp } from '@bifold/trust-tasks'
import { keyAgreementFromAskarKey, signingKeyFromEd25519Key } from '@bifold/credo-tsp-adapter'

import type { VtiPersona } from './VtiIdentityStore'
import { resolveDidDocumentRetrying } from './VtiMediatorTransport'

export const LOG_PREFIX = '[TrustTasks:VtiTsp]'

/** How Trust Task documents travel between two personas on the peer leg. */
export type PeerLegCarriage = 'didcomm' | 'tsp'

let peerLegCarriage: PeerLegCarriage = 'didcomm'

/** Build-time wiring: called once from the app's container with the baked-in choice. */
export function setPeerLegCarriage(carriage: PeerLegCarriage): void {
  peerLegCarriage = carriage
}

export function getPeerLegCarriage(): PeerLegCarriage {
  return peerLegCarriage
}

/**
 * A `VidResolver` for the DIDs a VTI stack publishes (`did:webvh` personas
 * and communities, `did:peer:2` clients). Unlike the adapter's resolver it
 * follows a verification method referenced by id, which is how a
 * `did:webvh` document lists its `authentication` and `keyAgreement`.
 */
export function createVtiVidResolver(agent: Agent): tsp.VidResolver {
  return {
    async resolve(vid) {
      const doc = await resolveDidDocumentRetrying(agent, vid)
      const dereference = (
        entries: Array<string | { id: string }> | undefined,
        purpose: Parameters<typeof doc.dereferenceKey>[1]
      ) => {
        for (const entry of entries ?? []) {
          const vm = typeof entry === 'string' ? doc.dereferenceKey(entry, purpose) : entry
          if (vm) return vm as ReturnType<typeof doc.dereferenceKey>
        }
        return undefined
      }
      const signingVm =
        dereference(doc.assertionMethod, ['assertionMethod']) ?? dereference(doc.authentication, ['authentication'])
      if (!signingVm) throw new Error(`${LOG_PREFIX} no signing verification method on ${vid}`)
      const keyAgreementVm = dereference(doc.keyAgreement, ['keyAgreement'])
      if (!keyAgreementVm) throw new Error(`${LOG_PREFIX} no keyAgreement verification method on ${vid}`)
      const signing = getPublicJwkFromVerificationMethod(signingVm)
      const agreement = getPublicJwkFromVerificationMethod(keyAgreementVm)
      if (!signing.is(Kms.Ed25519PublicJwk)) throw new Error(`${LOG_PREFIX} ${vid} does not sign with Ed25519`)
      if (!agreement.is(Kms.X25519PublicJwk)) throw new Error(`${LOG_PREFIX} ${vid} does not agree with X25519`)
      return {
        signingPublicKey: (signing.publicKey as { publicKey: Uint8Array }).publicKey,
        encryptionPublicKey: (agreement.publicKey as { publicKey: Uint8Array }).publicKey,
      }
    },
  }
}

/**
 * The persona's TSP ports: its borrowed Ed25519 key signs, its borrowed
 * X25519 key opens. Public halves come from the persona's own document, so
 * what this identity claims is what a peer's resolver will see.
 */
export async function tspIdentityFromPersona(agent: Agent, persona: VtiPersona): Promise<tsp.TspIdentity> {
  const signingKmsId = persona.kmsKeyIds?.signing
  const agreementKmsId = persona.kmsKeyIds?.keyAgreement
  if (!signingKmsId || !agreementKmsId) {
    throw new Error(`${LOG_PREFIX} persona ${persona.did} has no borrowed keys`)
  }
  const keys = await createVtiVidResolver(agent).resolve(persona.did)
  return {
    signingKey: signingKeyFromEd25519Key(agent, signingKmsId, keys.signingPublicKey),
    keyAgreement: keyAgreementFromAskarKey(agent, agreementKmsId, keys.encryptionPublicKey),
  }
}

/** Everything a session needs to speak TSP as a persona. */
export interface TspSessionIdentity {
  identity: tsp.TspIdentity
  resolver: tsp.VidResolver
  codec: tsp.TspCodec
}

export async function tspSessionForPersona(agent: Agent, persona: VtiPersona): Promise<TspSessionIdentity> {
  return {
    identity: await tspIdentityFromPersona(agent, persona),
    resolver: createVtiVidResolver(agent),
    codec: tsp.createTspCodec(),
  }
}

/** Short-form or long-form, for a log line. */
export const frameForm = (bytes: Uint8Array) => (bytes[0] === tsp.TSP_MAGIC_BYTE_LONG ? 'long' : 'short')

/**
 * Pack a Trust Task document for a peer: the binding envelope, sealed and
 * signed as the persona.
 */
export async function packTrustTaskForPeer(
  session: TspSessionIdentity,
  fromDid: string,
  toDid: string,
  document: Record<string, unknown>
): Promise<tsp.PackedMessage> {
  return session.codec.pack(tsp.encodeTrustTaskEnvelope(document), fromDid, toDid, session.identity, session.resolver)
}

/**
 * The shape the rest of the module reads — `vtiVetting` and the inbox handle
 * a DIDComm v2 plaintext, reading `type`, `id`, `thid`, `from` and `body`. A
 * Trust Task document that arrived over TSP is presented the same way: the
 * document is the body, its own id and `threadId` are the message id and
 * thread, and the authenticated TSP sender is `from`.
 */
export function plaintextFromTrustTask(
  document: Record<string, unknown>,
  sender: string,
  receiver: string
): DidCommV2PlaintextMessage {
  const threadId = document.threadId
  return {
    id: String(document.id ?? ''),
    typ: 'application/didcomm-plain+json',
    type: String(document.type ?? ''),
    from: sender,
    to: [receiver],
    ...(typeof threadId === 'string' && threadId ? { thid: threadId } : {}),
    body: document,
  } as DidCommV2PlaintextMessage
}

/**
 * Open a TSP frame addressed to the persona and read the Trust Task in it.
 * Returns `undefined` for a frame that is TSP but not a Trust Task envelope.
 * The framework's identity rule (binding §3): a document naming an `issuer`
 * must name the VID TSP authenticated, and a `recipient` must be us.
 */
export async function unpackTrustTaskFromPeer(
  session: TspSessionIdentity,
  bytes: Uint8Array,
  expectedReceiver: string
): Promise<{ plaintext: DidCommV2PlaintextMessage; unpacked: tsp.UnpackedMessage } | undefined> {
  const unpacked = await session.codec.unpack(bytes, session.identity, session.resolver)
  if (unpacked.receiver !== expectedReceiver) {
    throw new Error(`${LOG_PREFIX} frame addressed to ${unpacked.receiver}, not this persona`)
  }
  const document = tsp.decodeTrustTaskEnvelope(unpacked.payload)
  if (!document) return undefined
  if (typeof document.issuer === 'string' && document.issuer !== unpacked.sender) {
    throw new Error(
      `${LOG_PREFIX} identityMismatch: document issuer ${document.issuer} is not the TSP sender ${unpacked.sender}`
    )
  }
  if (typeof document.recipient === 'string' && document.recipient !== unpacked.receiver) {
    throw new Error(`${LOG_PREFIX} identityMismatch: document recipient ${document.recipient} is not this persona`)
  }
  return { plaintext: plaintextFromTrustTask(document, unpacked.sender, unpacked.receiver), unpacked }
}

// ---------------------------------------------------------------------------
// The per-peer record (§2.2): what a peer was observed to speak, and since when.
// ---------------------------------------------------------------------------

export interface PeerRevisionRecord {
  vid: string
  revision: tsp.TspRevision
  /** MINOR as carried, unjudged. */
  minor?: number
  firstSeenAt: string
  lastSeenAt: string
}

export interface TspPeerRevisionStore {
  get(vid: string): Promise<PeerRevisionRecord | undefined>
  list(): Promise<PeerRevisionRecord[]>
  observe(vid: string, revision: tsp.TspRevision, minor?: number): Promise<PeerRevisionRecord>
}

const RECORD_TYPE = 'keyring/tsp-peer-revision'

/** Survives a restart; never consulted by a packer. */
export class GenericRecordsTspPeerRevisionStore implements TspPeerRevisionStore {
  constructor(private readonly agent: Agent) {}

  async get(vid: string): Promise<PeerRevisionRecord | undefined> {
    const [record] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, vid })
    return record ? (record.content as unknown as PeerRevisionRecord) : undefined
  }

  async list(): Promise<PeerRevisionRecord[]> {
    const records = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE })
    return records.map((r) => r.content as unknown as PeerRevisionRecord)
  }

  async observe(vid: string, revision: tsp.TspRevision, minor?: number): Promise<PeerRevisionRecord> {
    const now = new Date().toISOString()
    const [existing] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, vid })
    const previous = existing?.content as unknown as PeerRevisionRecord | undefined
    const next: PeerRevisionRecord = {
      vid,
      revision,
      ...(minor !== undefined ? { minor } : {}),
      // A peer that changes revision starts a new "since when".
      firstSeenAt: previous && previous.revision === revision ? previous.firstSeenAt : now,
      lastSeenAt: now,
    }
    if (existing) {
      existing.content = { ...next }
      await this.agent.genericRecords.update(existing)
    } else {
      await this.agent.genericRecords.save({ content: { ...next }, tags: { recordType: RECORD_TYPE, vid } })
    }
    return next
  }
}

/** In-memory twin, for tests and for a session with no wallet at hand. */
export class MemoryTspPeerRevisionStore implements TspPeerRevisionStore {
  private readonly records = new Map<string, PeerRevisionRecord>()
  async get(vid: string) {
    return this.records.get(vid)
  }
  async list() {
    return [...this.records.values()]
  }
  async observe(vid: string, revision: tsp.TspRevision, minor?: number) {
    const now = new Date().toISOString()
    const previous = this.records.get(vid)
    const next: PeerRevisionRecord = {
      vid,
      revision,
      ...(minor !== undefined ? { minor } : {}),
      firstSeenAt: previous && previous.revision === revision ? previous.firstSeenAt : now,
      lastSeenAt: now,
    }
    this.records.set(vid, next)
    return next
  }
}
