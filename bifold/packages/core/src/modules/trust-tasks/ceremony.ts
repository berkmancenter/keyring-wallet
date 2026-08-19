/**
 * The relationship ceremony on Trust Tasks — milestone 2, first slice.
 *
 * Recasts the relationship-DID handshake onto the merged upstream
 * specifications (`vrc/relationships/propose` and its `#response`,
 * trustoverip/dtgwg-trust-tasks-tf #213), capability-gated so mixed fleets
 * keep working:
 *
 *  - Both peers still announce over the legacy basic-message marker
 *    (`vrc:relationshipDid:… vrc:rceVersion:N`) — old peers see nothing new.
 *  - When BOTH peers speak v4+, the deterministic proposer opens the formal
 *    Trust Task exchange with `propose`. Its document `id` becomes the
 *    exchange thread every later leg nests under (`parentThreadId`) and the
 *    id a witnessed ceremony's `taskContext` chain hangs off — the thing the
 *    legacy dance never had.
 *  - Both dialects write the SAME repository state
 *    (`RelationshipDidRepository`), so issuance and everything downstream
 *    work unchanged whichever dialect ran.
 *
 * Proposer selection needs no negotiation: the peer whose connection DID
 * sorts lexicographically lower proposes. Both sides compute the same answer
 * from the same pair; no role assumptions, no race.
 *
 * @module trust-tasks/ceremony
 */

import type { Agent } from '@credo-ts/core'
import {
  DidCommMessageHandlerRegistry,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
} from '@credo-ts/didcomm'
import * as discovery from '@openvtc/trust-tasks/trust-task-discovery/0.1/payload'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import * as witnessSession from '@openvtc/trust-tasks/witness/session/0.1/payload'
import * as witnessSubmit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'
import {
  ClaimFormat,
  JsonTransformer,
  W3cCredential,
  W3cCredentialRecord,
  W3cJsonLdVerifiableCredential,
  W3cPresentation,
  utils,
} from '@credo-ts/core'

import {
  getConnectedWitnessConnectionId,
  getOrCreateRelationshipDid,
  getVrcJsonLdProofOptions,
  prepareVrcCredentialWithEvidence,
} from '../vrc/vrc-manager'
import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'
import { vrcFlowStore } from '../vrc/witnessStatusStore'

import { digestMultibase, signDocumentProof, verifyDocumentProof } from './documentProof'
import { resolveWitnessResponse, runWitnessSession } from './witnessCeremony'
import { TrustTaskMessage } from './messages/TrustTaskMessage'
import { TrustTasksModule } from './module/TrustTasksModule'
import { TrustTaskDocumentRepository } from './services/TrustTaskDocumentRepository'
import { TrustTasksService, respondWith, rejectWith, extendedCode } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:Ceremony]'

/** The first RCE protocol version whose peers speak the Trust Task dialect. */
export const TRUST_TASKS_MIN_RCE_VERSION = 4

/** Resolve (registering on first use) the module's service from an agent. */
export function getTrustTasksService(agent: Agent): TrustTasksService {
  const container = agent.dependencyManager.container
  if (!container.isRegistered(TrustTasksService)) {
    new TrustTasksModule().register(agent.dependencyManager)
  }
  return container.resolve(TrustTasksService)
}

/**
 * Deterministic proposer selection: both sides sort the connection-DID pair;
 * the lower one proposes. Symmetric, race-free, negotiation-free.
 */
export function isDeterministicProposer(myConnectionDid: string, theirConnectionDid: string): boolean {
  return myConnectionDid < theirConnectionDid
}

/**
 * The task types this wallet supports, as bare Type URIs — what our
 * trust-task-discovery response advertises. Slugs derive from these for
 * pattern matching.
 */
export const SUPPORTED_TASK_TYPES = [
  propose.TYPE_URI,
  issue.TYPE_URI,
] as const

/** The slug of a Type URI: authority and version stripped. */
function slugOfTypeUri(typeUri: string): string {
  return typeUri.replace(/^https:\/\/trusttasks\.org\/spec\//, '').replace(/\/\d+\.\d+$/, '')
}

/** Slug-glob match: '*' is the only metacharacter, matching any run. */
function slugMatchesPattern(slug: string, pattern: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return regex.test(slug)
}

/**
 * Begin the Trust Task relationship exchange toward a v4+ peer, if this side
 * is the deterministic proposer — starting with capability NEGOTIATION:
 * a trust-task-discovery query, with the propose gated on the peer actually
 * listing `vrc/relationships/propose` in its `supportedTypes` (§9 step 6:
 * negotiation through supportedTypes rather than an ordinal version). The
 * legacy `rceVersion` marker remains the bootstrap — it is what tells us the
 * peer can parse a Trust Task message at all, so a sub-v4 peer never sees
 * even the discovery query. Idempotent per connection.
 */
export async function maybeOpenRelationshipExchange(
  agent: Agent,
  connectionId: string,
  counterpartyRceVersion: number,
  myRceVersion: number
): Promise<void> {
  if (counterpartyRceVersion < TRUST_TASKS_MIN_RCE_VERSION || myRceVersion < TRUST_TASKS_MIN_RCE_VERSION) return

  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return
  if (!isDeterministicProposer(connection.did, connection.theirDid)) return

  const service = getTrustTasksService(agent)

  // Idempotence: one discovery (and one exchange) per connection.
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  for (const typeUri of [discovery.TYPE_URI, propose.TYPE_URI]) {
    const existing = await documentRepository.findByQuery(agent.context, { typeUri, connectionId })
    if (existing.length > 0) return
  }

  const document: Record<string, unknown> = {
    id: utils.uuid(),
    type: discovery.TYPE_URI,
    threadId: utils.uuid(),
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { patterns: ['vrc/relationships/*', 'witness/*'] },
  }
  await service.retain(agent.context, document, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, document)
  agent.config.logger.info(`${LOG_PREFIX} discovery sent on connection ${connectionId}`)
}

/**
 * Open the relationship exchange itself — called once discovery confirms the
 * peer supports the propose. Idempotent per connection.
 */
async function openRelationshipExchange(agent: Agent, connectionId: string): Promise<void> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return

  const service = getTrustTasksService(agent)
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const existing = await documentRepository.findByQuery(agent.context, {
    typeUri: propose.TYPE_URI,
    connectionId,
  })
  if (existing.length > 0) return

  const relationshipDid = await getOrCreateRelationshipDid(agent, connection.theirDid, connectionId)
  const exchangeId = utils.uuid()
  const document: Record<string, unknown> = {
    id: exchangeId,
    type: propose.TYPE_URI,
    threadId: exchangeId,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    // Witnessed when this wallet has a witness connected; each side then runs
    // its OWN witness session (the acceptance mirrors the flag). A side
    // without a witness simply skips its session — witnessing is additive.
    payload: { relationshipDid, witnessed: Boolean(getConnectedWitnessConnectionId()) },
  }

  await service.retain(agent.context, document, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, document)
  agent.config.logger.info(`${LOG_PREFIX} propose sent (exchange ${exchangeId}) on connection ${connectionId}`)
}

/**
 * Build a signed Verifiable Presentation wrapping the signed VRC, bound to a
 * witness session's {challenge, domain}. Mirrors the legacy witnessed flow's
 * construction: the VP @context follows the wrapped credential's data model,
 * and the VP proof stays Ed25519Signature2018 until the witness dual-verifies
 * Data Integrity presentations (docs/CRYPTO_SUITE_FOLLOWUP.md).
 */
async function buildChallengeBoundVp(
  agent: Agent,
  signedVcJson: Record<string, unknown>,
  verificationMethodId: string,
  challenge: string,
  domain: string
): Promise<Record<string, unknown>> {
  const holderDid = verificationMethodId.split('#')[0]
  const contexts: unknown[] = Array.isArray(signedVcJson['@context'])
    ? (signedVcJson['@context'] as unknown[])
    : [signedVcJson['@context']]
  const vpContext = contexts.includes('https://www.w3.org/ns/credentials/v2')
    ? 'https://www.w3.org/ns/credentials/v2'
    : 'https://www.w3.org/2018/credentials/v1'
  const vpUnsigned = JsonTransformer.fromJSON(
    {
      '@context': [vpContext],
      type: ['VerifiablePresentation'],
      holder: holderDid,
      verifiableCredential: [signedVcJson],
    },
    W3cPresentation
  )
  // proofPurpose deliberately omitted: credo 0.6 types it as a string but the
  // runtime needs a ProofPurpose instance — omitting lets vc build an
  // AuthenticationProofPurpose from challenge + domain (same note as the
  // legacy witnessed-vrc-manager).
  const signedVp = await agent.w3cCredentials.signPresentation({
    format: ClaimFormat.LdpVp,
    presentation: vpUnsigned,
    verificationMethod: verificationMethodId,
    proofType: 'Ed25519Signature2018',
    challenge,
    domain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  return JsonTransformer.toJSON(signedVp) as Record<string, unknown>
}

/** Pack a document onto the binding-0.2 carriage and send it over a connection. */
export async function sendTrustTaskDocument(
  agent: Agent,
  connectionId: string,
  document: Record<string, unknown>
): Promise<void> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
  await messageSender.sendMessage(
    new DidCommOutboundMessageContext(new TrustTaskMessage({ document }), {
      agentContext: agent.context,
      connection,
    })
  )
}

/**
 * Register the inbound side: the binding-0.2 message handler, routing
 * documents to the ceremony logic. Call once per agent, beside
 * `setupVrcConnectionHandler`.
 */
export function setupTrustTasksInbound(agent: Agent): void {
  const service = getTrustTasksService(agent)
  const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)

  TrustTasksModule.registerMessageHandler(registry, async (document, context) => {
    const type = String(document.type ?? '')
    const logger = agent.config.logger

    // Case 2 (binding §4.8.1): the dedicated carriage delivers even when the
    // sender binds to no known connection. Retain for diagnostics; never act.
    if (!context.senderDid || !context.recipientDid || !context.connectionId) {
      logger.warn(`${LOG_PREFIX} document ${document.id} arrived without an authenticated connection — retained, not processed`)
      await service.retain(agent.context, document, 'request')
      return
    }

    if (type === propose.TYPE_URI) {
      await handleInboundPropose(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }
    if (type === `${propose.TYPE_URI}#response`) {
      await handleInboundProposeResponse(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }

    if (type === discovery.TYPE_URI) {
      await handleInboundDiscovery(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }
    if (type === `${discovery.TYPE_URI}#response`) {
      await handleInboundDiscoveryResponse(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }
    if (type === issue.TYPE_URI) {
      await handleInboundIssue(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }
    if (type === `${issue.TYPE_URI}#response`) {
      await handleInboundIssueReceipt(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }

    // Witness-leg responses route to the ceremony awaiting them (the wallet
    // is the requester on both witness legs — inbound requests of these
    // types are a witness-server concern, not ours). Retain regardless: the
    // submit#response IS the outcome evidence.
    if (type === `${witnessSession.TYPE_URI}#response` || type === `${witnessSubmit.TYPE_URI}#response`) {
      await service.retain(agent.context, document, 'response', context.connectionId)
      if (!resolveWitnessResponse(document)) {
        logger.warn(`${LOG_PREFIX} witness response with no awaiting ceremony (thread ${document.threadId}) — retained`)
      }
      return
    }

    if (type.includes('/trust-task-error/')) {
      // The counterparty refused a leg of the exchange — the notable case
      // being a declined proposal. Retain the error (it is outcome evidence)
      // and stand the flow down.
      await service.retain(agent.context, document, 'error', context.connectionId)
      const code = (document as { payload?: { code?: string } }).payload?.code ?? 'unknown'
      logger.warn(`${LOG_PREFIX} trust-task-error received (${code}) on exchange ${document.threadId ?? document.id}`)
      vrcFlowStore.clearFlow(context.connectionId)
      return
    }

    // Future legs (witness/session…) land in later milestones —
    // retain so nothing is lost, complain so nothing is silent.
    logger.info(`${LOG_PREFIX} unhandled trust-task type ${type} — retained`)
    await service.retain(agent.context, document, 'request', context.connectionId)
  })

  agent.config.logger.info(`${LOG_PREFIX} inbound carriage handler registered (binding 0.2)`)
}

interface InboundContext {
  connectionId: string
  senderDid: string
  recipientDid: string
}

/**
 * Answer a trust-task-discovery query with the task types we support,
 * filtered by the query's slug-glob patterns. Discovery is read-only
 * metadata, so it needs no consent and no proof.
 */
async function handleInboundDiscovery(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: discovery.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => {
      const patterns = (doc as { payload?: { patterns?: string[] } }).payload?.patterns
      const effective = patterns && patterns.length > 0 ? patterns : ['*']
      const supportedTypes = SUPPORTED_TASK_TYPES.filter((typeUri) =>
        effective.some((pattern) => slugMatchesPattern(slugOfTypeUri(typeUri), pattern))
      )
      return respondWith(doc as never, utils.uuid(), { supportedTypes: [...supportedTypes] }, () =>
        new Date().toISOString()
      )
    },
  })

  if (outcome.kind === 'handled' && outcome.response) {
    await sendTrustTaskDocument(agent, context.connectionId, outcome.response as Record<string, unknown>)
    const count = ((outcome.response as { payload?: { supportedTypes?: unknown[] } }).payload?.supportedTypes ?? []).length
    agent.config.logger.info(`${LOG_PREFIX} discovery answered (${count} types) on connection ${context.connectionId}`)
  }
}

/**
 * The peer's discovery answer: open the relationship exchange only if it
 * actually lists the propose among its supportedTypes.
 */
async function handleInboundDiscoveryResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: discovery.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return

  const entries = (document as { payload?: { supportedTypes?: (string | { type: string })[] } }).payload?.supportedTypes ?? []
  const supportsPropose = entries.some((entry) => (typeof entry === 'string' ? entry : entry.type) === propose.TYPE_URI)
  if (!supportsPropose) {
    agent.config.logger.warn(
      `${LOG_PREFIX} peer does not list ${propose.TYPE_URI} in supportedTypes — exchange not opened`
    )
    return
  }
  agent.config.logger.info(`${LOG_PREFIX} discovery confirmed propose support on connection ${context.connectionId}`)
  await openRelationshipExchange(agent, context.connectionId)
}

/**
 * Pending proposals awaiting the user's consent, keyed by connection id.
 * The user's Accept/Decline (via `respondToRelationshipProposal`) resolves
 * them; the prompt itself is surfaced through `vrcFlowStore`.
 */
const pendingProposals = new Map<string, { document: Record<string, unknown>; context: InboundContext }>()

/**
 * Counterparty proposes: validate through the pipeline, then surface the
 * proposal for USER CONSENT — accepting the proposal is the trust-task
 * dialect's consent moment (it replaces the legacy per-credential accept),
 * so no response leaves until the user answers.
 */
async function handleInboundPropose(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: propose.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // Defer the answer to the user: a handler returning nothing is an
    // 'accepted' outcome with no reply on the wire.
    handler: async () => undefined,
  })

  if (outcome.kind === 'rejected') {
    agent.config.logger.warn(`${LOG_PREFIX} propose rejected: ${JSON.stringify((outcome as { error?: { payload?: unknown } }).error?.payload)}`)
    return
  }

  const connection = await agent.modules.didcomm.connections.getById(context.connectionId)
  pendingProposals.set(context.connectionId, { document, context })
  vrcFlowStore.setProposalPrompt({
    connectionId: context.connectionId,
    exchangeId: String(document.threadId ?? document.id),
    counterpartyLabel: connection.theirLabel ?? 'Unknown Contact',
  })
  agent.config.logger.info(
    `${LOG_PREFIX} propose received — awaiting user consent (exchange ${document.threadId ?? document.id})`
  )
}

/**
 * The user's answer to a pending relationship proposal.
 *
 * Accept: store the counterparty's relationship DID, answer with ours
 * (`accept: true`), then deliver our VRC on the exchange thread. Decline: a
 * `trust-task-error` with `vrc/relationships/propose:declined` — the spec is
 * explicit that a decline is never a response with `accept: false`.
 */
export async function respondToRelationshipProposal(
  agent: Agent,
  connectionId: string,
  accept: boolean
): Promise<void> {
  const logger = agent.config.logger
  const pending = pendingProposals.get(connectionId)
  pendingProposals.delete(connectionId)
  vrcFlowStore.clearProposalPrompt(connectionId)
  if (!pending) {
    logger.warn(`${LOG_PREFIX} no pending proposal for connection ${connectionId}`)
    return
  }
  const { document, context } = pending
  const exchangeId = String(document.threadId ?? document.id)
  const service = getTrustTasksService(agent)

  if (!accept) {
    const error = rejectWith(document as never, utils.uuid(), {
      code: extendedCode(propose.TYPE_URI, 'declined'),
      message: 'The user declined the relationship',
      retryable: false,
    })
    await service.retain(agent.context, error as never, 'error', connectionId)
    await sendTrustTaskDocument(agent, connectionId, error as unknown as Record<string, unknown>)
    vrcFlowStore.clearFlow(connectionId)
    logger.info(`${LOG_PREFIX} propose declined by user (exchange ${exchangeId})`)
    return
  }

  const payload = (document as { payload: { relationshipDid: string; witnessed?: boolean } }).payload
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  await repository.updateCounterpartyRelationshipDid(
    agent.context,
    context.senderDid,
    payload.relationshipDid,
    TRUST_TASKS_MIN_RCE_VERSION
  )
  const myRelationshipDid = await getOrCreateRelationshipDid(agent, context.senderDid, connectionId)
  const response = respondWith(document as never, utils.uuid(), {
    accept: true,
    relationshipDid: myRelationshipDid,
    witnessed: payload.witnessed === true,
  }, () => new Date().toISOString())
  await service.retain(agent.context, response as never, 'response', connectionId)
  await sendTrustTaskDocument(agent, connectionId, response as unknown as Record<string, unknown>)
  logger.info(`${LOG_PREFIX} propose accepted; response sent (exchange ${exchangeId})`)

  await deliverVrcViaTrustTaskForExchange(agent, connectionId, exchangeId).catch((e: Error) =>
    logger.error(`${LOG_PREFIX} VRC delivery after acceptance failed: ${e.message}`)
  )
}

/**
 * Deliver this side's VRC on an accepted exchange thread: build the
 * credential (with hardware-attestation evidence where available), sign it
 * standalone (DataIntegrityProof via the registered suite), wrap it in a
 * proof-bearing `vrc/relationships/issue` document, and send. Idempotent per
 * direction. This is the authority-flip delivery path — for v4 pairs the
 * legacy issue-credential leg no longer carries the VRC.
 */
export async function deliverVrcViaTrustTaskForExchange(
  agent: Agent,
  connectionId: string,
  exchangeId: string
): Promise<void> {
  const logger = agent.config.logger
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return

  const service = getTrustTasksService(agent)
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const priorIssues = await documentRepository.findByQuery(agent.context, {
    typeUri: issue.TYPE_URI,
    connectionId,
    role: 'request',
  })
  if (priorIssues.some((r) => r.document.issuer === connection.did)) return

  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, connection.theirDid)
  if (!record?.myRelationshipDid || !record.counterpartyRelationshipDid) {
    logger.warn(`${LOG_PREFIX} VRC delivery skipped — relationship DIDs incomplete for ${connectionId}`)
    return
  }

  vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
  const { credential } = await prepareVrcCredentialWithEvidence(
    agent,
    connection,
    record.myRelationshipDid,
    record.counterpartyRelationshipDid
  )

  const proofOptions = await getVrcJsonLdProofOptions(agent, record.counterpartyRelationshipDid)
  const didDocument = await agent.dids.resolveDidDocument(record.myRelationshipDid)
  const verificationMethodId = didDocument.verificationMethod?.[0]?.id
  if (!verificationMethodId) throw new Error(`no verification method on ${record.myRelationshipDid}`)

  const signedCredential = await agent.w3cCredentials.signCredential({
    format: ClaimFormat.LdpVc,
    credential: JsonTransformer.fromJSON(credential, W3cCredential),
    proofType: proofOptions.proofType,
    verificationMethod: verificationMethodId,
  })
  const signedVc = JsonTransformer.toJSON(signedCredential) as Record<string, unknown>

  // Witnessed exchange: run this party's witness session — its own nested
  // thread under the exchange — before the issue leg. Additive, never a
  // precondition: a ceremony failure logs and the exchange continues
  // unwitnessed (the plan's stance, and the legacy flow's fallback behavior).
  const witnessConnectionId = getConnectedWitnessConnectionId()
  const proposeDocs = await documentRepository.findByQuery(agent.context, {
    typeUri: propose.TYPE_URI,
    connectionId,
  })
  const exchangeWitnessed = proposeDocs.some(
    (r) =>
      String(r.document.threadId ?? r.document.id) === exchangeId &&
      (r.document as { payload?: { witnessed?: boolean } }).payload?.witnessed === true
  )
  if (exchangeWitnessed && witnessConnectionId) {
    vrcFlowStore.setStatus(connectionId, 'witness-active', true)
    try {
      await runWitnessSession(agent, {
        witnessConnectionId,
        exchangeId,
        parties: [record.myRelationshipDid, record.counterpartyRelationshipDid],
        myRelationshipDid: record.myRelationshipDid,
        buildPresentation: (challenge, domain) =>
          buildChallengeBoundVp(agent, signedVc, verificationMethodId, challenge, domain),
        sendDocument: sendTrustTaskDocument,
        retain: (doc, role) => service.retain(agent.context, doc, role, witnessConnectionId),
      })
      logger.info(`${LOG_PREFIX} witness session complete — VWC bound and stored (exchange ${exchangeId})`)
    } catch (e) {
      logger.warn(`${LOG_PREFIX} witness ceremony failed — continuing unwitnessed: ${(e as Error).message}`)
    }
    vrcFlowStore.setStatus(connectionId, 'preparing-offer', true)
  }

  const document: Record<string, unknown> = {
    id: utils.uuid(),
    type: issue.TYPE_URI,
    threadId: exchangeId,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { vrc: signedVc, vrcDigestMultibase: digestMultibase(signedVc) },
  }
  const signed = await signDocumentProof(agent, document, record.myRelationshipDid)

  await service.retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  vrcFlowStore.setStatus(connectionId, 'offer-sent', false)
  logger.info(`${LOG_PREFIX} issue sent (exchange ${exchangeId}) on connection ${connectionId}`)
}

/**
 * Proof policy for the issue legs: verify eddsa-jcs-2022 under the sender's
 * relationship DID (milestone 3's verifier, replacing `acceptUnverified`).
 * Without a relationship record there is no expected controller — accept
 * unverified and let the handler's party-binding check refuse `notAccepted`.
 * The propose legs stay on the service default: their proofs are OPTIONAL and
 * unsigned today, and at propose time the counterparty's relationship DID —
 * the would-be controller — is exactly what the document is delivering.
 */
async function issueProofPolicy(
  agent: Agent,
  senderDid: string
): Promise<{ kind: 'verify'; verify: { verify: (doc: unknown) => Promise<boolean> } } | { kind: 'acceptUnverified' }> {
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, senderDid)
  const expectedController = record?.counterpartyRelationshipDid
  if (!expectedController) return { kind: 'acceptUnverified' }
  return {
    kind: 'verify',
    verify: {
      verify: (doc: unknown) => verifyDocumentProof(agent, doc as Record<string, unknown>, expectedController),
    },
  }
}

/**
 * Counterparty delivers their signed VRC (`vrc/relationships/issue`).
 *
 * Conformance (spec, receiving party): verify the credential's party bindings
 * against the accepted proposal BEFORE returning a receipt; on acceptance,
 * answer with `vrcDigestMultibase` recomputed over the credential as
 * accepted; on refusal, a trust-task-error with `notAccepted`. Shadow mode:
 * storage stays with the legacy leg — this receipts the delivery.
 */
async function handleInboundIssue(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: issue.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // The eddsa-jcs-2022 verifier: the proof must verify under the sender's
    // relationship DID as the accepted proposal established it. When no
    // relationship record exists yet, fall through to the handler, whose
    // party-binding check refuses with the spec's `notAccepted` — the more
    // accurate error than `proofInvalid` for a delivery outside any accepted
    // exchange.
    proofPolicy: await issueProofPolicy(agent, context.senderDid),
    handler: async (doc) => {
      const payload = (doc as { payload: { vrc?: Record<string, unknown> } }).payload
      const vc = payload.vrc
      const notAccepted = (message: string) =>
        rejectWith(doc as never, utils.uuid(), {
          code: extendedCode(issue.TYPE_URI, 'notAccepted'),
          message,
          retryable: false,
        })
      if (!vc) return notAccepted('payload carries no credential')

      // Party bindings against the accepted proposal: the credential's issuer
      // must be the counterparty's relationship DID, its subject ours.
      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      const record = await repository.findByConnectionDid(agent.context, context.senderDid)
      const vcIssuer = typeof vc.issuer === 'object' && vc.issuer !== null ? (vc.issuer as { id?: string }).id : vc.issuer
      const subject = Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
      const subjectId = (subject as { id?: string } | undefined)?.id
      if (!record?.counterpartyRelationshipDid || vcIssuer !== record.counterpartyRelationshipDid) {
        return notAccepted('credential issuer is not the proposal counterparty relationship DID')
      }
      if (!record.myRelationshipDid || subjectId !== record.myRelationshipDid) {
        return notAccepted('credential subject is not this party relationship DID')
      }

      // Spec conformance (receiving party item 2): verify the credential's
      // OWN proof before storing it or returning a receipt. A credential that
      // does not even parse as a verifiable credential is the same refusal.
      let credentialInstance: W3cJsonLdVerifiableCredential
      try {
        credentialInstance = JsonTransformer.fromJSON(vc, W3cJsonLdVerifiableCredential)
      } catch {
        return notAccepted('payload is not a well-formed verifiable credential')
      }
      const verification = await agent.w3cCredentials.verifyCredential({ credential: credentialInstance })
      if (!verification.isValid) {
        return notAccepted('credential proof did not verify')
      }

      // Authority flip: store the delivered VRC (deduplicated by digest —
      // idempotent against redelivery and against a legacy-stored copy).
      const deliveredDigest = digestMultibase(vc)
      const existing = await agent.w3cCredentials.getAll()
      const alreadyStored = existing.some((r) => {
        try {
          return digestMultibase(JsonTransformer.toJSON(r.firstCredential)) === deliveredDigest
        } catch {
          return false
        }
      })
      if (!alreadyStored) {
        await agent.w3cCredentials.store({
          record: new W3cCredentialRecord({
            credentialInstances: [{ credential: vc as never }],
          }),
        })
        agent.config.logger.info(`${LOG_PREFIX} issue stored — VRC in wallet (exchange ${doc.threadId ?? doc.id})`)
      } else {
        agent.config.logger.info(`${LOG_PREFIX} issue already stored — receipting (exchange ${doc.threadId ?? doc.id})`)
      }
      vrcFlowStore.setStatus(context.connectionId, 'offer-received', false)

      // The receipt digest is computed over the credential AS STORED — here
      // byte-identical to the delivery we just accepted.
      return respondWith(doc as never, utils.uuid(), { vrcDigestMultibase: deliveredDigest }, () =>
        new Date().toISOString()
      )
    },
  })

  if (outcome.kind === 'handled' && outcome.response) {
    await sendTrustTaskDocument(agent, context.connectionId, outcome.response as Record<string, unknown>)
    logger.info(`${LOG_PREFIX} issue receipt sent (exchange ${document.threadId ?? document.id})`)
  } else if (outcome.kind === 'rejected') {
    // Handler refusals (notAccepted) and pipeline rejections (proofRequired…)
    // both surface here as a ready trust-task-error document — the binding
    // returns it on the same connection rather than going silent.
    const error = (outcome as { error?: Record<string, unknown> }).error
    if (error) await sendTrustTaskDocument(agent, context.connectionId, error)
    logger.warn(
      `${LOG_PREFIX} issue refused (exchange ${document.threadId ?? document.id}): ${JSON.stringify((error as { payload?: unknown } | undefined)?.payload)}`
    )
  }
}

/**
 * The counterparty's receipt for OUR delivery: correlate its recomputed
 * digest against the delivery we retained — a receipt whose digest matches no
 * delivery of ours acknowledges nothing (spec, issuing party item 4).
 */
async function handleInboundIssueReceipt(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: issue.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // Receipt proofs are OPTIONAL (we send ours unsigned); the verify policy
    // still checks one when a peer supplies it.
    proofPolicy: await issueProofPolicy(agent, context.senderDid),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return

  const receiptDigest = (document as { payload?: { vrcDigestMultibase?: string } }).payload?.vrcDigestMultibase
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const myConnectionDid = context.recipientDid
  const requests = await documentRepository.findByQuery(agent.context, {
    typeUri: issue.TYPE_URI,
    connectionId: context.connectionId,
    role: 'request',
  })
  const mine = requests.find((r) => r.document.issuer === myConnectionDid)
  const myDigest = (mine?.document as { payload?: { vrcDigestMultibase?: string } } | undefined)?.payload
    ?.vrcDigestMultibase
  if (receiptDigest && myDigest && receiptDigest === myDigest) {
    logger.info(`${LOG_PREFIX} issue receipt matched — VRC delivery acknowledged (exchange ${document.threadId ?? document.id})`)
  } else {
    logger.warn(
      `${LOG_PREFIX} issue receipt digest matches no delivery of ours (exchange ${document.threadId ?? document.id}) — not acknowledged`
    )
  }
}

/** The counterparty accepted our propose: store their relationship DID. */
async function handleInboundProposeResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: propose.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => {
      const payload = (doc as { payload: { relationshipDid: string; accept: boolean } }).payload
      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      await repository.updateCounterpartyRelationshipDid(
        agent.context,
        context.senderDid,
        payload.relationshipDid,
        TRUST_TASKS_MIN_RCE_VERSION
      )
      return doc
    },
  })

  if (outcome.kind === 'handled') {
    agent.config.logger.info(`${LOG_PREFIX} propose#response consumed; relationship established (exchange ${document.threadId ?? document.id})`)
    // Proposer side of the authority flip: the exchange is accepted, deliver
    // our VRC on its thread.
    await deliverVrcViaTrustTaskForExchange(agent, context.connectionId, String(document.threadId ?? document.id)).catch(
      (e: Error) => agent.config.logger.error(`${LOG_PREFIX} VRC delivery after acceptance failed: ${e.message}`)
    )
  }
}
