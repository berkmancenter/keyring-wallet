import { type Agent, TypedArrayEncoder } from '@credo-ts/core'
import type { DidCommOutboundPackage, DidCommOutboundTransport, DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { DidCommMessageReceiver } from '@credo-ts/didcomm'

import { didPrefix } from './didPrefix'
import { releaseWarn } from './releaseLog'
import {
  createPeerDidNamingUri,
  resolveVtiMediator,
  vtiClientIdentityFromDid,
  type VtiClientIdentity,
  type VtiMediatorEndpoints,
  VtiMediatorSession,
} from './VtiMediatorTransport'

/**
 * walletMailbox — wallet-to-wallet DIDComm v2 through an Affinidi ("ATM") mediator, one socket per phone.
 *
 * The Affinidi mediator gives every DID its own account and ONE live socket, and has no Coordinate Mediation 2.0
 * (by design: v2 routing there is DID-addressed, upstream issue #755). A socket per contact does not scale, so:
 *
 *  - the phone has ONE **mailbox DID**: a `did:peer:2` whose DIDComm v2 service names the mediator by DID. It is the
 *    only identity this module signs in as, on one {@link VtiMediatorSession};
 *  - every v2 contact gets a fresh pairwise **contact DID** ({@link mintContactDid}): a `did:peer:2` whose service
 *    names the phone's mailbox DID;
 *  - a sender's Credo follows contact → mailbox → mediator and wraps the message in a `routing/2.0` forward for the
 *    mailbox's key; {@link WalletMailboxOutboundTransport} (the `did` scheme) sends it on to the mediator, addressed
 *    to the mailbox the peer's contact DID names, over the sender's own session;
 *  - inbound, the mediator holds it for the recipient's mailbox; the phone opens that forward (it is its own last
 *    routing hop, {@link takeMailboxMessage}) and hands the contact-addressed message inside to Credo's receiver.
 *
 * **Linkability, accepted (2026-11-20):** the mailbox DID appears in every contact DID's service, so two contacts
 * who compare documents can tell they reach the same phone. The mediator learns nothing a mediator does not already
 * learn: it sees mailbox DIDs only, never a contact DID. A mailbox per group of contacts stays possible: nothing
 * here assumes there is one mailbox, only that each contact DID names the mailbox that receives for it.
 *
 * Proven against a local Affinidi mediator before this was written (wallet-mailbox lab rows: three wallets, six
 * directions, store-and-forward for an offline phone).
 *
 * @module trust-tasks/module/walletMailbox
 */

export const LOG_PREFIX = '[TrustTasks:WalletMailbox]'
export const WALLET_MAILBOX_RECORD_TYPE = 'keyring:walletMailbox'
const FORWARD = 'https://didcomm.org/routing/2.0/forward'

/** What this module needs of a mediator session; {@link VtiMediatorSession} in the app, a fake in tests. */
export interface MailboxSession {
  start(): Promise<void>
  stop(): Promise<void>
  forward(next: string, innerJwe: unknown): Promise<void>
}

export interface WalletMailbox {
  /** The mailbox DID: the only identity signed in at the mediator. */
  did: string
  mediatorDid: string
  session: MailboxSession
}

export interface OpenWalletMailboxDeps {
  resolveMediator?: (agent: Agent, mediatorDid: string) => Promise<VtiMediatorEndpoints>
  makeSession?: (
    agent: Agent,
    identity: VtiClientIdentity,
    mediator: VtiMediatorEndpoints,
    onMessage: (plaintext: DidCommV2PlaintextMessage) => Promise<void>
  ) => MailboxSession
}

/** The open mailbox, per agent. */
const openMailboxes = new WeakMap<Agent, WalletMailbox>()
const opening = new WeakMap<Agent, Promise<WalletMailbox>>()
const transports = new WeakMap<Agent, WalletMailboxOutboundTransport>()

/** The open mailbox for this agent, if any. */
export function walletMailboxOf(agent: Agent): WalletMailbox | undefined {
  return openMailboxes.get(agent)
}

/** The mailbox DID kept for `mediatorDid`, or a new one minted and kept. One per mediator, stable across starts. */
async function mailboxDidFor(agent: Agent, mediator: VtiMediatorEndpoints): Promise<string> {
  const kept = await agent.genericRecords.findAllByQuery({
    type: WALLET_MAILBOX_RECORD_TYPE,
    mediatorDid: mediator.did,
  })
  const did = kept[0]?.content?.did
  if (typeof did === 'string' && did) return did
  const minted = await createPeerDidNamingUri(agent, mediator.did, mediator.wsEndpoint)
  await agent.genericRecords.save({
    content: { did: minted, mediatorDid: mediator.did },
    tags: { type: WALLET_MAILBOX_RECORD_TYPE, mediatorDid: mediator.did },
  })
  agent.config.logger.info(`${LOG_PREFIX} minted a mailbox DID ${didPrefix(minted)} for ${didPrefix(mediator.did)}`)
  return minted
}

/**
 * Open this phone's mailbox at `mediatorDid`: keep (or mint) the mailbox DID, sign in as it, and register the
 * outbound transport. Idempotent per agent and mediator; a second call while one is opening joins it. Throws when
 * the mediator cannot be resolved or signed in to; the caller decides whether that blocks anything (it should not
 * block start-up: without an open mailbox the phone mints v1 invitations, canMintV2Invitation).
 */
export async function openWalletMailbox(
  agent: Agent,
  mediatorDid: string,
  deps: OpenWalletMailboxDeps = {}
): Promise<WalletMailbox> {
  const current = openMailboxes.get(agent)
  if (current?.mediatorDid === mediatorDid) return current
  const inFlight = opening.get(agent)
  if (inFlight) return inFlight
  const run = (async () => {
    if (current) await closeWalletMailbox(agent)
    const mediator = await (deps.resolveMediator ?? resolveVtiMediator)(agent, mediatorDid)
    const did = await mailboxDidFor(agent, mediator)
    const identity = await vtiClientIdentityFromDid(agent, did)
    const onMessage = (plaintext: DidCommV2PlaintextMessage) => takeMailboxMessage(agent, plaintext)
    const session = deps.makeSession
      ? deps.makeSession(agent, identity, mediator, onMessage)
      : new VtiMediatorSession(agent, identity, mediator, {
          onMessage,
          onError: (error) => agent.config.logger.warn(`${LOG_PREFIX} mailbox session: ${error.message}`),
        })
    await session.start()
    const mailbox: WalletMailbox = { did, mediatorDid: mediator.did, session }
    openMailboxes.set(agent, mailbox)
    if (!transports.has(agent)) {
      const transport = new WalletMailboxOutboundTransport(agent)
      transports.set(agent, transport)
      agent.modules.didcomm.registerOutboundTransport(transport)
    }
    agent.config.logger.info(`${LOG_PREFIX} mailbox ${didPrefix(did)} open at ${didPrefix(mediator.did)}`)
    return mailbox
  })()
  opening.set(agent, run)
  try {
    return await run
  } finally {
    opening.delete(agent)
  }
}

/** Sign out of the mailbox. The mailbox DID is kept; the next open signs in as it again. */
export async function closeWalletMailbox(agent: Agent): Promise<void> {
  const mailbox = openMailboxes.get(agent)
  openMailboxes.delete(agent)
  await mailbox?.session.stop()
}

/**
 * A fresh pairwise contact DID that names this phone's mailbox: what a v2 invitation from this phone is minted on
 * (`invitationDid`), and what this phone answers a v2 invitation from (`ourDid`).
 */
export async function mintContactDid(agent: Agent, mailbox: WalletMailbox): Promise<string> {
  return createPeerDidNamingUri(agent, mailbox.did)
}

/**
 * What the mailbox session delivers, already opened with the mailbox key. A sender's Credo wrapped the contact's
 * message in a forward for this mailbox, so this phone is the forward's last hop: the message inside goes to Credo's
 * receiver, which opens it with the contact key. Awaited, so the session acknowledges only what was taken. A
 * forward to a DID this phone did not create is dropped (said, and acknowledged: it can never be read here).
 */
export async function takeMailboxMessage(agent: Agent, plaintext: DidCommV2PlaintextMessage): Promise<void> {
  if (plaintext.type !== FORWARD) {
    releaseWarn(
      `${LOG_PREFIX} the mailbox received a ${String(plaintext.type)} addressed to it, not a forward; dropped`
    )
    return
  }
  const body = (plaintext.body ?? {}) as { next?: unknown }
  const next = typeof body.next === 'string' ? body.next : undefined
  if (!next || (await agent.dids.getCreatedDids({ did: next })).length === 0) {
    releaseWarn(`${LOG_PREFIX} a forward for ${next ? didPrefix(next) : 'no DID'}, not one of this phone's; dropped`)
    return
  }
  const attachment = (plaintext.attachments ?? [])[0] as { data?: { json?: unknown; base64?: string } } | undefined
  const base64 = attachment?.data?.base64
  const inner =
    attachment?.data?.json ??
    (base64
      ? JSON.parse(
          TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64(base64.replace(/-/g, '+').replace(/_/g, '/')))
        )
      : undefined)
  if (!inner) {
    releaseWarn(`${LOG_PREFIX} a forward for ${didPrefix(next)} with nothing attached; dropped`)
    return
  }
  const receiver = agent.dependencyManager.resolve(DidCommMessageReceiver)
  await receiver.receiveMessage(inner as never)
}

/** The mailbox DID a peer's contact DID names (its DIDComm v2 service `uri`), if it names a DID. */
export async function mailboxNamedBy(agent: Agent, contactDid: string): Promise<string | undefined> {
  const doc = await agent.dids.resolveDidDocument(contactDid)
  for (const service of doc.service ?? []) {
    const endpoint = service.serviceEndpoint as unknown
    const uris = (Array.isArray(endpoint) ? endpoint : [endpoint]).map((e) =>
      typeof e === 'string' ? e : (e as { uri?: unknown } | undefined)?.uri
    )
    const did = uris.find((u): u is string => typeof u === 'string' && u.startsWith('did:'))
    if (did) return did
  }
  return undefined
}

/**
 * Credo picks a transport by the endpoint's scheme, and a v2 contact's endpoint is a DID. Credo hands this the
 * message already wrapped for the peer's mailbox, with the endpoint it reached by following contact → mailbox
 * (the mediator, for a mailbox contact): neither that nor the did:key the wrapping names is an account at the
 * mediator. The peer's own contact DID says which mailbox receives for it, so that is the forward's `next`.
 */
export class WalletMailboxOutboundTransport implements DidCommOutboundTransport {
  public supportedSchemes = ['did']

  constructor(private readonly agent: Agent) {}

  async start(): Promise<void> {
    /* the mailbox session owns its lifecycle */
  }

  async stop(): Promise<void> {
    /* closeWalletMailbox stops the session */
  }

  async sendMessage(outboundPackage: DidCommOutboundPackage): Promise<void> {
    const mailbox = openMailboxes.get(this.agent)
    if (!mailbox) throw new Error(`${LOG_PREFIX} no mailbox is open to send through`)
    const next = await this.nextFor(outboundPackage, mailbox)
    if (!next) throw new Error(`${LOG_PREFIX} no mailbox found for ${outboundPackage.endpoint ?? 'this message'}`)
    await mailbox.session.forward(next, outboundPackage.payload)
  }

  private async nextFor(outboundPackage: DidCommOutboundPackage, mailbox: WalletMailbox): Promise<string | undefined> {
    if (outboundPackage.connectionId) {
      const connection = await this.agent.modules.didcomm.connections.findById(outboundPackage.connectionId)
      if (connection?.theirDid) {
        const named = await mailboxNamedBy(this.agent, connection.theirDid).catch(() => undefined)
        if (named && named !== mailbox.mediatorDid) return named
      }
    }
    const endpoint = outboundPackage.endpoint
    return endpoint?.startsWith('did:') && endpoint !== mailbox.mediatorDid ? endpoint : undefined
  }
}
