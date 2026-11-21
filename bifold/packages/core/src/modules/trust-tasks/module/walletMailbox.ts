import { type Agent, TypedArrayEncoder, utils } from '@credo-ts/core'
import type { DidCommOutboundPackage, DidCommOutboundTransport, DidCommV2PlaintextMessage } from '@credo-ts/didcomm'
import { DidCommMessageReceiver } from '@credo-ts/didcomm'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { signDocumentProof, wireTimestamp } from '@bifold/trust-tasks'

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
/** The mediator's own management tasks (trust-tasks-rs `messaging/*`), as affinidi-messaging-mediator v0.53.0 serves them. */
export const MEDIATOR_ACCOUNT_UPDATE = 'https://trusttasks.org/spec/messaging/account/update/0.1'
export const MEDIATOR_WAKE_SET = 'https://trusttasks.org/spec/messaging/wake/set/0.1'
export const MEDIATOR_WAKE_REQUEST = 'https://trusttasks.org/spec/messaging/wake/request/0.1'

/**
 * The key the mediator holds an account under: the sha256 of its DID, in hex (upstream `did_identity::did_hash`).
 * Every `messaging/account/*` task names the account by this key, not by the DID.
 */
export const mailboxAccountKey = (did: string): string => bytesToHex(sha256(utf8ToBytes(did)))

/** A push gateway's handle for this phone, as `messaging/wake/set` carries it. */
export interface MailboxWakeHandle {
  /** The gateway's DID. The mediator rings only a gateway named by a DID. */
  gateway: string
  handle: string
}

/** What this module needs of a mediator session; {@link VtiMediatorSession} in the app, a fake in tests. */
export interface MailboxSession {
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * A routing/2.0 forward of `innerJwe` to the mailbox `next`, attached as the exact bytes the mediator stores and ids
   * the message by; resolves with that id (the sha256 of the bytes, hex), which `messaging/wake/request` names.
   */
  forwardForMailbox(next: string, innerJwe: unknown): Promise<{ id: string }>
  /** A signed Trust Task document to the mediator itself; resolves with its answer, rejects with its refusal. */
  ask(document: Record<string, unknown>): Promise<DidCommV2PlaintextMessage>
}

export interface WalletMailbox {
  /** The mailbox DID: the only identity signed in at the mediator. */
  did: string
  mediatorDid: string
  session: MailboxSession
}

export interface OpenWalletMailboxDeps {
  /**
   * This phone's push-gateway handle, if it has one, left at the mediator once the mailbox is open (`wake/set`), so a
   * sender's `wake/request` can ring the phone while the app is suspended. Absent or undefined: nothing is left, and
   * {@link setMailboxWakeHandle} can do it later, when the handle exists.
   */
  wakeHandle?: () => Promise<MailboxWakeHandle | undefined>
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
/**
 * Every mailbox DID this phone keeps (one per mediator it has opened one at), read once when a mailbox opens.
 * Held here so the inbound check is a set lookup: takeMailboxMessage runs once per message with the session's
 * acknowledgement waiting behind it, and these change only when a mailbox is minted.
 */
const keptMailboxDids = new WeakMap<Agent, Set<string>>()
const opening = new WeakMap<Agent, { mediatorDid: string; run: Promise<WalletMailbox> }>()
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
 * A Trust Task to the mailbox's mediator, signed for the mailbox DID (eddsa-jcs-2022, proof purpose authentication:
 * what the mediator verifies a management task with), asked over the mailbox's session. Returns the answer's body,
 * the mediator's response document.
 */
async function askMediator(
  agent: Agent,
  mailbox: WalletMailbox,
  type: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const document = {
    id: `urn:uuid:${utils.uuid()}`,
    type,
    issuer: mailbox.did,
    recipient: mailbox.mediatorDid,
    issuedAt: wireTimestamp(),
    payload,
  }
  const signed = await signDocumentProof(agent, document, mailbox.did, { proofPurpose: 'authentication' })
  const answer = await mailbox.session.ask(signed)
  return (answer.body ?? {}) as Record<string, unknown>
}

/**
 * Turn on this account's own forwarding right at the mediator. A phone's every send is a routing/2.0 forward, which
 * the mediator admits only from an account holding `SEND_FORWARDED`; an open-sign-up mailbox grants a new account
 * `SEND_FORWARDED_CHANGE` instead (deploy/keyring-messaging/mailbox/mailbox.toml), so the phone switches the right on
 * itself with a signed `messaging/account/update`, and the mediator answers the account's realised ACL.
 *
 * Asked at EVERY open, never remembered on the phone: the right lives in the mediator's account, which a restore of
 * the mediator's store can roll back; a flag kept here would then say "on" while every send is refused, with
 * nothing a tester could do about it. The task is idempotent and one small message. True when the answer shows the
 * right on. Refused or unconfirmed: false, said, and the mailbox still opens for receiving; a send then fails with
 * the mediator's refusal, which the sender sees, and the next open asks again.
 */
async function ensureMailboxForwarding(agent: Agent, mailbox: WalletMailbox): Promise<boolean> {
  try {
    const body = await askMediator(agent, mailbox, MEDIATOR_ACCOUNT_UPDATE, {
      did: mailboxAccountKey(mailbox.did),
      acl: { sendForwarded: true },
    })
    const acl = (body.payload as { acl?: { sendForwarded?: unknown } } | undefined)?.acl
    if (acl?.sendForwarded !== true) {
      releaseWarn(
        `${LOG_PREFIX} forwarding not confirmed on for ${didPrefix(mailbox.did)} at ${didPrefix(mailbox.mediatorDid)}: the answer is ${String(body.type ?? 'untyped')}`
      )
      return false
    }
    agent.config.logger.info(
      `${LOG_PREFIX} forwarding on for ${didPrefix(mailbox.did)} at ${didPrefix(mailbox.mediatorDid)}`
    )
    return true
  } catch (error) {
    releaseWarn(
      `${LOG_PREFIX} forwarding not set for ${didPrefix(mailbox.did)} at ${didPrefix(mailbox.mediatorDid)}: ${(error as Error).message}`
    )
    return false
  }
}

/**
 * Ask the recipient's mediator to ring the recipient for the message just forwarded (`messaging/wake/request`,
 * naming the recipient's mailbox and the stored id). The mediator answers `{}` whatever it decides, and rings the
 * recipient's push gateway only when the recipient is offline with a handle, the message is still stored and fresh,
 * this sender is its sender, and the limits allow (one per minute per pair, coalesced per recipient). Asked once per
 * forward. A caller may forward the same logical message more than once (announceRelationshipDid tries its first
 * contact three times, 2 s and 4 s apart; a person's "try again" sends anew), but each is a new basic message with its
 * own bytes and so its own stored id, which keeps to the spec's rule of one request per message; the extra wakes
 * then meet the per-pair limit, and their refusals are expected, said at info level. Best effort throughout: a
 * refusal or an old mediator is said at info level, since the message itself is already on its way and the phone
 * collects it when the app next opens.
 */
async function requestMailboxWake(agent: Agent, mailbox: WalletMailbox, addressee: string, id: string): Promise<void> {
  try {
    await askMediator(agent, mailbox, MEDIATOR_WAKE_REQUEST, { addressee, msgIds: [id], urgency: 'interactive' })
  } catch (error) {
    agent.config.logger.info(
      `${LOG_PREFIX} no wake asked for ${didPrefix(addressee)} at ${didPrefix(mailbox.mediatorDid)}: ${(error as Error).message}`
    )
  }
}

/**
 * Leave this phone's push-gateway handle at the mediator (`messaging/wake/set`), or clear it with no handle, so a
 * sender's `wake/request` rings the phone through the gateway while the app is suspended. Returns the mediator's
 * `wakeCapable`: true only when it holds the handle and can reach the gateway's DID. False, said, when no mailbox is
 * open or the mediator refuses.
 */
export async function setMailboxWakeHandle(agent: Agent, handle?: MailboxWakeHandle): Promise<boolean> {
  const mailbox = openMailboxes.get(agent)
  if (!mailbox) {
    agent.config.logger.info(`${LOG_PREFIX} no mailbox is open to leave a wake handle at`)
    return false
  }
  try {
    const body = await askMediator(
      agent,
      mailbox,
      MEDIATOR_WAKE_SET,
      handle ? { wakeHandle: { gateway: handle.gateway, handle: handle.handle } } : {}
    )
    const wakeCapable = (body.payload as { wakeCapable?: unknown } | undefined)?.wakeCapable === true
    agent.config.logger.info(
      `${LOG_PREFIX} wake handle ${handle ? 'left' : 'cleared'} at ${didPrefix(mailbox.mediatorDid)}: wakeCapable ${wakeCapable}`
    )
    return wakeCapable
  } catch (error) {
    releaseWarn(`${LOG_PREFIX} wake handle not set at ${didPrefix(mailbox.mediatorDid)}: ${(error as Error).message}`)
    return false
  }
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
  if (inFlight?.mediatorDid === mediatorDid) return inFlight.run
  if (inFlight) {
    // An open for another mediator is under way: let it finish (or fail), then open this one, which closes it.
    await inFlight.run.catch(() => undefined)
    return openWalletMailbox(agent, mediatorDid, deps)
  }
  const run = (async () => {
    if (current) await closeWalletMailbox(agent)
    const mediator = await (deps.resolveMediator ?? resolveVtiMediator)(agent, mediatorDid)
    const did = await mailboxDidFor(agent, mediator)
    const kept = await agent.genericRecords.findAllByQuery({ type: WALLET_MAILBOX_RECORD_TYPE })
    const keptDids = kept.map((record) => record.content?.did).filter((d): d is string => typeof d === 'string')
    keptMailboxDids.set(agent, new Set([did, ...keptDids]))
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
    // The account's forwarding right first, bounded (ASK_TIMEOUT_MS): until it is answered the mailbox does not count
    // as open, so nothing mints a v2 invitation or sends through it while a send would still be refused. A refusal
    // does not stop the open: receiving works, and a send then fails with the mediator's own words.
    await ensureMailboxForwarding(agent, mailbox)
    openMailboxes.set(agent, mailbox)
    if (!transports.has(agent)) {
      const transport = new WalletMailboxOutboundTransport(agent)
      transports.set(agent, transport)
      agent.modules.didcomm.registerOutboundTransport(transport)
    }
    agent.config.logger.info(`${LOG_PREFIX} mailbox ${didPrefix(did)} open at ${didPrefix(mediator.did)}`)
    const wakeHandle = deps.wakeHandle ? await deps.wakeHandle().catch(() => undefined) : undefined
    if (wakeHandle) await setMailboxWakeHandle(agent, wakeHandle)
    return mailbox
  })()
  opening.set(agent, { mediatorDid, run })
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
 * receiver, which opens it with the contact key. Awaited, so the session acknowledges only what was taken.
 *
 * The check on `next` establishes that it is a DID this phone created: ANY created DID (a contact DID, a VTA client
 * DID, a v1 peer DID), not only this mailbox's contact DIDs. That is what makes handing it on safe, since the
 * receiver can open only what this phone holds keys for. Two forwards are dropped (said, and acknowledged: neither
 * can ever be read as a contact's message): one whose `next` this phone did not create, and one whose `next` is a
 * mailbox DID of this phone's itself (any of them, one per mediator), since nothing is written to a mailbox except
 * through a contact DID that names it.
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
  if (next && (keptMailboxDids.get(agent)?.has(next) || next === walletMailboxOf(agent)?.did)) {
    releaseWarn(`${LOG_PREFIX} a forward addressed to one of this phone's mailbox DIDs itself; dropped`)
    return
  }
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
 * (the mediator, for a mailbox contact).
 *
 * The forward's `next` is a mailbox DID this phone resolved itself from the peer's contact DID document, and nothing
 * else: the DID the contact names, provided that DID's own document names a DID in turn (the mediator it signs in
 * at), which is what a mailbox is. Not Credo's endpoint and not the did:key the wrapping names: neither is where the
 * peer receives, and forwarding to either strands the message. When the peer's documents do not lead to a mailbox,
 * the send is refused, because where the peer receives cannot be established here.
 *
 * Every phone uses one mediator today, which is only why a peer on another one is rare. Such a peer is addressed the
 * same way, by its own mailbox DID; reaching that mailbox's mediator is the mediator's routing, not this transport's.
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
    const next = await this.peerMailbox(outboundPackage.connectionId)
    if (!next)
      throw new Error(
        `${LOG_PREFIX} no mailbox found: the peer's documents lead to no mailbox (connection ${outboundPackage.connectionId ?? 'none'})`
      )
    const { id } = await mailbox.session.forwardForMailbox(next, outboundPackage.payload)
    // The message is on its way once the forward is sent. The wake is asked after it and NOT awaited: it catches its
    // own failures, nothing downstream needs its answer, and a mediator that ignores an unknown task would otherwise
    // hold every send for the ask's whole timeout while the message was already stored.
    void requestMailboxWake(this.agent, mailbox, next, id)
  }

  private async peerMailbox(connectionId: string | undefined): Promise<string | undefined> {
    if (!connectionId) return undefined
    const connection = await this.agent.modules.didcomm.connections.findById(connectionId)
    if (!connection?.theirDid) return undefined
    const named = await mailboxNamedBy(this.agent, connection.theirDid).catch(() => undefined)
    if (!named) return undefined
    const signsInAt = await mailboxNamedBy(this.agent, named).catch(() => undefined)
    return signsInAt ? named : undefined
  }
}
