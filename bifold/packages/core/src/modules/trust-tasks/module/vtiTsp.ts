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
import { TspFrameUnopenable } from './tspFrameUnopenable'
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

/**
 * Everything a session needs to speak TSP as the phone's own MANAGER identity —
 * the `did:peer` it enrolled with its VTA — rather than as a persona.
 *
 * This is what puts the phone↔VTA leg on TSP. A persona borrows its keys from
 * the VTA; the manager's key was minted here, so it is in the wallet's own KMS.
 * One Ed25519 key backs both ports: `keyAgreementFromAskarKey` converts it to
 * X25519 at use, which is exactly how a did:peer:2 derives its agreement key
 * from the same inception key. The public halves come from the manager's own
 * document, so what this identity claims is what the VTA's resolver will see.
 */
export async function tspSessionForManager(agent: Agent, managerDid: string): Promise<TspSessionIdentity> {
  const { didDocument, keys } = await agent.dids.resolveCreatedDidDocumentWithKeys(managerDid)
  const signingRef = didDocument.assertionMethod?.[0] ?? didDocument.authentication?.[0]
  const signingVm =
    typeof signingRef === 'string'
      ? didDocument.dereferenceKey(signingRef, ['assertionMethod', 'authentication'])
      : signingRef
  if (!signingVm) throw new Error(`${LOG_PREFIX} ${managerDid} has no signing verification method`)
  const kmsKey = (keys ?? []).find((key) => signingVm.id.endsWith(key.didDocumentRelativeKeyId))
  if (!kmsKey) throw new Error(`${LOG_PREFIX} no KMS key backs ${signingVm.id}`)

  const resolver = createVtiVidResolver(agent)
  const published = await resolver.resolve(managerDid)
  return {
    identity: {
      signingKey: signingKeyFromEd25519Key(agent, kmsKey.kmsKeyId, published.signingPublicKey),
      keyAgreement: keyAgreementFromAskarKey(agent, kmsKey.kmsKeyId, published.encryptionPublicKey),
    },
    resolver,
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
  document: Record<string, unknown>,
  revision?: tsp.TspRevision
): Promise<tsp.PackedMessage> {
  const body = tsp.encodeTrustTaskEnvelope(document)
  // A reply goes out in the version the peer wrote in (TSP 1.0 cutover plan
  // §6.1, B3): that is evidence, not a guess. Otherwise the session's codec.
  if (revision === 'v1') return tsp.packV1(body, fromDid, toDid, session.identity, session.resolver)
  return session.codec.pack(body, fromDid, toDid, session.identity, session.resolver)
}

/**
 * Greet a peer so it will accept what follows (§7.2.2).
 *
 * Rev 3 forbids opening with an application message: a peer that holds no
 * relationship with the sender **drops** it rather than refusing, so nothing
 * comes back and the sender sees a timeout. One invite fixes that for the
 * lifetime of the relationship — the peer records it on arrival and a recorded
 * relationship already admits application messages, so this is send-only and
 * there is nothing to await.
 *
 * **Routed, not direct**, and this is the part that is easy to get wrong.
 * Every frame this session sends travels through the mediator, and the invite
 * has to travel the same way: a mediator refuses direct delivery unless
 * configured to allow it, so a direct invite fails while looking like a
 * protocol fault. The route is also what tells the peer where to send its
 * accept (§7.2.4).
 */
export async function greetPeerOverTsp(
  session: TspSessionIdentity,
  fromDid: string,
  toDid: string,
  route: string[],
  revision?: tsp.TspRevision
): Promise<tsp.PackedMessage> {
  if (revision === 'v1') return tsp.packInviteV1(fromDid, toDid, session.identity, session.resolver, { route })
  return tsp.packInviteRev3(fromDid, toDid, session.identity, session.resolver, { route })
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

/** How far opening a frame got: what makes its failure lasting or not (unpackTrustTaskFromPeer). */
type OpenStage = 'reading' | 'resolving' | 'keyUsed' | 'keyUnavailable'

/**
 * Open a TSP frame addressed to the persona and read the Trust Task in it.
 * Returns `undefined` for a frame that is TSP but not a Trust Task envelope.
 * The framework's identity rule (binding §3): a document naming an `issuer`
 * must name the VID TSP authenticated, and a `recipient` must be us.
 *
 * A frame that can never be opened here throws {@link TspFrameUnopenable}, so
 * the session acknowledges and drops it. Whether its unsealing failed for a
 * lasting reason is read from the key, not the error's words: the receiver's
 * key agreement is watched, and only a failure after the key was used is one.
 * A key that could not be used (not in memory yet, a fetch that failed) throws
 * as it is, and the frame stays queued for when the key is there.
 */
export async function unpackTrustTaskFromPeer(
  session: TspSessionIdentity,
  bytes: Uint8Array,
  expectedReceiver: string
): Promise<{ plaintext: DidCommV2PlaintextMessage; unpacked: tsp.UnpackedMessage } | undefined> {
  let unpacked: tsp.UnpackedMessage
  // Two constraints this relies on, both true of rev2 and rev3 today and worth keeping so:
  //  - a codec never resolves again after the key was used (a resolve then would go unseen, read as unsealFailed);
  //  - the resolver does not cache (createVtiVidResolver resolves in the call). rev2 opens with the sender's
  //    encryption key from that resolve, so a stale cached key would fail after `agree` and read as lasting: a
  //    frame from a sender who rotated would be dropped for good. Uncached, a rotation mid-call is a race, not a state.
  // Watch how far opening got: only two stages make a failure lasting. Reading the bytes, before anything is
  // resolved (malformed); and the receiver's key used, and still nothing opened (sealed to another key). In
  // between, the sender's DID is resolved over the network and its signature checked against that document: a
  // failure there can be the network or a document just rotated, so it is not a verdict on the frame.
  // Cast, not annotated: the stage moves inside the resolver and key closures below, which control-flow narrowing
  // does not follow, so an annotated `'reading'` would read as never anything else in the catch.
  let stage = 'reading' as OpenStage
  const resolver: tsp.VidResolver = {
    ...session.resolver,
    resolve: async (vid: string) => {
      if (stage === 'reading') stage = 'resolving'
      return session.resolver.resolve(vid)
    },
  }
  const agreement = session.identity.keyAgreement
  const identity: tsp.TspIdentity = {
    ...session.identity,
    keyAgreement: {
      publicKey: agreement.publicKey,
      agree: async (peerPublicKey) => {
        try {
          const secret = await agreement.agree(peerPublicKey)
          stage = 'keyUsed'
          return secret
        } catch (error) {
          stage = 'keyUnavailable'
          throw error
        }
      },
    },
  }
  try {
    unpacked = await session.codec.unpack(bytes, identity, resolver)
  } catch (error) {
    // A relationship-forming control frame is not a Trust Task, and it is not
    // a failure either: it is the peer's ACCEPT to the invite we sent. Reported
    // as "no Trust Task here" so the caller logs it and the frame is then
    // acknowledged like any other. Thrown instead, it skipped the
    // acknowledgement and stayed queued against the peer that sent it — one
    // stranded accept per applicant, charged to the community.
    if (String((error as Error)?.message ?? '').startsWith(tsp.CONTROL_FRAME_RECEIVED)) return undefined
    const detail = String((error as Error)?.message ?? error).slice(0, 160)
    // A version marker this build cannot read (the peek's `E_TSP_REVISION`): named,
    // so the log says "a TSP version this build does not read" rather than
    // "could not be read". Checked on the code, not the class, which may come
    // from another bundle copy.
    const revisionError = error as { code?: unknown; major?: unknown; minor?: unknown }
    if (revisionError?.code === 'E_TSP_REVISION' && typeof revisionError.major === 'number')
      throw new TspFrameUnopenable(
        'versionMismatch',
        `${LOG_PREFIX} frame declares TSP ${revisionError.major}.${String(revisionError.minor ?? '?')}, which this build does not read (it reads Rev 2, Rev 3 and 1.0): ${detail}`
      )
    if (stage === 'keyUsed')
      throw new TspFrameUnopenable(
        'unsealFailed',
        `${LOG_PREFIX} frame failed after this key was used (sealed to another key, or what it carries cannot be read): ${detail}`
      )
    if (stage === 'reading')
      throw new TspFrameUnopenable('malformed', `${LOG_PREFIX} frame could not be read: ${detail}`)
    // Resolving its sender, checking its signature, or a key not usable yet: transient, left queued.
    throw error
  }
  if (unpacked.receiver !== expectedReceiver) {
    throw new TspFrameUnopenable(
      'otherReceiver',
      `${LOG_PREFIX} frame addressed to ${unpacked.receiver}, not this persona`
    )
  }
  const document = tsp.decodeTrustTaskEnvelope(unpacked.payload)
  if (!document) return undefined
  if (typeof document.issuer === 'string' && document.issuer !== unpacked.sender) {
    throw new TspFrameUnopenable(
      'identityMismatch',
      `${LOG_PREFIX} identityMismatch: document issuer ${document.issuer} is not the TSP sender ${unpacked.sender}`
    )
  }
  if (typeof document.recipient === 'string' && document.recipient !== unpacked.receiver) {
    throw new TspFrameUnopenable(
      'identityMismatch',
      `${LOG_PREFIX} identityMismatch: document recipient ${document.recipient} is not this persona`
    )
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
  /**
   * For a TSP 1.0 record only: until when it may decide carriage on its own
   * (TSP 1.0 cutover plan §6.2, row 3). Written when the frame is recorded, so
   * a later change to the window cannot silently stretch a record already held.
   */
  expiresAt?: string
  /** Set when a TSP 1.0 ask to this peer went unanswered; the next 1.0 frame clears it. */
  stale?: boolean
}

/** How long a TSP 1.0 frame from a peer lets later sessions speak TSP 1.0 to it unprobed (§6.2, row 3). */
export const V1_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Whether `record` still says the peer speaks TSP 1.0: a 1.0 frame, not stale, not past its own expiry. */
export function isFreshV1(record: PeerRevisionRecord | undefined, now = new Date().valueOf()): boolean {
  if (!record || record.revision !== 'v1' || record.stale || !record.expiresAt) return false
  return Date.parse(record.expiresAt) > now
}

export interface TspPeerRevisionStore {
  get(vid: string): Promise<PeerRevisionRecord | undefined>
  list(): Promise<PeerRevisionRecord[]>
  observe(vid: string, revision: tsp.TspRevision, minor?: number): Promise<PeerRevisionRecord>
  /** A TSP 1.0 ask to `vid` went unanswered: the record no longer decides carriage (§6.2, change 2). */
  markStale(vid: string): Promise<void>
}

/** The record a new observation makes, from the one before it. */
function nextRecord(
  vid: string,
  revision: tsp.TspRevision,
  minor: number | undefined,
  previous: PeerRevisionRecord | undefined,
  now: number
): PeerRevisionRecord {
  const at = new Date(now).toISOString()
  return {
    vid,
    revision,
    ...(minor !== undefined ? { minor } : {}),
    // A peer that changes revision starts a new "since when".
    firstSeenAt: previous && previous.revision === revision ? previous.firstSeenAt : at,
    lastSeenAt: at,
    ...(revision === 'v1' ? { expiresAt: new Date(now + V1_RECORD_TTL_MS).toISOString() } : {}),
  }
}

const RECORD_TYPE = 'keyring/tsp-peer-revision'

/**
 * Survives a restart. Read by the reply rule (answer a peer in the version it
 * wrote in) and, for TSP 1.0, by the per-peer carriage rule (§6.2, row 3).
 */
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
    const [existing] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, vid })
    const previous = existing?.content as unknown as PeerRevisionRecord | undefined
    const next = nextRecord(vid, revision, minor, previous, new Date().valueOf())
    if (existing) {
      existing.content = { ...next }
      await this.agent.genericRecords.update(existing)
    } else {
      await this.agent.genericRecords.save({ content: { ...next }, tags: { recordType: RECORD_TYPE, vid } })
    }
    return next
  }

  async markStale(vid: string): Promise<void> {
    const [existing] = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, vid })
    if (!existing) return
    existing.content = { ...(existing.content as Record<string, unknown>), stale: true }
    await this.agent.genericRecords.update(existing)
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
    const next = nextRecord(vid, revision, minor, this.records.get(vid), new Date().valueOf())
    this.records.set(vid, next)
    return next
  }
  async markStale(vid: string) {
    const record = this.records.get(vid)
    if (record) this.records.set(vid, { ...record, stale: true })
  }
}
