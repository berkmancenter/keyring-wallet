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
import { Kms } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { DidCommMessageReceiver, DidCommV2EnvelopeService } from '@credo-ts/didcomm'

const LOG_PREFIX = '[TrustTasks:VtiMediatorTransport]'

const ATM_AUTHENTICATE = 'https://affinidi.com/atm/1.0/authenticate'
const FORWARD = 'https://didcomm.org/routing/2.0/forward'
const LIVE_DELIVERY_CHANGE = 'https://didcomm.org/messagepickup/3.0/live-delivery-change'
const MESSAGES_RECEIVED = 'https://didcomm.org/messagepickup/3.0/messages-received'
const PLAIN = 'application/didcomm-plain+json'
const WS_APP_SUBPROTOCOL = 'didcomm'

const nowSec = () => Math.floor(Date.now() / 1000)
const uuid = () => `urn:uuid:${globalThis.crypto.randomUUID()}`

/** What the mediator's DID document tells a client, resolved through Credo. */
export interface VtiMediatorEndpoints {
  did: string
  /** `https://…/mediator/v1` — `/challenge` and the authenticate POST hang off it. */
  authEndpoint: string
  /** `wss://…/mediator/v1/ws` — one socket per DID. */
  wsEndpoint: string
  /** The mediator's X25519 key agreement key, and its kid. */
  x25519PublicKey: Uint8Array
  kid: string
}

/**
 * Read the mediator's endpoints and key agreement key out of its DID document.
 * Both `DIDCommMessaging` service entries are published; which is which is
 * decided by scheme, not by order.
 */
export async function resolveVtiMediator(agent: Agent, mediatorDid: string): Promise<VtiMediatorEndpoints> {
  const doc = await agent.dids.resolveDidDocument(mediatorDid)
  const uris: string[] = []
  for (const service of doc.service ?? []) {
    const endpoint = (service as { serviceEndpoint?: unknown }).serviceEndpoint
    if (typeof endpoint === 'string') uris.push(endpoint)
    else if (Array.isArray(endpoint)) uris.push(...endpoint.filter((e): e is string => typeof e === 'string'))
    else if (endpoint && typeof endpoint === 'object' && typeof (endpoint as { uri?: string }).uri === 'string') {
      uris.push((endpoint as { uri: string }).uri)
    }
  }
  const httpUri = uris.find((u) => u.startsWith('http://') || u.startsWith('https://'))
  const wsUri = uris.find((u) => u.startsWith('ws://') || u.startsWith('wss://'))
  if (!httpUri || !wsUri) {
    throw new Error(
      `${LOG_PREFIX} ${mediatorDid} advertises no usable DIDCommMessaging pair (http: ${httpUri ?? 'none'}, ws: ${wsUri ?? 'none'})`
    )
  }

  const keyAgreement = doc.keyAgreement?.[0]
  const vmId = typeof keyAgreement === 'string' ? keyAgreement : keyAgreement?.id
  const vm = doc.dereferenceKey ? doc.dereferenceKey(vmId as string) : undefined
  const jwk = vm?.publicKeyJwk as { x?: string } | undefined
  if (!jwk?.x) {
    throw new Error(`${LOG_PREFIX} ${mediatorDid} has no X25519 keyAgreement key this client can read`)
  }
  const x25519PublicKey = Uint8Array.from(Buffer.from(jwk.x.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))

  return { did: mediatorDid, authEndpoint: httpUri.replace(/\/$/, ''), wsEndpoint: wsUri, x25519PublicKey, kid: vm?.id ?? (vmId as string) }
}

/** The client identity this transport speaks as — a v2 DID Credo already holds. */
export interface VtiClientIdentity {
  did: string
  /** The DID's own key-agreement verification method id (the `skid` we sign with). */
  kid: string
  senderKey: Kms.PublicJwk<Kms.X25519PublicJwk>
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
    typeof keyAgreementRef === 'string' ? didDocument.dereferenceKey(keyAgreementRef, ['keyAgreement']) : keyAgreementRef
  if (!vm) throw new Error(`${LOG_PREFIX} ${did} has no keyAgreement verification method`)
  const kmsKey = (keys ?? []).find((key) => vm.id.endsWith(key.didDocumentRelativeKeyId))
  if (!kmsKey) throw new Error(`${LOG_PREFIX} no KMS key backs ${vm.id}`)
  const senderKey = Kms.PublicJwk.fromPublicKey(vm.publicKeyJwk as never) as Kms.PublicJwk<Kms.X25519PublicJwk>
  senderKey.keyId = kmsKey.kmsKeyId
  return { did, kid: vm.id, senderKey }
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
  private accessToken?: string

  constructor(
    private readonly agent: Agent,
    private readonly identity: VtiClientIdentity,
    private readonly mediator: VtiMediatorEndpoints,
    private readonly options: { onError?: (error: Error) => void } = {}
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === 1
  }

  /** Authcrypt a v2 plaintext to the mediator with Credo's envelope service. */
  private async packForMediator(plaintext: DidCommV2PlaintextMessage): Promise<unknown> {
    const envelopeService = this.agent.dependencyManager.resolve(DidCommV2EnvelopeService)
    const recipientKey = Kms.PublicJwk.fromPublicKey({
      kty: 'OKP',
      crv: 'X25519',
      publicKey: this.mediator.x25519PublicKey,
    })
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
    const challengeBody = (await challengeResponse.json()) as {
      data?: { challenge?: string; session_id?: string }
      sessionId?: string
    }
    const challenge = challengeBody?.data?.challenge
    const sessionId = challengeBody?.data?.session_id ?? challengeBody?.sessionId
    if (!challenge || !sessionId) {
      throw new Error(`${LOG_PREFIX} challenge refused (${challengeResponse.status}): ${JSON.stringify(challengeBody).slice(0, 200)}`)
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

  async start(): Promise<void> {
    this.accessToken = await this.login()
    const socket = new WebSocket(this.mediator.wsEndpoint, [`bearer.${this.accessToken}`, WS_APP_SUBPROTOCOL])
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error(`${LOG_PREFIX} socket failed to open`))
      }
      const cleanup = () => {
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }
      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })

    socket.onmessage = (event: WebSocketMessageEvent) => {
      void this.handleFrame(typeof event.data === 'string' ? event.data : String(event.data))
    }
    this.socket = socket

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
  }

  /** Hand a delivered frame to Credo, then acknowledge it — never the other way round. */
  private async handleFrame(raw: string): Promise<void> {
    try {
      const frame = JSON.parse(raw) as Record<string, unknown>
      const receiver = this.agent.dependencyManager.resolve(DidCommMessageReceiver)
      await receiver.receiveMessage(frame)
      const queueId = (frame as { id?: string }).id
      if (queueId) {
        await this.send({
          id: uuid(),
          typ: PLAIN,
          type: MESSAGES_RECEIVED,
          from: this.identity.did,
          to: [this.mediator.did],
          created_time: nowSec(),
          expires_time: nowSec() + 300,
          return_route: 'all',
          body: { message_id_list: [queueId] },
        })
      }
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async send(plaintext: DidCommV2PlaintextMessage): Promise<void> {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(`${LOG_PREFIX} socket is not open`)
    }
    this.socket.send(JSON.stringify(await this.packForMediator(plaintext)))
  }

  /**
   * Authcrypt a plaintext to a peer (its keyAgreement key, resolved through
   * Credo) and forward it through the mediator. This is the whole outbound
   * path for a VTA or a VTC: they are reached by DID, never dialled directly.
   */
  async sendTo(peerDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void> {
    const doc = await this.agent.dids.resolveDidDocument(peerDid)
    const keyAgreementRef = doc.keyAgreement?.[0]
    const vm = typeof keyAgreementRef === 'string' ? doc.dereferenceKey(keyAgreementRef, ['keyAgreement']) : keyAgreementRef
    const jwk = vm?.publicKeyJwk as { x?: string } | undefined
    if (!jwk?.x) throw new Error(`${LOG_PREFIX} ${peerDid} publishes no X25519 keyAgreement key`)
    const recipientKey = Kms.PublicJwk.fromPublicKey({
      kty: 'OKP',
      crv: 'X25519',
      publicKey: Uint8Array.from(Buffer.from(jwk.x.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    })
    recipientKey.keyId = vm?.id as string

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
      attachments: [{ id: globalThis.crypto.randomUUID(), data: { json: inner } }],
    })
  }

  async stop(): Promise<void> {
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

  constructor(private readonly session: VtiMediatorSession, private readonly peerDidFor: (outboundPackage: unknown) => string) {}

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
