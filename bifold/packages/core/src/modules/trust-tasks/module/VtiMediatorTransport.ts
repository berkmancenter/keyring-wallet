/**
 * VtiMediatorTransport — the VTA/VTC leg: a Credo DIDComm v2 transport for an
 * Affinidi-style ("ATM") mediator, which is what every VTI agent advertises.
 *
 * Keyring's own mediator speaks Aries mediation, and `DidCommV2Carriage` rides
 * it. A VTA or a VTC does not: it publishes a `DIDCommMessaging` service whose
 * endpoints are an HTTPS base and a `wss://` socket, and a client reaches it by
 *
 *   1. `POST <auth>/challenge` with its own DID → `{ challenge, session_id }`;
 *   2. an `https://affinidi.com/atm/1.0/authenticate` plaintext carrying that
 *      challenge, **authcrypt-packed by Credo** to the mediator → a JWT;
 *   3. one WebSocket per DID, opened with `["bearer.<jwt>", "didcomm"]`, and a
 *      Pickup 3.0 `live-delivery-change` so frames arrive unprompted;
 *   4. outbound: Credo's packed JWE wrapped in a Routing 2.0 `forward` whose
 *      `next` is the peer, the forward itself packed by Credo to the mediator.
 *
 * The same socket also carries **TSP**. A TSP message goes out as a binary
 * frame of raw qb2 bytes — the mediator sniffs the leading count code (`0xF8`
 * short-framed, `0xFB` long-framed), binds the cleartext sender VID to the
 * authenticated session, and stores it for the receiver VID — and comes in as
 * a text frame of the same bytes base64url-encoded (`-E…` / `--E…`), which
 * {@link tsp.isTspFrameText} tells apart from a DIDComm JWE before either is
 * parsed. A TSP frame is acknowledged like any queued message, by the id the
 * mediator gave it: SHA-256 of the text exactly as delivered. This is how the
 * upstream client frames TSP on the same socket, and it is what
 * `tsp_rev3_subtask.md` §3.3 measured: a classifier that knows only `-E`
 * drops every Rev 3 message past ~12 KB.
 *
 * No key ever leaves Askar: every pack goes through Credo's own
 * `DidCommV2EnvelopeService`, and inbound frames go to `DidCommMessageReceiver`,
 * so a delivered message becomes a normal Credo message with its connection.
 *
 * Deliberately depends on Credo alone. The Node rung that proved this shape
 * (`tsp-reference/ref-18`) used `@openvtc/vti-didcomm-js` for the mediator's
 * DID document and three plaintext builders; the app already registers a
 * `did:webvh` resolver, and the builders are the four literals below — so
 * adding that package to the bundle would buy nothing and cost a second
 * `didwebvh-ts` copy on Metro.
 *
 * @module trust-tasks/module/VtiMediatorTransport
 */

import type { Agent } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  createPeerDidDocumentFromServices,
  getPublicJwkFromVerificationMethod,
  Kms,
  NewDidCommV2Service,
  NewDidCommV2ServiceEndpoint,
  PeerDidNumAlgo,
  TypedArrayEncoder,
  utils,
} from '@credo-ts/core'
import type { DidCommV2EncryptedMessage, DidCommV2KeyAgreementJwk, DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { DidCommMessageReceiver, DidCommV2EnvelopeService } from '@credo-ts/didcomm'
import { tsp } from '@bifold/trust-tasks'

const LOG_PREFIX = '[TrustTasks:VtiMediatorTransport]'

const ATM_AUTHENTICATE = 'https://affinidi.com/atm/1.0/authenticate'
const FORWARD = 'https://didcomm.org/routing/2.0/forward'
const LIVE_DELIVERY_CHANGE = 'https://didcomm.org/messagepickup/3.0/live-delivery-change'
const MESSAGES_RECEIVED = 'https://didcomm.org/messagepickup/3.0/messages-received'
const DELIVERY_REQUEST = 'https://didcomm.org/messagepickup/3.0/delivery-request'
const DELIVERY_POLL_MS = 15000
const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'
const PICKUP_PROTOCOL = 'https://didcomm.org/messagepickup/3.0/'
const PICKUP_STATUS = 'https://didcomm.org/messagepickup/3.0/status'
/** A resync never starts a second drain within this long of the last one. */
const RESYNC_DEBOUNCE_MS = 1000
/**
 * How long a websocket gets to open. Without a bound, a connect that stalls
 * (no open, error or close event: a TLS connect hanging in a tunnel) held
 * `start()` until the caller's own deadline, and the person saw only "Something
 * went wrong while linking" (iOS, 2026-09-25: the mediator logged the login and
 * never an upgrade). vti-didcomm-js bounds its connect the same way
 * (mediator-transport.js, `connectTimeoutMs`, 15 s). Two tries fit inside the
 * 30 s connect deadline a grant check allows (vtaAgent GRANT_CONNECT_DEADLINE_MS).
 */
export const SOCKET_OPEN_TIMEOUT_MS = 8000
const SOCKET_OPEN_TIMEOUT = 'socket did not open'
const isOpenTimeout = (error: unknown) => error instanceof Error && error.message.includes(SOCKET_OPEN_TIMEOUT)
const PLAIN = 'application/didcomm-plain+json'
const WS_APP_SUBPROTOCOL = 'didcomm'

const nowSec = () => Math.floor(Date.now() / 1000)
const isPickup = (type: unknown) => typeof type === 'string' && type.startsWith(PICKUP_PROTOCOL)

interface DeliveryMessage {
  type?: string
  attachments?: { id?: string; data?: { json?: unknown; base64?: string } }[]
}
// Hermes has no `crypto.randomUUID` — react-native-get-random-values polyfills
// `getRandomValues` and nothing else — so ids come from Credo's own helper.
const uuid = () => `urn:uuid:${utils.uuid()}`

/** What the mediator's DID document tells a client, resolved through Credo. */
export interface VtiMediatorEndpoints {
  did: string
  /** `https://…/mediator/v1` — `/challenge` and the authenticate POST hang off it. */
  authEndpoint: string
  /** `wss://…/mediator/v1/ws` — one socket per DID. */
  wsEndpoint: string
  /** The mediator's key-agreement key, as Credo reads it, and its kid. */
  publicJwk: DidCommV2KeyAgreementJwk
  kid: string
}

/**
 * Resolve a DID document, retrying on transient failure. A `did:webvh` behind a
 * tunnel answers a burst of resolutions with 421/429 or an HTML page (VTI-19 —
 * measured on iOS as "JSON Parse error: Unexpected character: R"); Credo caches
 * a successful resolution, so one patient first look is all that is needed.
 */
export async function resolveDidDocumentRetrying(agent: Agent, did: string, attempts = 4) {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await agent.dids.resolveDidDocument(did)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 800 * (i + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Read the mediator's endpoints and key agreement key out of its DID document.
 * Both `DIDCommMessaging` service entries are published; which is which is
 * decided by scheme, not by order.
 */
/**
 * The mediator a DID's own document says it is reached through: the DID in its
 * `DIDCommMessaging` service (a VTA's, a persona's). Undefined when it names
 * none — a plain URL endpoint, or no service at all.
 *
 * This is what a session for that DID must authenticate to: a persona minted
 * by a VTA on the VTA Farm names the Farm's mediator, and a session opened on
 * any other mediator would never see what is sent to it.
 */
/**
 * The mediator a DID's `TSPTransport` service names, when it names one by DID.
 * Two parties on different mediators have not been seen to complete a TSP
 * relationship (VTI-Q15), which is why a caller wants to know.
 */
export async function advertisedTspMediatorDid(agent: Agent, did: string): Promise<string | undefined> {
  const doc = await resolveDidDocumentRetrying(agent, did)
  const services = (doc.service ?? []) as { type?: unknown; serviceEndpoint?: unknown }[]
  return services
    .filter((s) => [s.type].flat().map(String).includes('TSPTransport'))
    .flatMap((s) => (Array.isArray(s.serviceEndpoint) ? s.serviceEndpoint : [s.serviceEndpoint]))
    .map((e) => (typeof e === 'string' ? e : (e as { uri?: string } | undefined)?.uri))
    .find((uri): uri is string => typeof uri === 'string' && uri.startsWith('did:'))
}

export async function advertisedMediatorDid(agent: Agent, did: string): Promise<string | undefined> {
  const doc = await resolveDidDocumentRetrying(agent, did)
  const services = (doc.service ?? []) as { type?: unknown; serviceEndpoint?: unknown }[]
  return services
    .filter((s) => [s.type].flat().map(String).includes('DIDCommMessaging'))
    .flatMap((s) => (Array.isArray(s.serviceEndpoint) ? s.serviceEndpoint : [s.serviceEndpoint]))
    .map((e) => (typeof e === 'string' ? e : (e as { uri?: string } | undefined)?.uri))
    .find((uri): uri is string => typeof uri === 'string' && uri.startsWith('did:'))
}

export async function resolveVtiMediator(agent: Agent, mediatorDid: string): Promise<VtiMediatorEndpoints> {
  const doc = await resolveDidDocumentRetrying(agent, mediatorDid)

  /**
   * A `serviceEndpoint` is a string, an object with `uri`, or — for a
   * `did:peer:2` mediator, which is the common case — an **array of objects**,
   * one per transport. Measured on a live mediator: the `DIDCommMessaging`
   * service carries both the HTTPS base and the `wss://` socket that way, and
   * the ATM auth URL is a separate `Authentication` service.
   */
  const urisOf = (endpoint: unknown): string[] => {
    if (typeof endpoint === 'string') return [endpoint]
    if (Array.isArray(endpoint)) return endpoint.flatMap(urisOf)
    if (endpoint && typeof endpoint === 'object' && typeof (endpoint as { uri?: string }).uri === 'string') {
      return [(endpoint as { uri: string }).uri]
    }
    return []
  }

  const services = doc.service ?? []
  const isDidComm = (type: string) => type === 'DIDCommMessaging' || type === 'dm'
  const didCommUris = services.filter((s) => isDidComm(String(s.type))).flatMap((s) => urisOf(s.serviceEndpoint))
  const authUris = services.filter((s) => String(s.type) === 'Authentication').flatMap((s) => urisOf(s.serviceEndpoint))

  const httpUri = didCommUris.find((u) => u.startsWith('http://') || u.startsWith('https://'))
  const wsUri = didCommUris.find((u) => u.startsWith('ws://') || u.startsWith('wss://'))
  if (!httpUri || !wsUri) {
    throw new Error(
      `${LOG_PREFIX} ${mediatorDid} advertises no usable DIDCommMessaging pair (http: ${httpUri ?? 'none'}, ws: ${wsUri ?? 'none'})`
    )
  }
  // The mediator publishes its ATM auth URL as an `Authentication` service; the
  // challenge hangs off it. Without one, it is conventionally `<base>/authenticate`.
  const authEndpoint = (authUris[0] ?? `${httpUri.replace(/\/$/, '')}/authenticate`).replace(/\/$/, '')

  const keyAgreement = doc.keyAgreement?.[0]
  const vm = typeof keyAgreement === 'string' ? doc.dereferenceKey(keyAgreement, ['keyAgreement']) : keyAgreement
  if (!vm) throw new Error(`${LOG_PREFIX} ${mediatorDid} publishes no keyAgreement verification method`)
  // A did:peer:2 key arrives as `publicKeyMultibase`, a did:webvh one as a JWK.
  // Credo's own helper reads either, so neither shape has to be decoded here.
  const publicJwk = getPublicJwkFromVerificationMethod(vm) as DidCommV2KeyAgreementJwk

  return { did: mediatorDid, authEndpoint, wsEndpoint: wsUri, publicJwk, kid: vm.id }
}

/** The client identity this transport speaks as — a v2 DID Credo already holds. */
export interface VtiClientIdentity {
  did: string
  /** The DID's own key-agreement verification method id (the `skid` we sign with). */
  kid: string
  senderKey: Kms.PublicJwk<Kms.X25519PublicJwk>
}

/**
 * Mint the DID this wallet presents to a VTA's mediator.
 *
 * Not an OOB invitation: that path demands Coordinate Mediation 2.0 routing
 * through *our* mediator, which has nothing to do with this leg — here the ATM
 * socket is the routing, because the mediator delivers to whichever DID logged
 * in. So this builds the `did:peer:2` directly: one Ed25519 key in Askar, the
 * matching X25519 keyAgreement derived by Credo, and a `DIDCommMessaging`
 * service naming the mediator by its DID.
 *
 * That service is how a VTA reaches this phone when it is not the one asking.
 * An approver is pushed a consent request only if its DID document carries a
 * `DIDCommMessaging` service whose endpoint is a mediator DID (vti #1579,
 * `resolve_mediator_did_with_resolver`) — the shape the reference client mints,
 * `{"t":"dm","s":…,"a":["didcomm/v2"]}`. Credo's helper writes a DIDComm v1
 * `did-communication` service with the socket URL instead, which the VTA reads
 * as "no route": the approval was never pushed, and the phone saw it only
 * because My Agent went and fetched it (2026-09-21). A DID already minted
 * keeps its old service; only new mints carry this one.
 */
export async function createVtiClientDid(agent: Agent, mediator: VtiMediatorEndpoints): Promise<string> {
  const key = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
  const publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk) as Kms.PublicJwk<Kms.Ed25519PublicJwk>
  const { didDocument, keys } = createPeerDidDocumentFromServices(
    [
      {
        id: 'vti',
        serviceEndpoint: mediator.wsEndpoint,
        recipientKeys: [publicJwk],
        routingKeys: [],
      },
    ],
    true
  )
  // The builder above supplies the keys; the service is replaced with the v2
  // one before the DID is encoded, since the DID string is the document.
  didDocument.service = [
    new NewDidCommV2Service({
      id: '#didcomm',
      serviceEndpoint: new NewDidCommV2ServiceEndpoint({ uri: mediator.did, accept: ['didcomm/v2'] }),
    }),
  ]
  const created = await agent.dids.create({
    method: 'peer',
    didDocument,
    options: { numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc, keys },
  })
  const did = created.didState.did
  if (!did) throw new Error(`${LOG_PREFIX} could not create a client DID: ${created.didState.state}`)
  return did
}

/**
 * The identity a v2 DID Credo already holds presents to a mediator: its own
 * keyAgreement verification method, and the Askar key behind it. Mirrors what
 * `ref-18` assembles by hand — the key stays in the KMS; only its id travels.
 */
export async function vtiClientIdentityFromDid(agent: Agent, did: string): Promise<VtiClientIdentity> {
  const { didDocument, keys } = await agent.dids.resolveCreatedDidDocumentWithKeys(did)
  const keyAgreementRef = didDocument.keyAgreement?.[0]
  const vm =
    typeof keyAgreementRef === 'string'
      ? didDocument.dereferenceKey(keyAgreementRef, ['keyAgreement'])
      : keyAgreementRef
  if (!vm) throw new Error(`${LOG_PREFIX} ${did} has no keyAgreement verification method`)
  const kmsKey = (keys ?? []).find((key) => vm.id.endsWith(key.didDocumentRelativeKeyId))
  if (!kmsKey) throw new Error(`${LOG_PREFIX} no KMS key backs ${vm.id}`)
  const senderKey = getPublicJwkFromVerificationMethod(vm) as Kms.PublicJwk<Kms.X25519PublicJwk>
  senderKey.keyId = kmsKey.kmsKeyId
  return { did, kid: vm.id, senderKey }
}

/**
 * The identity a persona presents, when its key was borrowed from a VTA rather
 * than minted here: the persona's own keyAgreement verification method, and the
 * KMS id of the borrowed copy. A `did:webvh` persona is resolved, not created,
 * so Credo holds no record of it — the caller supplies the key it imported.
 */
export async function vtiClientIdentityFromPersona(
  agent: Agent,
  personaDid: string,
  keyAgreementKmsKeyId: string
): Promise<VtiClientIdentity> {
  const doc = await resolveDidDocumentRetrying(agent, personaDid)
  const keyAgreementRef = doc.keyAgreement?.[0]
  const vm =
    typeof keyAgreementRef === 'string' ? doc.dereferenceKey(keyAgreementRef, ['keyAgreement']) : keyAgreementRef
  if (!vm) throw new Error(`${LOG_PREFIX} ${personaDid} has no keyAgreement verification method`)
  const senderKey = getPublicJwkFromVerificationMethod(vm) as Kms.PublicJwk<Kms.X25519PublicJwk>
  senderKey.keyId = keyAgreementKmsKeyId
  return { did: personaDid, kid: vm.id, senderKey }
}

/**
 * One authenticated socket to one mediator, for one DID.
 *
 * `start()` performs the login and opens the socket; inbound frames are handed
 * to Credo's receiver and acknowledged with Pickup 3.0 `messages-received`,
 * **after** the receiver has taken them — the same persist-before-ack ordering
 * the rest of the stack holds, since the mediator drops its copy on the ack.
 */
export class VtiMediatorSession {
  private socket?: WebSocket
  private pollTimer?: ReturnType<typeof setInterval>
  /** Set by `stop()`, and final: a stopped session never reopens (`ensureOpen`). */
  private stopped = false
  private opening?: Promise<void>
  private readonly seen = new Set<string>()
  private accessToken?: string

  constructor(
    private readonly agent: Agent,
    private readonly identity: VtiClientIdentity,
    private readonly mediator: VtiMediatorEndpoints,
    private readonly options: {
      onError?: (error: Error) => void
      /**
       * A message addressed to this client, already decrypted. Set it to read
       * what a VTA or a VTC answers: Credo has no handler registered for Trust
       * Task types, so handing those to its receiver only raises "Error
       * validating message". Without it, frames still go to Credo — which is
       * what a v1-shaped message wants.
       */
      onMessage?: (plaintext: DidCommV2PlaintextMessage) => void
      /**
       * A TSP frame addressed to this client, as raw qb2 bytes — sealed, so
       * the consumer holds the key. Awaited before the frame is acknowledged:
       * a consumer that throws has not taken the message, and the mediator
       * keeps it for redelivery. Without a consumer, TSP frames are left
       * queued rather than acknowledged blind.
       */
      onTspFrame?: (bytes: Uint8Array) => void | Promise<void>
    } = {}
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === 1
  }

  /** Authcrypt a v2 plaintext to the mediator with Credo's envelope service. */
  private async packForMediator(plaintext: DidCommV2PlaintextMessage): Promise<unknown> {
    const envelopeService = this.agent.dependencyManager.resolve(DidCommV2EnvelopeService)
    const recipientKey = this.mediator.publicJwk
    recipientKey.keyId = this.mediator.kid
    return envelopeService.pack(this.agent.context, plaintext, {
      recipientKey,
      senderKey: this.identity.senderKey,
      senderKeySkid: this.identity.kid,
    })
  }

  /** `POST /challenge` → authenticate → JWT. */
  private async login(): Promise<string> {
    const challengeResponse = await fetch(`${this.mediator.authEndpoint}/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did: this.identity.did }),
    })
    // Read as text first: a tunnel in front of the mediator can answer with a
    // page instead of JSON (measured on iOS as "Unexpected character: R"), and
    // the status plus the first line say what happened where a parse error would not.
    const challengeText = await challengeResponse.text()
    let challengeBody: { data?: { challenge?: string; session_id?: string }; sessionId?: string } = {}
    try {
      challengeBody = JSON.parse(challengeText)
    } catch {
      throw new Error(
        `${LOG_PREFIX} challenge answered ${challengeResponse.status} with a non-JSON body: ${challengeText.slice(0, 80)}`
      )
    }
    const challenge = challengeBody?.data?.challenge
    const sessionId = challengeBody?.data?.session_id ?? challengeBody?.sessionId
    if (!challenge || !sessionId) {
      throw new Error(
        `${LOG_PREFIX} challenge refused (${challengeResponse.status}): ${JSON.stringify(challengeBody).slice(0, 200)}`
      )
    }

    const authenticate = {
      id: uuid(),
      typ: PLAIN,
      type: ATM_AUTHENTICATE,
      from: this.identity.did,
      to: [this.mediator.did],
      created_time: nowSec(),
      expires_time: nowSec() + 300,
      body: { challenge, session_id: sessionId },
    }
    const response = await fetch(this.mediator.authEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await this.packForMediator(authenticate)),
    })
    const body = (await response.json().catch(() => ({}))) as { data?: { access_token?: string } }
    const token = body?.data?.access_token
    if (!token) {
      throw new Error(`${LOG_PREFIX} authenticate refused (${response.status}): ${JSON.stringify(body).slice(0, 200)}`)
    }
    return token
  }

  /**
   * Mint an access token unless one is already held.
   *
   * The login is two round trips through a tunnel; a transient answer from the
   * tunnel itself is not a refusal, so try a few times before giving up.
   */
  private async ensureAccessToken(): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3 && !this.accessToken; attempt++) {
      try {
        this.accessToken = await this.login()
      } catch (error) {
        lastError = error
        if (String((error as Error)?.message).includes('refused')) throw error
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      }
    }
    if (!this.accessToken) throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  async start(): Promise<void> {
    // A token the mediator will no longer honour is the one failure this
    // transport could not talk its way out of. `accessToken` is cached and
    // every reopen path goes through here, so once the mediator stopped
    // accepting it — the persona it was minted for was dropped, the mediator
    // restarted and forgot the session, or it simply expired — every
    // subsequent attempt presented the same dead bearer and failed
    // identically, for ever. Only recreating the object cleared it, which in
    // practice meant relaunching the app.
    //
    // Measured on 2026-09-20: forgetting the community mid-session left the
    // wallet reporting "socket failed to open" for the rest of the run, with
    // the vetter's desk empty because nothing was ever sent. A fresh launch
    // fixed it.
    //
    // So a handshake refused while using a CACHED token is treated as a
    // verdict on the token: drop it, mint a new one, try once more. A
    // freshly-minted token that is refused is a real failure and is reported.
    const hadCachedToken = this.accessToken !== undefined
    await this.ensureAccessToken()
    try {
      await this.openSocket()
    } catch (error) {
      if (hadCachedToken) {
        // Refused with a cached token: the token is the suspect, mint another.
        this.accessToken = undefined
        await this.ensureAccessToken()
      } else if (!isOpenTimeout(error)) {
        throw error
      }
      // A stalled open gets one fresh socket: the login was good, the connect
      // is what failed.
      await this.openSocket()
    }
    await this.startLiveDelivery()
  }

  /** Open the websocket and attach the frame handler. */
  private async openSocket(): Promise<void> {
    const socket = new WebSocket(this.mediator.wsEndpoint, [`bearer.${this.accessToken}`, WS_APP_SUBPROTOCOL])
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      // React Native's error event carries the reason as `message`, and a
      // handshake the mediator rejects arrives as a close rather than an error —
      // so both are reported, or the failure reads as a bare "it didn't open".
      const onError = (event: unknown) => {
        cleanup()
        const detail = (event as { message?: string } | undefined)?.message
        reject(new Error(`${LOG_PREFIX} socket failed to open${detail ? `: ${detail}` : ''}`))
      }
      const onClose = (event: unknown) => {
        cleanup()
        const { code, reason } = (event ?? {}) as { code?: number; reason?: string }
        reject(new Error(`${LOG_PREFIX} socket closed during handshake (${code ?? '?'}${reason ? ` ${reason}` : ''})`))
      }
      // Neither: give up on this socket, and close it so a late open cannot
      // leave a second live socket for the DID behind.
      const timer = setTimeout(() => {
        cleanup()
        try {
          socket.close()
        } catch {
          /* never opened */
        }
        reject(new Error(`${LOG_PREFIX} ${SOCKET_OPEN_TIMEOUT} after ${SOCKET_OPEN_TIMEOUT_MS} ms`))
      }, SOCKET_OPEN_TIMEOUT_MS)
      const cleanup = () => {
        clearTimeout(timer)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        socket.removeEventListener('close', onClose)
      }
      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
      socket.addEventListener('close', onClose)
    })

    socket.onmessage = (event: WebSocketMessageEvent) => {
      void this.handleFrame(typeof event.data === 'string' ? event.data : String(event.data))
    }
    this.socket = socket
  }

  /** Ask for live delivery, drain what was queued, and start the backstop poll. */
  private async startLiveDelivery(): Promise<void> {
    // Pickup 3.0 live mode: without this the mediator queues and waits to be polled.
    await this.send({
      id: uuid(),
      typ: PLAIN,
      type: LIVE_DELIVERY_CHANGE,
      from: this.identity.did,
      to: [this.mediator.did],
      created_time: nowSec(),
      expires_time: nowSec() + 300,
      return_route: 'all',
      body: { live_delivery: true },
    })

    // Live delivery only carries messages that arrive from now on. Anything the
    // mediator queued while this DID was offline — a consent request pushed to
    // an approver before its app opened — is fetched with an explicit
    // delivery-request; the `delivery` response is unpacked in `handleFrame`.
    await this.requestDelivery()
    // And a live push can be missed — measured: a vetting statement sat in the
    // recipient's queue while its socket was open (VTI-24's shape again). A
    // periodic delivery-request is the backstop; an empty queue answers with a
    // `status`, which handleFrame treats as the answer it is. The mediator's own
    // resync signal (tdk-rs #830) makes a missed push visible sooner — see
    // `heardPickup`.
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      if (this.socket?.readyState === 1) void this.requestDelivery().catch(() => undefined)
    }, DELIVERY_POLL_MS)
  }

  /**
   * Pickup 3.0 delivery-request. This mediator's body is `{recipient_did,
   * limit}` (`MessagePickupDeliveryRequest`, affinidi-messaging-sdk) — without
   * `recipient_did` it answers a problem-report and nothing is delivered.
   */
  private async requestDelivery(): Promise<void> {
    this.lastDeliveryRequestAt = Date.now()
    await this.send({
      id: uuid(),
      typ: PLAIN,
      type: DELIVERY_REQUEST,
      from: this.identity.did,
      to: [this.mediator.did],
      created_time: nowSec(),
      expires_time: nowSec() + 300,
      return_route: 'all',
      body: { recipient_did: this.identity.did, limit: 20 },
    })
  }

  /**
   * Decrypt a JWE addressed to this client. The sender is a VTA or a VTC, so
   * its key is resolved from its DID document the same way an outbound
   * recipient key is.
   */
  private async unpack(encrypted: DidCommV2EncryptedMessage): Promise<DidCommV2PlaintextMessage> {
    const envelopeService = this.agent.dependencyManager.resolve(DidCommV2EnvelopeService)
    const recipientKey = this.identity.senderKey as DidCommV2KeyAgreementJwk & { keyId: string }
    const matchedKid =
      encrypted.recipients?.find((recipient) => recipient.header?.kid === this.identity.kid)?.header?.kid ??
      encrypted.recipients?.[0]?.header?.kid ??
      this.identity.kid
    const { plaintext } = await envelopeService.unpack(this.agent.context, encrypted, {
      recipientKey,
      matchedKid,
      resolveSenderKey: async (skid: string) => {
        const doc = await this.agent.dids.resolveDidDocument(skid.split('#')[0])
        const vm = doc.dereferenceKey(skid, ['keyAgreement'])
        return vm ? getPublicJwkFromVerificationMethod(vm) : null
      },
    })
    return plaintext
  }

  private lastDeliveryRequestAt = 0

  /**
   * A Pickup 3.0 frame from the mediator is bookkeeping, never a message for
   * the agent, and is never acknowledged. One kind of it asks for action.
   *
   * After it drops a live push, the mediator raises a resync and sends a
   * `status` carrying the inbox's live `message_count` (tdk-rs #830, rate-
   * limited to one per five seconds). Unlike the status that answers our own
   * live-delivery-change or delivery-request, it answers nothing — it carries
   * no `thid` — so it is told apart by that. Ignoring it, as this transport
   * did, leaves the missed message waiting for the backstop poll; it is the
   * one signal that makes a longer poll interval safe
   * (message-protection-plan M1).
   *
   * A solicited status keeps its meaning: an empty queue answering our poll.
   */
  private heardPickup(plaintext: { type?: unknown; thid?: unknown; body?: unknown }): void {
    if (plaintext.type !== PICKUP_STATUS || plaintext.thid) return
    const count = Number((plaintext.body as { message_count?: unknown } | undefined)?.message_count ?? 1)
    if (!(count > 0)) return
    if (Date.now() - this.lastDeliveryRequestAt < RESYNC_DEBOUNCE_MS) return
    this.agent.config.logger.debug(`${LOG_PREFIX} resync: ${count} waiting after a dropped push — draining`)
    void this.requestDelivery().catch(() => undefined)
  }

  /** Hand a delivered frame to Credo, then acknowledge it — never the other way round. */
  private async handleFrame(raw: string): Promise<void> {
    try {
      // TSP demux, before any JSON is parsed: the mediator delivers a stored
      // TSP message as base64url(qb2) text, and a JWE never starts with `-E`.
      if (tsp.isTspFrameText(raw)) {
        await this.handleTspFrame(raw)
        return
      }
      const frame = JSON.parse(raw) as Record<string, unknown>
      // The mediator answers `live-delivery-change` with a Pickup 3.0 `status`,
      // which is this transport's own bookkeeping rather than a message for the
      // agent: Credo has no handler for it and rejects it as invalid. Frames
      // carrying a peer's message are JWEs, so a plaintext `status` is ours.
      if (isPickup(frame.type)) {
        this.heardPickup(frame)
        return
      }
      if (this.options.onMessage && typeof frame.protected === 'string') {
        const plaintext = await this.unpack(frame as unknown as DidCommV2EncryptedMessage)
        // A `delivery` answering our delivery-request wraps the queued messages
        // as attachments; unpack and route each, then acknowledge them so the
        // mediator drops them from the queue.
        if (plaintext.type === DELIVERY) {
          await this.handleDelivery(plaintext as unknown as DeliveryMessage)
          return
        }
        // The mediator authcrypts its own bookkeeping too, so a frame's type is
        // only visible once it is open: a Pickup `status` answering
        // `live-delivery-change` looks exactly like a peer's message until then.
        // Its own frames are never queued messages: acknowledging one provokes
        // another status reply, forever (vti-didcomm-js, mediator-transport.js).
        if (isPickup(plaintext.type)) {
          this.heardPickup(plaintext)
          return
        }
        if (plaintext.from === this.mediator.did) return
        // The mediator ids a stored message by sha256(packed bytes) and streams
        // those exact bytes, so the hash of the raw frame is the queue id that
        // acknowledges a live delivery (affinidi-messaging-sdk, websocket.rs)
        // and the key that dedups an at-least-once redelivery. Without the ack
        // the message stays queued until it expires, comes back on every poll,
        // and counts against the sender's queue cap (VTI-29).
        const queueId = bytesToHex(sha256(utf8ToBytes(raw)))
        if (this.seen.has(queueId)) {
          await this.acknowledge([queueId])
          return
        }
        this.remember(queueId)
        this.options.onMessage(plaintext)
        await this.acknowledge([queueId])
      } else {
        const receiver = this.agent.dependencyManager.resolve(DidCommMessageReceiver)
        await receiver.receiveMessage(frame)
      }
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * A live-delivered TSP frame: hand the bytes to the consumer, then
   * acknowledge by the mediator's queue id for it — SHA-256 of the delivered
   * text. Same persist-before-ack ordering as the DIDComm path.
   */
  private async handleTspFrame(text: string): Promise<void> {
    if (!this.options.onTspFrame) {
      this.agent.config.logger.debug(`${LOG_PREFIX} TSP frame left queued: no consumer on this session`)
      return
    }
    const bytes = tsp.fromBase64Url(text)
    await this.options.onTspFrame(bytes)
    await this.acknowledge([tsp.tspFrameQueueId(text)])
  }

  /** Pickup 3.0 `messages-received`: the mediator drops these from the queue. */
  private async acknowledge(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return
    await this.send({
      id: uuid(),
      typ: PLAIN,
      type: MESSAGES_RECEIVED,
      from: this.identity.did,
      to: [this.mediator.did],
      created_time: nowSec(),
      expires_time: nowSec() + 300,
      return_route: 'all',
      body: { message_id_list: messageIds },
    })
  }

  /**
   * A Pickup 3.0 `delivery`: each attachment is a queued JWE — or a queued
   * TSP frame, carried as its base64url text. Unpack and route every one,
   * then send `messages-received` with their ids so the mediator clears them.
   */
  private async handleDelivery(delivery: DeliveryMessage): Promise<void> {
    const attachments = delivery.attachments ?? []
    const acknowledged: string[] = []
    for (const attachment of attachments) {
      const data = attachment.data
      // A queued TSP frame comes as its base64url text in either slot; a JWE
      // never starts with `-E`, so the demux is safe before any JSON parse.
      const tspText =
        typeof data?.base64 === 'string' && tsp.isTspFrameText(data.base64)
          ? data.base64
          : typeof data?.json === 'string' && tsp.isTspFrameText(data.json)
            ? data.json
            : undefined
      if (tspText) {
        try {
          if (!this.options.onTspFrame) continue
          if (attachment.id && this.seen.has(attachment.id)) {
            acknowledged.push(attachment.id)
            continue
          }
          await this.options.onTspFrame(tsp.fromBase64Url(tspText))
          if (attachment.id) {
            this.remember(attachment.id)
            acknowledged.push(attachment.id)
          }
        } catch (error) {
          this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
        continue
      }
      try {
        // This mediator attaches each queued message as base64url
        // (`Attachment::base64`, message_pickup.rs); the spec also allows json.
        // A message we cannot read is left unacknowledged — it is what the
        // queue is for — so an error here is reported, not swallowed.
        const jwe =
          data?.json ??
          (data?.base64
            ? JSON.parse(TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64Url(data.base64)))
            : undefined)
        if (!jwe) continue
        if (attachment.id && this.seen.has(attachment.id)) {
          acknowledged.push(attachment.id)
          continue
        }
        const plaintext = await this.unpack(jwe as DidCommV2EncryptedMessage)
        if (attachment.id) this.remember(attachment.id)
        if (!isPickup(plaintext.type)) this.options?.onMessage?.(plaintext)
        if (attachment.id) acknowledged.push(attachment.id)
      } catch (error) {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (acknowledged.length > 0) await this.acknowledge(acknowledged)
  }

  /** Pickup 3.0 `messages-received`: the mediator drops these from the queue. */
  /** Queue ids already handed off this session, oldest first, bounded. */
  private remember(queueId: string): void {
    this.seen.add(queueId)
    if (this.seen.size > 500) {
      const oldest = this.seen.values().next().value
      if (oldest) this.seen.delete(oldest)
    }
  }

  /**
   * An idle socket does not survive indefinitely: a tunnel, a proxy or a dozing
   * phone closes it, and the mediator can still believe it is open — so the
   * first symptom is a send failing rather than a close arriving. Reopening is
   * cheap and keeps the same DID, so the community still sees one applicant.
   */
  private async ensureOpen(): Promise<void> {
    if (this.socket?.readyState === 1) return
    // A stopped session stays stopped. Its owner has given up on it — a grant
    // check past its deadline, a disconnect — but work it started can still be
    // running, and its next send used to reopen the socket here: a second live
    // socket for the same DID, owned by nobody, which took the answer meant for
    // the next attempt (Android link on a slow device, 2026-09-24).
    if (this.stopped) throw new Error(`${LOG_PREFIX} session stopped`)
    // One reopen at a time: an acknowledgement, the poll and a task can all
    // find the socket closed in the same tick, and two starts racing replace
    // the socket under the first caller ("socket is not open").
    if (!this.opening) {
      this.opening = (async () => {
        try {
          this.socket?.close()
        } catch {
          /* already gone */
        }
        this.socket = undefined
        await this.start()
      })().finally(() => {
        this.opening = undefined
      })
    }
    await this.opening
  }

  private async send(plaintext: DidCommV2PlaintextMessage): Promise<void> {
    await this.ensureOpen()
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(`${LOG_PREFIX} socket is not open`)
    }
    this.socket.send(JSON.stringify(await this.packForMediator(plaintext)))
  }

  /**
   * Ship a packed TSP message as a binary frame. The mediator routes it on the
   * cleartext receiver VID and binds the cleartext sender VID to this session,
   * so the frame's sender has to be the DID this session logged in as. The
   * bytes are already sealed and signed; nothing is packed to the mediator.
   */
  async sendTspFrame(bytes: Uint8Array): Promise<void> {
    if (!tsp.isTspFrameBytes(bytes))
      throw new Error(`${LOG_PREFIX} not a TSP frame (leading byte 0x${(bytes[0] ?? 0).toString(16)})`)
    await this.ensureOpen()
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(`${LOG_PREFIX} socket is not open`)
    }
    // A standalone ArrayBuffer: React Native's WebSocket sends the whole
    // backing buffer of a view, so a slice of a larger buffer must be copied.
    this.socket.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  }

  /**
   * Authcrypt a plaintext to a peer (its keyAgreement key, resolved through
   * Credo) and forward it through the mediator. This is the whole outbound
   * path for a VTA or a VTC: they are reached by DID, never dialled directly.
   */
  async sendTo(peerDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void> {
    const doc = await this.agent.dids.resolveDidDocument(peerDid)
    const keyAgreementRef = doc.keyAgreement?.[0]
    const vm =
      typeof keyAgreementRef === 'string' ? doc.dereferenceKey(keyAgreementRef, ['keyAgreement']) : keyAgreementRef
    if (!vm) throw new Error(`${LOG_PREFIX} ${peerDid} publishes no keyAgreement verification method`)
    const recipientKey = getPublicJwkFromVerificationMethod(vm) as DidCommV2KeyAgreementJwk
    recipientKey.keyId = vm.id

    const envelopeService = this.agent.dependencyManager.resolve(DidCommV2EnvelopeService)
    const inner = await envelopeService.pack(this.agent.context, plaintext, {
      recipientKey,
      senderKey: this.identity.senderKey,
      senderKeySkid: this.identity.kid,
    })
    await this.forward(peerDid, inner)
  }

  /**
   * Wrap an already-packed JWE for `next` in a Routing 2.0 forward, pack the
   * forward to the mediator, and ship it over this socket.
   */
  async forward(next: string, innerJwe: unknown): Promise<void> {
    const inner = typeof innerJwe === 'string' ? JSON.parse(innerJwe) : innerJwe
    await this.send({
      id: uuid(),
      typ: PLAIN,
      type: FORWARD,
      from: this.identity.did,
      to: [this.mediator.did],
      created_time: nowSec(),
      expires_time: nowSec() + 300,
      body: { next },
      attachments: [{ id: utils.uuid(), data: { json: inner } }],
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
    this.socket?.close()
    this.socket = undefined
  }
}

/**
 * Credo outbound transport backed by a `VtiMediatorSession`.
 *
 * Credo picks a transport by the peer endpoint's scheme, so a VTA/VTC peer DID
 * whose service endpoint the agent cannot dial directly is routed here.
 */
export class VtiMediatorOutboundTransport {
  public supportedSchemes = ['vti']

  constructor(
    private readonly session: VtiMediatorSession,
    private readonly peerDidFor: (outboundPackage: unknown) => string
  ) {}

  async start(): Promise<void> {
    /* the session owns its lifecycle */
  }

  async stop(): Promise<void> {
    await this.session.stop()
  }

  async sendMessage(outboundPackage: { payload: unknown }): Promise<void> {
    await this.session.forward(this.peerDidFor(outboundPackage), outboundPackage.payload)
  }
}
