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
import * as credentialExchangePresent from '@openvtc/trust-tasks/credential-exchange/present/0.1/payload'
import * as credentialExchangeQuery from '@openvtc/trust-tasks/credential-exchange/query/0.1/payload'
import * as discovery from '@openvtc/trust-tasks/trust-task-discovery/0.1/payload'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import * as witnessSession from '@openvtc/trust-tasks/witness/session/0.1/payload'
import * as witnessSubmit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'
import {
  ClaimFormat,
  DcqlService,
  JsonTransformer,
  W3cCredential,
  W3cCredentialRecord,
  W3cJsonLdVerifiableCredential,
  W3cPresentation,
  utils,
} from '@credo-ts/core'

import {
  RCE_PROTOCOL_VERSION,
  getConnectedWitnessConnectionId,
  getOrCreateRelationshipDid,
  getVrcJsonLdProofOptions,
  isLocalityConfirmationPreferred,
  isWitnessingPreferred,
  issueRCardForAcceptedExchange,
  prepareVrcCredentialWithEvidence,
} from '../vrc/vrc-manager'
import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'
import { isLocalWorkStatus, vrcFlowStore } from '../vrc/witnessStatusStore'
import { logIssuedVrcJson } from '../vrc/vrc-credential-log'
import { credentialExchangeStore } from './credentialExchangeStore'

import type { CarriageDocumentHandler } from '@bifold/trust-tasks'

import { LOCALITY_EXT_NAMESPACE } from './deviceLocality'
import { createDeviceLocalityProvider } from './BleDeviceLocalityProvider'
import { digestMultibase, signDocumentProof, verifyDocumentProof } from './documentProof'
import { resolveWitnessResponse, runWitnessSession } from './witnessCeremony'
import * as witnessShare from './witnessShareSpec'
import * as continuitySpec from '../vrc/contacts/continuitySpec'
import { handleContinuityRequest, handleContinuityResponse } from '../vrc/contacts/continuity'
import type { VwcPresentationBundle } from './outcomeEvidence'
import { createDidCommV1Carriage } from './module/DidCommV1Carriage'
import { setupChatInbound } from '../chat/inbound'
import { createDidCommV2Carriage } from './module/DidCommV2Carriage'
import { createTspCarriage } from './module/TspCarriage'
import { WITNESS_VERIFIED_TAG } from '../vrc/utils/witnessCredentialUtils'

import { TrustTasksModule } from './module/TrustTasksModule'
import { trustTaskRegistry } from './registry'
import type { InboundContext as RegistryInboundContext } from './registry'
import { TrustTaskDocumentRepository } from './services/TrustTaskDocumentRepository'
import { TrustTasksService, respondWith, rejectWith, extendedCode } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:Ceremony]'

/**
 * Dev/test-only carriage selection — no auto-negotiation yet (the ladder
 * TSP > DIDComm v2 > REST from the parent plan's §4.2 is separate follow-on
 * work). Defaults to false so production behavior is unchanged; e2e and
 * tests opt in explicitly via {@link setTspCarriageEnabled}. See
 * docs/plans/openvtc-integration-plan/2026-09-02-bam.md for why a
 * wallet-to-wallet TSP carriage doesn't need to wait on ecosystem interop.
 */
let tspCarriageEnabled = false

export function setTspCarriageEnabled(enabled: boolean): void {
  tspCarriageEnabled = enabled
}

export function isTspCarriageEnabled(): boolean {
  return tspCarriageEnabled
}

/**
 * Developer-flagged DIDComm v2 (docs/plans/openvtc-integration-plan/didcomm_v2_subtask.md
 * V2 step C11/C12): when on, the agent enables `didcommVersions: ['v1','v2']`
 * and new relationship invitations are Out-of-Band 2.0 on did:peer:2. It does
 * NOT decide the carriage — `selectCarriage` does, per connection (below).
 */
let didCommV2Enabled = false

export function setDidCommV2Enabled(enabled: boolean): void {
  didCommV2Enabled = enabled
}

export function isDidCommV2Enabled(): boolean {
  return didCommV2Enabled
}

export type TrustTaskCarriageKind = 'didcomm-v1' | 'didcomm-v2' | 'tsp'

/**
 * The carriage a document takes to a peer, per connection:
 *
 * | TSP developer flag | connection | carriage |
 * |---|---|---|
 * | on  | v1 or v2 | TSP envelope, delivered on that connection |
 * | off | v2 | DIDComm v2 binding |
 * | off | v1 | DIDComm v1 binding |
 *
 * TSP is an envelope, not a connection type: it rides whichever DIDComm
 * version the connection speaks (didcomm_v2_subtask.md V2T; the envelope
 * and keys were measured over v2 in tsp-reference/ref-19). Without the flag
 * the connection's own DIDComm version decides — a v2 record exists only
 * because the peer produced or accepted a v2 invitation. None of this
 * rewrites a document: carriages are byte-identical for it (ref-16). The
 * parent plan's §4.2 DID-document resolver (`TSPTransport`) is not built.
 */
export async function selectCarriage(agent: Agent, connectionId: string): Promise<TrustTaskCarriageKind> {
  if (tspCarriageEnabled) return 'tsp'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  return connection.didcommVersion === 'v2' ? 'didcomm-v2' : 'didcomm-v1'
}

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
  witnessShare.TYPE_URI,
  credentialExchangeQuery.TYPE_URI,
] as const

/** The slug of a Type URI: authority and version stripped. */
function slugOfTypeUri(typeUri: string): string {
  return typeUri.replace(/^https:\/\/trusttasks\.org\/spec\//, '').replace(/\/\d+\.\d+$/, '')
}

/** Slug-glob match: '*' is the only metacharacter, matching any run. */
function slugMatchesPattern(slug: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  )
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

  // Idempotence: one exchange per connection (the discovery query has its
  // own issuer-aware idempotence inside sendDiscoveryQuery).
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const existing = await documentRepository.findByQuery(agent.context, { typeUri: propose.TYPE_URI, connectionId })
  if (existing.length > 0) return

  // Resume an exchange interrupted between "peer's discovery answer processed"
  // and "propose sent". Both messages that normally drive the ceremony forward
  // — the peer's rceVersion marker and its discovery response — are consumed
  // exactly once, and openRelationshipExchange is otherwise only reachable
  // from the response handler, so without this a restart in that window wedges
  // the connection permanently: sendDiscoveryQuery below no-ops (our own query
  // is already retained) and nothing ever sends the propose. Device logs
  // 2026-08-26 showed the status stuck at 'connecting' through the 60s timeout
  // after an app kill, repeatably. Safe to re-run: the negotiation gate is
  // satisfied by the retained answer, and openRelationshipExchange is
  // idempotent on the propose.
  if ((await peerSupportsTaskType(agent, connectionId, propose.TYPE_URI)) === true) {
    agent.config.logger.info(`${LOG_PREFIX} resuming exchange from retained discovery answer on ${connectionId}`)
    await openRelationshipExchange(agent, connectionId)
    return
  }

  await sendDiscoveryQuery(agent, connectionId)
}

/**
 * Re-drive Trust Task exchanges left in flight by an app restart.
 *
 * Nothing else can. The ceremony is opened by the peer's one-shot
 * `vrc:relationshipDid:…vrc:rceVersion:N` basic message and advanced by its
 * one-shot discovery response; both are consumed exactly once and never
 * redelivered, while the progress state (vrcFlowStore) is in-memory and lost
 * with the process. Called once at agent setup (setupVrcConnectionHandler).
 *
 * Keyed off persisted state only: RelationshipDidRecord carries the peer's
 * announced rceVersion and its connectionId. Every step it reaches is
 * idempotent, so a sweep on a fully-settled wallet is a no-op. The responder's
 * half, a propose asked for consent and never answered, is asked again by
 * restorePendingProposals.
 */
export async function resumeInterruptedExchanges(agent: Agent): Promise<void> {
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const records = await repository.getAll(agent.context)
  let resumed = 0
  for (const record of records) {
    const { connectionId, counterpartyRceVersion } = record
    if (!connectionId || (counterpartyRceVersion ?? 1) < TRUST_TASKS_MIN_RCE_VERSION) continue
    try {
      await maybeOpenRelationshipExchange(agent, connectionId, counterpartyRceVersion as number, RCE_PROTOCOL_VERSION)
      resumed += 1
    } catch (e) {
      agent.config.logger.warn(
        `${LOG_PREFIX} resume check failed for connection ${connectionId}: ${(e as Error).message}`
      )
    }
  }
  agent.config.logger.info(`${LOG_PREFIX} resume sweep checked ${resumed} v4+ connection(s)`)

  // The responder's half: proposes asked for consent and never answered.
  try {
    const asked = await restorePendingProposals(agent)
    if (asked > 0) agent.config.logger.info(`${LOG_PREFIX} resume sweep asked again for ${asked} pending propose(s)`)
  } catch (e) {
    agent.config.logger.warn(`${LOG_PREFIX} pending-propose restore failed: ${(e as Error).message}`)
  }
}

/**
 * Send our trust-task-discovery query on a connection, once per side —
 * idempotent on OUR OWN query (the peer's inbound query is also retained
 * under the same type URI, so the check is issuer-aware). Both parties run
 * this: the proposer to gate the propose, the responder (at acceptance) to
 * learn the proposer's supportedTypes for the witness-share gate.
 */
async function sendDiscoveryQuery(agent: Agent, connectionId: string): Promise<void> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const existing = await documentRepository.findByQuery(agent.context, { typeUri: discovery.TYPE_URI, connectionId })
  // Base-URI tagging: our ANSWER to the peer's query shares this typeUri tag,
  // so match on the document's own type too — else answering first forever
  // masquerades as having queried.
  if (existing.some((r) => r.document.type === discovery.TYPE_URI && r.document.issuer === connection.did)) return

  const service = getTrustTasksService(agent)
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
  // The peer's answer costs a mediated round trip; surface the wait — unless
  // this phone is doing its own work meanwhile: the responder's query runs
  // beside its delivery, and "Checking what your contact supports…" replaced
  // "Preparing your relationship credential…" while it was still preparing it.
  const now = vrcFlowStore.getStatus(connectionId)
  if (now !== 'idle' && !isLocalWorkStatus(now)) {
    vrcFlowStore.setDialect(connectionId, 'trust-tasks')
    vrcFlowStore.setStatus(connectionId, 'discovering', vrcFlowStore.isWitnessedFlow(connectionId))
  }
}

/**
 * Whether the peer's retained discovery answer lists a task type.
 * Returns null when no answer from the peer has arrived yet — callers that
 * can wait should distinguish "not yet known" from "known unsupported".
 */
async function peerSupportsTaskType(agent: Agent, connectionId: string, typeUri: string): Promise<boolean | null> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.theirDid) return null
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  // Retention tags records by the BASE type URI (TrustTaskDocumentRecord
  // strips the #response fragment) — query the base and filter on the
  // document's own type.
  const responses = await documentRepository.findByQuery(agent.context, {
    typeUri: discovery.TYPE_URI,
    connectionId,
    role: 'response',
  })
  const fromPeer = responses.filter(
    (r) => r.document.type === `${discovery.TYPE_URI}#response` && r.document.issuer === connection.theirDid
  )
  if (fromPeer.length === 0) return null
  return fromPeer.some((r) => {
    const entries =
      (r.document as { payload?: { supportedTypes?: (string | { type: string })[] } }).payload?.supportedTypes ?? []
    return entries.some((entry) => (typeof entry === 'string' ? entry : entry.type) === typeUri)
  })
}

/**
 * Send our trust-task-discovery query on a witness connection specifically
 * (locality-plan.md §10.3 item 8) — `sendDiscoveryQuery` is connection-
 * agnostic and its own patterns already include `witness/*`, so this is a
 * thin, intention-revealing wrapper for the witness-connect call site.
 * Fire-and-forget, same as the peer-connection callers of the underlying
 * function.
 */
export async function queryWitnessDiscovery(agent: Agent, witnessConnectionId: string): Promise<void> {
  await sendDiscoveryQuery(agent, witnessConnectionId)
}

export type WitnessLocalitySupport = 'required' | 'offered' | 'off'

/**
 * A connected witness's discovery-declared locality policy (locality-plan.md
 * §8.2): `required` marks `witness/session` with `requiredExt` for the
 * locality namespace, `offered` marks it with `offeredExt`, and `off` (or a
 * row with neither marker) means this witness has no locality leg at all.
 * Returns null when no discovery answer has arrived yet — a caller gating on
 * this (e.g. the witness-connect pre-flight sheet, before Bluetooth
 * permission is requested) must treat "not yet known" as distinct from
 * "known off", exactly as `peerSupportsTaskType` does above.
 */
export async function getWitnessLocalitySupport(
  agent: Agent,
  witnessConnectionId: string
): Promise<WitnessLocalitySupport | null> {
  const connection = await agent.modules.didcomm.connections.getById(witnessConnectionId)
  if (!connection.theirDid) return null
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const responses = await documentRepository.findByQuery(agent.context, {
    typeUri: discovery.TYPE_URI,
    connectionId: witnessConnectionId,
    role: 'response',
  })
  const fromWitness = responses.filter(
    (r) => r.document.type === `${discovery.TYPE_URI}#response` && r.document.issuer === connection.theirDid
  )
  if (fromWitness.length === 0) return null

  const entries = fromWitness.flatMap(
    (r) =>
      (
        r.document as {
          payload?: { supportedTypes?: (string | { type: string; requiredExt?: string[]; offeredExt?: string[] })[] }
        }
      ).payload?.supportedTypes ?? []
  )
  const sessionEntries = entries.filter(
    (entry): entry is { type: string; requiredExt?: string[]; offeredExt?: string[] } =>
      typeof entry !== 'string' && entry.type === witnessSession.TYPE_URI
  )
  if (sessionEntries.some((entry) => (entry.requiredExt ?? []).includes(LOCALITY_EXT_NAMESPACE))) return 'required'
  if (sessionEntries.some((entry) => (entry.offeredExt ?? []).includes(LOCALITY_EXT_NAMESPACE))) return 'offered'
  return 'off'
}

/**
 * Whether a connected witness's discovery answer marks `witness/session` as
 * requiring the locality `ext` namespace. Returns null when no answer has
 * arrived yet — see `getWitnessLocalitySupport`, which this is a thin
 * boolean projection of, kept for callers that only care about `required`.
 */
export async function getWitnessLocalityRequirement(
  agent: Agent,
  witnessConnectionId: string
): Promise<boolean | null> {
  const support = await getWitnessLocalitySupport(agent, witnessConnectionId)
  return support === null ? null : support === 'required'
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
    // Witnessed when this wallet has a witness connected AND the user's
    // witnessing preference allows it; each side then runs its OWN witness
    // session (the acceptance mirrors the flag). A side without a witness
    // simply skips its session — witnessing is additive.
    payload: {
      relationshipDid,
      witnessed: Boolean(getConnectedWitnessConnectionId()) && (await isWitnessingPreferred()),
    },
  }

  await service.retain(agent.context, document, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, document)
  agent.config.logger.info(`${LOG_PREFIX} propose sent (exchange ${exchangeId}) on connection ${connectionId}`)
  // Waiting on the counterparty's consent — another mediated round trip.
  vrcFlowStore.setDialect(connectionId, 'trust-tasks')
  vrcFlowStore.setStatus(connectionId, 'proposed', vrcFlowStore.isWitnessedFlow(connectionId))
}

// ---- upgrading a relationship on its existing connection --------------------
//
// The automatic first exchange is once per connection (maybeOpen/open above,
// and restart recovery depends on it). An UPGRADE is an explicit request from
// either person, on the connection they already exchanged on, to sign the
// relationship cards again — with secure hardware now, or with a witness. It
// reuses the relationship DIDs already stored for that connection and never
// introduces a new identifier: a propose or response naming another is
// refused. The other person consents as to any proposal; no profile (R-Card)
// is re-sent; one send per request, never retried; the initiator may cancel
// a pending one locally.

/** A retained document's exchange: its thread. */
const threadOf = (r: { document: Record<string, unknown> }): string => String(r.document.threadId ?? r.document.id)

/**
 * Whether one of `issuer`'s retained documents belongs to `exchangeId`: the
 * issue and witness-share guards, once per EXCHANGE (an upgrade is another
 * exchange on the same connection; redelivery within one stays a no-op).
 */
export function priorForExchange(
  priors: { document: Record<string, unknown> }[],
  issuer: string,
  exchangeId: string
): boolean {
  return priors.some((r) => r.document.issuer === issuer && threadOf(r) === exchangeId)
}

/** The propose-thread documents (proposes, responses) retained on a connection. */
async function proposeThreadDocs(
  agent: Agent,
  connectionId: string
): Promise<{ document: Record<string, unknown>; role?: string }[]> {
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  return (await documentRepository.findByQuery(agent.context, { typeUri: propose.TYPE_URI, connectionId })) as never
}

/**
 * Whether `exchangeId` (if given) upgrades a relationship: another exchange on
 * this connection was already accepted. Read from retained documents, so it
 * holds across a restart, and from no clock.
 */
export async function isUpgradeExchange(agent: Agent, connectionId: string, exchangeId?: string): Promise<boolean> {
  const docs = await proposeThreadDocs(agent, connectionId)
  return docs.some(
    (r) =>
      String(r.document.type ?? '').endsWith('#response') &&
      (r.document.payload as { accept?: boolean } | undefined)?.accept === true &&
      threadOf(r) !== exchangeId
  )
}

const UPGRADE_CANCELLED = 'keyring.vrc-upgrade-cancelled'

async function isUpgradeCancelled(agent: Agent, connectionId: string, exchangeId: string): Promise<boolean> {
  const found = await agent.genericRecords.findAllByQuery({ recordType: UPGRADE_CANCELLED, connectionId, exchangeId })
  return found.length > 0
}

export type RelationshipUpgradeResult =
  | { kind: 'sent'; exchangeId: string }
  | { kind: 'noRelationship' }
  | { kind: 'noWitness' }
  | { kind: 'peerUnsupported' }

/**
 * Ask the other person to sign the relationship cards again, on the existing
 * connection: `witnessed` asks for it in front of a witness (this phone must
 * have one connected). One propose per call; nothing is retried.
 */
export async function upgradeRelationship(
  agent: Agent,
  connectionId: string,
  options: { witnessed: boolean }
): Promise<RelationshipUpgradeResult> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return { kind: 'noRelationship' }
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, connection.theirDid)
  if (!record?.myRelationshipDid || !record.counterpartyRelationshipDid) return { kind: 'noRelationship' }
  if (!(await isUpgradeExchange(agent, connectionId))) return { kind: 'noRelationship' }
  if (options.witnessed && !getConnectedWitnessConnectionId()) return { kind: 'noWitness' }
  if ((await peerSupportsTaskType(agent, connectionId, propose.TYPE_URI)) !== true) return { kind: 'peerUnsupported' }

  const exchangeId = utils.uuid()
  const document: Record<string, unknown> = {
    id: exchangeId,
    type: propose.TYPE_URI,
    threadId: exchangeId,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    // The relationship DID already stored for this connection: an upgrade adds
    // fresh cards, never a new identifier.
    payload: { relationshipDid: record.myRelationshipDid, witnessed: options.witnessed },
  }
  await getTrustTasksService(agent).retain(agent.context, document, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, document)
  agent.config.logger.info(
    `${LOG_PREFIX} upgrade propose sent (exchange ${exchangeId}, ${options.witnessed ? 'witnessed' : 'resign'}) on ${connectionId}`
  )
  vrcFlowStore.setDialect(connectionId, 'trust-tasks')
  vrcFlowStore.setStatus(connectionId, 'proposed', options.witnessed)
  return { kind: 'sent', exchangeId }
}

/** This phone's upgrade request on a connection still waiting for the other person, if any. */
export async function pendingUpgradeOf(
  agent: Agent,
  connectionId: string
): Promise<{ exchangeId: string; witnessed: boolean } | undefined> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did) return undefined
  const docs = await proposeThreadDocs(agent, connectionId)
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const ours = docs
    .filter((r) => r.document.type === propose.TYPE_URI && r.document.issuer === connection.did)
    .sort((a, b) => String(b.document.issuedAt ?? '').localeCompare(String(a.document.issuedAt ?? '')))
  for (const r of ours) {
    const exchangeId = threadOf(r)
    if (!(await isUpgradeExchange(agent, connectionId, exchangeId))) continue
    const answered = docs.some((d) => threadOf(d) === exchangeId && String(d.document.type ?? '').endsWith('#response'))
    if (answered) continue
    const errors = (await documentRepository.findByQuery(agent.context, { exchangeId, connectionId })) as {
      document: Record<string, unknown>
    }[]
    if (errors.some((d) => String(d.document.type ?? '').includes('trust-task-error'))) continue
    if (await isUpgradeCancelled(agent, connectionId, exchangeId)) continue
    return {
      exchangeId,
      witnessed: (r.document.payload as { witnessed?: boolean } | undefined)?.witnessed === true,
    }
  }
  return undefined
}

/**
 * Withdraw this phone's pending upgrade, locally: a later acceptance of it
 * sends no card. Nothing goes on the wire, so it reveals nothing to the other
 * person either.
 */
export async function cancelRelationshipUpgrade(agent: Agent, connectionId: string, exchangeId: string): Promise<void> {
  await agent.genericRecords.save({
    content: { exchangeId },
    tags: { recordType: UPGRADE_CANCELLED, connectionId, exchangeId },
  })
  vrcFlowStore.clearFlow(connectionId, 'cancelled')
  agent.config.logger.info(`${LOG_PREFIX} upgrade withdrawn locally (exchange ${exchangeId})`)
}

/**
 * Build a signed Verifiable Presentation wrapping the signed VRC, bound to a
 * witness session's {challenge, domain}. Mirrors the legacy witnessed flow's
 * construction: the VP @context follows the wrapped credential's data model,
 * and the VP proof stays Ed25519Signature2018 until the witness dual-verifies
 * Data Integrity presentations (docs/CRYPTO_SUITE_FOLLOWUP.md).
 */
export async function buildChallengeBoundVp(
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

/**
 * Pack a document onto a carriage and send it over a connection —
 * binding-0.2 (DIDComm-v1) by default, or the real TSP envelope carriage
 * when {@link setTspCarriageEnabled} has opted in.
 */
export async function sendTrustTaskDocument(
  agent: Agent,
  connectionId: string,
  document: Record<string, unknown>
): Promise<void> {
  const kind = await selectCarriage(agent, connectionId)
  const carriage =
    kind === 'didcomm-v2'
      ? createDidCommV2Carriage(agent)
      : kind === 'tsp'
        ? createTspCarriage(agent)
        : createDidCommV1Carriage(agent)
  await carriage.send(document, { connectionId })
}

/**
 * Register the inbound side: the binding-0.2 message handler (and, when
 * {@link setTspCarriageEnabled} has opted in, the TSP envelope carriage's
 * handler too — both route to the same ceremony logic below), routing
 * documents to the ceremony logic. Call once per agent, beside
 * `setupVrcConnectionHandler`.
 */
export function setupTrustTasksInbound(agent: Agent): void {
  const service = getTrustTasksService(agent)

  const handleInboundDocument: CarriageDocumentHandler = async (document, context) => {
    const type = String(document.type ?? '')
    const logger = agent.config.logger

    // Case 2 (binding §4.8.1): the dedicated carriage delivers even when the
    // sender binds to no known connection. Retain for diagnostics; never act.
    if (!context.senderDid || !context.recipientDid || !context.connectionId) {
      logger.warn(
        `${LOG_PREFIX} document ${document.id} arrived without an authenticated connection — retained, not processed`
      )
      await service.retain(agent.context, document, 'request')
      return
    }

    // The open registry (R5, docs/plans/reference-app-sdk-packaging.md):
    // every task type this wallet understands — including the VRC/witness/
    // discovery types below, registered at the bottom of this file — is
    // looked up here rather than matched in an if/else. A demo profile adds
    // a new type by calling `registerTrustTask(...)`; it never edits this
    // dispatch.
    const resolved = trustTaskRegistry.resolveForDocumentType(type)
    if (resolved) {
      const ctx: RegistryInboundContext = {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      }
      if (resolved.isResponse) {
        if (resolved.registration.handleResponse) {
          await resolved.registration.handleResponse(agent, service, document, ctx)
        } else {
          logger.info(`${LOG_PREFIX} ${type} has no registered response handler — retained`)
          await service.retain(agent.context, document, 'response', context.connectionId)
        }
      } else {
        await resolved.registration.handleRequest(agent, service, document, ctx)
      }
      return
    }

    if (type === credentialExchangeQuery.TYPE_URI) {
      await handleInboundCredentialExchangeQuery(agent, service, document, {
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
      // A declined proposal is the other person's no; any other refusal is an error. Neither is a confirmation.
      vrcFlowStore.clearFlow(context.connectionId, /declined$/.test(code) ? 'declined' : 'error')
      return
    }

    // Future legs (witness/session…) land in later milestones —
    // retain so nothing is lost, complain so nothing is silent.
    logger.info(`${LOG_PREFIX} unhandled trust-task type ${type} — retained`)
    await service.retain(agent.context, document, 'request', context.connectionId)
  }

  // keyring/chat/1.0 (rich-messaging-plan.md) rides the same inbound setup so
  // every app that receives Trust Tasks also receives chat events: a contact
  // that announces chat support must never reach a build that drops them.
  // Registered before the Trust Task carriages, for the same last-handler
  // reason given below.
  setupChatInbound(agent)

  // The v2 binding's handler is always registered: it only ever fires for
  // messages of its own type, and a v2 peer may reach us whatever the flag.
  // Registered first so the v1 registration stays the latest one (fakes that
  // keep only the last registered handler keep exercising the v1 path).
  createDidCommV2Carriage(agent).onDocument(handleInboundDocument)
  createDidCommV1Carriage(agent).onDocument(handleInboundDocument)
  if (tspCarriageEnabled) {
    createTspCarriage(agent).onDocument(handleInboundDocument)
  }

  agent.config.logger.info(
    `${LOG_PREFIX} inbound carriage handlers registered (binding didcomm-v1/0.2 + didcomm/0.2${tspCarriageEnabled ? ' + TSP envelope' : ''})`
  )
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
      // The registry is authoritative — SUPPORTED_TASK_TYPES itself is
      // registered into it below, so a type registered by a demo profile
      // (e.g. the Approver's access-request) is advertised the same way the
      // built-in VRC/witness types are, with no separate list to keep in
      // sync.
      const allTypes = [...new Set([...SUPPORTED_TASK_TYPES, ...trustTaskRegistry.listTypeUris()])]
      const supportedTypes = allTypes.filter((typeUri) =>
        effective.some((pattern) => slugMatchesPattern(slugOfTypeUri(typeUri), pattern))
      )
      return respondWith(doc as never, utils.uuid(), { supportedTypes: [...supportedTypes] }, () =>
        new Date().toISOString()
      )
    },
  })

  if (outcome.kind === 'handled' && outcome.response) {
    await sendTrustTaskDocument(agent, context.connectionId, outcome.response as Record<string, unknown>)
    const count = ((outcome.response as { payload?: { supportedTypes?: unknown[] } }).payload?.supportedTypes ?? [])
      .length
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

  const entries =
    (document as { payload?: { supportedTypes?: (string | { type: string })[] } }).payload?.supportedTypes ?? []
  // Only the deterministic proposer acts on the answer by opening the
  // exchange; the responder's own query (sent at acceptance) exists to
  // learn the peer's types — the retained answer is the record.
  const connection = await agent.modules.didcomm.connections.getById(context.connectionId)
  if (!connection.did || !connection.theirDid || !isDeterministicProposer(connection.did, connection.theirDid)) {
    agent.config.logger.info(
      `${LOG_PREFIX} discovery answered by peer recorded (${entries.length} types) on connection ${context.connectionId}`
    )
    return
  }
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
type PendingProposal = { document: Record<string, unknown>; context: InboundContext }
const pendingProposals = new Map<string, PendingProposal>()

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
    agent.config.logger.warn(
      `${LOG_PREFIX} propose rejected: ${JSON.stringify((outcome as { error?: { payload?: unknown } }).error?.payload)}`
    )
    return
  }

  const exchangeId = String(document.threadId ?? document.id)
  const proposed = (document as { payload?: { relationshipDid?: string; witnessed?: boolean } }).payload
  // An upgrade of a relationship this connection already exchanged on must
  // name the relationship DID already stored for it: an upgrade never brings
  // a new identifier, so one that does is refused, never asked.
  const upgrade = await isUpgradeExchange(agent, context.connectionId, exchangeId)
  if (upgrade) {
    const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
    const record = await repository.findByConnectionDid(agent.context, context.senderDid)
    if (!record?.counterpartyRelationshipDid || proposed?.relationshipDid !== record.counterpartyRelationshipDid) {
      const error = rejectWith(document as never, utils.uuid(), {
        code: extendedCode(propose.TYPE_URI, 'relationshipMismatch'),
        message: 'An upgrade must name the relationship already exchanged on this connection',
        retryable: false,
      })
      await service.retain(agent.context, error as never, 'error', context.connectionId)
      await sendTrustTaskDocument(agent, context.connectionId, error as unknown as Record<string, unknown>)
      agent.config.logger.warn(
        `${LOG_PREFIX} upgrade propose refused: not this connection's relationship (exchange ${exchangeId})`
      )
      return
    }
  }

  // Mark the propose as asked, so a restart can ask again: the retained
  // propose alone does not say so, since consume() retains rejected ones too.
  // A failed mark costs only the ask after a restart, never this ask.
  try {
    await agent.genericRecords.save({
      content: { exchangeId },
      tags: { recordType: PROPOSE_AWAITING_CONSENT, connectionId: context.connectionId, exchangeId },
    })
  } catch (e) {
    agent.config.logger.warn(`${LOG_PREFIX} could not mark propose as asked: ${(e as Error).message}`)
  }
  const connection = await agent.modules.didcomm.connections.getById(context.connectionId)
  askForConsent(connection.theirLabel, document, context, upgrade)
  agent.config.logger.info(
    `${LOG_PREFIX} propose received — awaiting user consent (exchange ${document.threadId ?? document.id})`
  )
}

/** Surface a propose for the user's consent; the one path a live and a restored prompt share. */
function askForConsent(
  counterpartyLabel: string | undefined,
  document: Record<string, unknown>,
  context: InboundContext,
  upgrade: boolean
): void {
  const witnessed = (document as { payload?: { witnessed?: boolean } }).payload?.witnessed === true
  pendingProposals.set(context.connectionId, { document, context })
  vrcFlowStore.setProposalPrompt({
    connectionId: context.connectionId,
    exchangeId: String(document.threadId ?? document.id),
    counterpartyLabel: counterpartyLabel ?? 'Unknown Contact',
    ...(upgrade ? { upgrade: witnessed ? ('witness' as const) : ('resign' as const) } : {}),
  })
}

/** A propose this phone surfaced for consent (genericRecords recordType). */
const PROPOSE_AWAITING_CONSENT = 'keyring.vrc-propose-awaiting-consent'

/**
 * Forget a connection's asked proposes once its pending prompt is resolved:
 * every marker up to and including the answered exchange's. By connection,
 * not by exchange, since the restore reads only the newest marker per
 * connection: deleting just the answered one would let an older, superseded
 * propose become the newest and be asked again. The answered exchange's own
 * markers go, and every marker made strictly before it; any other (a propose
 * that arrived while the answer was being sent) is kept. Best effort: a marker left behind is skipped at restore as answered.
 */
async function forgetAskedProposes(agent: Agent, connectionId: string, answeredExchangeId: string): Promise<void> {
  try {
    const markers = await agent.genericRecords.findAllByQuery({ recordType: PROPOSE_AWAITING_CONSENT, connectionId })
    // The cutoff is the answered exchange's LATEST mark: the last ask the
    // person saw. Every propose marked before it was replaced on screen by
    // that ask, so is superseded; only one marked after it was never replaced.
    const answeredAt = markers
      .filter((m) => m.getTag('exchangeId') === answeredExchangeId)
      .reduce((latest, m) => Math.max(latest, new Date(m.createdAt).getTime()), Number.NEGATIVE_INFINITY)
    for (const marker of markers) {
      // With no marker of its own (its save failed), the answered propose was
      // the newest asked, so every marker on the connection is older.
      const older = !Number.isFinite(answeredAt) || new Date(marker.createdAt).getTime() < answeredAt
      if (older || marker.getTag('exchangeId') === answeredExchangeId) await agent.genericRecords.delete(marker)
    }
  } catch (e) {
    agent.config.logger.warn(
      `${LOG_PREFIX} could not forget asked proposes on ${connectionId}: ${(e as Error).message}`
    )
  }
}

/**
 * Ask again, after a restart, for consent to proposes that were asked and
 * never answered. The prompt lived only in memory, and the proposer does not
 * resend, so a phone killed before its user answered lost the request for
 * good (only the proposer side resumed).
 *
 * Per connection, only the newest propose asked counts, as live: a newer
 * propose replaces an older pending one. It is asked again only when nothing
 * answered it: no response retained on its exchange (an accept), no
 * trust-task-error (a decline or a refusal), and no answer pending in this
 * process. Proposes asked before this marker existed are not restored.
 */
export async function restorePendingProposals(agent: Agent): Promise<number> {
  const markers = await agent.genericRecords.findAllByQuery({ recordType: PROPOSE_AWAITING_CONSENT })
  const newest = new Map<string, { exchangeId: string; at: number }>()
  for (const marker of markers) {
    const connectionId = marker.getTag('connectionId') as string | undefined
    const exchangeId = marker.getTag('exchangeId') as string | undefined
    if (!connectionId || !exchangeId) continue
    const at = new Date(marker.createdAt).getTime()
    const current = newest.get(connectionId)
    if (!current || at > current.at) newest.set(connectionId, { exchangeId, at })
  }

  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  let restored = 0
  for (const [connectionId, { exchangeId }] of newest) {
    try {
      if (pendingProposals.has(connectionId)) continue
      const connection = await agent.modules.didcomm.connections.findById(connectionId)
      if (!connection?.did || !connection.theirDid) continue
      const docs = await proposeThreadDocs(agent, connectionId)
      const document = docs.find(
        (r) =>
          r.document.type === propose.TYPE_URI &&
          r.document.issuer === connection.theirDid &&
          threadOf(r) === exchangeId
      )?.document
      if (!document) continue
      const onExchange = (await documentRepository.findByQuery(agent.context, { exchangeId, connectionId })) as {
        document: Record<string, unknown>
      }[]
      const answered =
        docs.some((d) => threadOf(d) === exchangeId && String(d.document.type ?? '').endsWith('#response')) ||
        onExchange.some((d) => String(d.document.type ?? '').includes('trust-task-error'))
      if (answered) {
        // Resolved already: clear the backlog, including marks left before
        // answers forgot them.
        await forgetAskedProposes(agent, connectionId, exchangeId)
        continue
      }

      const upgrade = await isUpgradeExchange(agent, connectionId, exchangeId)
      askForConsent(
        connection.theirLabel,
        document,
        { connectionId, senderDid: connection.theirDid, recipientDid: connection.did },
        upgrade
      )
      restored += 1
      agent.config.logger.info(`${LOG_PREFIX} propose asked again after restart (exchange ${exchangeId})`)
    } catch (e) {
      agent.config.logger.warn(
        `${LOG_PREFIX} could not restore a pending propose on ${connectionId}: ${(e as Error).message}`
      )
    }
  }
  return restored
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
    await forgetAskedProposes(agent, connectionId, exchangeId)
    await sendTrustTaskDocument(agent, connectionId, error as unknown as Record<string, unknown>)
    vrcFlowStore.clearFlow(connectionId, 'declined')
    logger.info(`${LOG_PREFIX} propose declined by user (exchange ${exchangeId})`)
    return
  }

  vrcFlowStore.setDialect(connectionId, 'trust-tasks')
  // Said the moment the person accepts, before anything is awaited: the sheet
  // closed at once and nothing showed until about six awaits later, two of
  // them on the network (UI-smoothness plan, Phase 4). Every way on from here
  // that does not deliver ends the flow, so it never stays "preparing".
  vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
  try {
    await acceptRelationshipProposal(agent, connectionId, exchangeId, document, context)
  } catch (e) {
    vrcFlowStore.clearFlow(connectionId, 'error')
    throw e
  }
}

async function acceptRelationshipProposal(
  agent: Agent,
  connectionId: string,
  exchangeId: string,
  document: PendingProposal['document'],
  context: PendingProposal['context']
): Promise<void> {
  const logger = agent.config.logger
  const service = getTrustTasksService(agent)
  const payload = (document as { payload: { relationshipDid: string; witnessed?: boolean } }).payload
  // An upgrade's DID was checked equal to the stored one when it arrived.
  const upgrade = await isUpgradeExchange(agent, connectionId, exchangeId)
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  if (!upgrade) {
    await repository.updateCounterpartyRelationshipDid(
      agent.context,
      context.senderDid,
      payload.relationshipDid,
      TRUST_TASKS_MIN_RCE_VERSION
    )
  }
  const myRelationshipDid = await getOrCreateRelationshipDid(agent, context.senderDid, connectionId)
  const response = respondWith(
    document as never,
    utils.uuid(),
    {
      accept: true,
      relationshipDid: myRelationshipDid,
      witnessed: payload.witnessed === true,
    },
    () => new Date().toISOString()
  )
  await service.retain(agent.context, response as never, 'response', connectionId)
  await forgetAskedProposes(agent, connectionId, exchangeId)
  await sendTrustTaskDocument(agent, connectionId, response as unknown as Record<string, unknown>)
  logger.info(`${LOG_PREFIX} propose accepted; response sent (exchange ${exchangeId})`)

  // Symmetric discovery: the responder queries too, so it holds the
  // proposer's supportedTypes by the time its witness-share gate runs.
  void sendDiscoveryQuery(agent, connectionId).catch((e: Error) =>
    logger.warn(`${LOG_PREFIX} responder discovery query failed: ${e.message}`)
  )

  // Fire and forget for the same reason as the proposer side: the delivery
  // may run the witness ceremony, and blocking the caller (the consent modal)
  // for its duration serves nobody.
  void deliverVrcViaTrustTaskForExchange(agent, connectionId, exchangeId).then(
    (outcome) => {
      // Only while it still says what this acceptance set: a delivery that could
      // not start leaves nothing preparing; one already issued is this side's
      // part done, as a delivery leaves it. Not a duplicate: the run already
      // under way owns the status.
      if (vrcFlowStore.getStatus(connectionId) !== 'preparing-offer') return
      if (outcome === 'skipped') vrcFlowStore.clearFlow(connectionId, 'error')
      else if (outcome === 'already-issued') vrcFlowStore.setStatus(connectionId, 'offer-sent', false)
    },
    (e: Error) => {
      logger.error(`${LOG_PREFIX} VRC delivery after acceptance failed: ${e.message}`)
      // It used to stay "preparing" until the overlay's hard timeout.
      vrcFlowStore.clearFlow(connectionId, 'error')
    }
  )
  // The R-Card (still on the legacy leg) rides this acceptance as its trigger
  // too — the basic-message announcement it used to depend on can be lost.
  // Not on an upgrade: the profile was shared already, and is not re-sent.
  if (!upgrade) {
    void issueRCardForAcceptedExchange(agent, connectionId).catch((e: Error) =>
      logger.warn(`${LOG_PREFIX} R-Card issuance after acceptance failed: ${e.message}`)
    )
  }
}

/**
 * Deliver this side's VRC on an accepted exchange thread: build the
 * credential (with hardware-attestation evidence where available), sign it
 * standalone (DataIntegrityProof via the registered suite), wrap it in a
 * proof-bearing `vrc/relationships/issue` document, and send. Idempotent per
 * direction. This is the authority-flip delivery path — for v4 pairs the
 * legacy issue-credential leg no longer carries the VRC.
 */
// In-flight delivery guard. Delivery fires from two triggers (the acceptance
// path and the propose#response handler) and a REDELIVERED message can
// re-fire either — observed live on devices (2026-08-25) as a second
// biometric prompt, a duplicate witness session, and a third VWC. The
// persisted prior-issue check inside only protects AFTER the issue document
// is retained; the whole delivery (signing + ceremony) runs ~20s+ before
// that, and this set closes that window. Claimed synchronously before the
// first await; released on failure so a genuine retry stays possible, and on
// success, when the retained issue document answers every later trigger
// ("already issued"). Kept after success, a later trigger read as a duplicate
// of a run under way, and an acceptance after it was left saying "preparing".
const inFlightVrcDeliveries = new Set<string>()

/**
 * How a delivery ended: it ran (`delivered`); this side's credential had been
 * issued on the exchange already (`already-issued`); it could not start
 * (`skipped`); or another run of it was under way (`duplicate`). "Already
 * issued" is not "could not start": one is done, the other failed.
 */
export type VrcDeliveryOutcome = 'delivered' | 'already-issued' | 'skipped' | 'duplicate'

export async function deliverVrcViaTrustTaskForExchange(
  agent: Agent,
  connectionId: string,
  exchangeId: string
): Promise<VrcDeliveryOutcome> {
  const deliveryKey = `${connectionId}:${exchangeId}`
  if (inFlightVrcDeliveries.has(deliveryKey)) {
    agent.config.logger.info(
      `${LOG_PREFIX} VRC delivery already in flight for exchange ${exchangeId} — duplicate trigger ignored`
    )
    return 'duplicate'
  }
  inFlightVrcDeliveries.add(deliveryKey)
  try {
    const outcome = await deliverVrcViaTrustTaskForExchangeInner(agent, connectionId, exchangeId)
    inFlightVrcDeliveries.delete(deliveryKey)
    return outcome
  } catch (e) {
    inFlightVrcDeliveries.delete(deliveryKey)
    throw e
  }
}

async function deliverVrcViaTrustTaskForExchangeInner(
  agent: Agent,
  connectionId: string,
  exchangeId: string
): Promise<'delivered' | 'already-issued' | 'skipped'> {
  const logger = agent.config.logger
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'skipped'

  const service = getTrustTasksService(agent)
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const priorIssues = await documentRepository.findByQuery(agent.context, {
    typeUri: issue.TYPE_URI,
    connectionId,
    role: 'request',
  })
  if (priorForExchange(priorIssues as never, connection.did, exchangeId)) return 'already-issued'

  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, connection.theirDid)
  if (!record?.myRelationshipDid || !record.counterpartyRelationshipDid) {
    logger.warn(`${LOG_PREFIX} VRC delivery skipped — relationship DIDs incomplete for ${connectionId}`)
    return 'skipped'
  }

  vrcFlowStore.setDialect(connectionId, 'trust-tasks')
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
  if (exchangeWitnessed && witnessConnectionId && (await isWitnessingPreferred())) {
    vrcFlowStore.setStatus(connectionId, 'witness-active', true)
    try {
      const witnessOutcome = await runWitnessSession(agent, {
        witnessConnectionId,
        exchangeId,
        parties: [record.myRelationshipDid, record.counterpartyRelationshipDid],
        myRelationshipDid: record.myRelationshipDid,
        buildPresentation: (challenge, domain) =>
          buildChallengeBoundVp(agent, signedVc, verificationMethodId, challenge, domain),
        // VSC migration plan §6 V3, D6: the VRC this session witnesses, so
        // the returned VWC's subject binding is checked against a specific,
        // identified edge rather than left as an opaque hash.
        referencedVrc: signedVc,
        sendDocument: sendTrustTaskDocument,
        retain: (doc, role) => service.retain(agent.context, doc, role, witnessConnectionId),
        // locality-plan.md §8.1/§10.3 item 10: offer per the user's own
        // setting. `createDeviceLocalityProvider` resolves to the real BLE
        // peripheral on Android and iOS when the native module is linked
        // (item 9, verified live end to end on Android 2026-08-21 and iOS
        // 2026-09-13) and falls back to `NullDeviceLocalityProvider`
        // everywhere else (another platform, or a build without the module)
        // — the ext protocol and cross-check still run for real in that
        // case; they just never receive a transcript.
        localityOffered: await isLocalityConfirmationPreferred(),
        deviceLocalityProvider: createDeviceLocalityProvider(agent),
      })
      logger.info(`${LOG_PREFIX} witness session complete — VWC bound and stored (exchange ${exchangeId})`)

      // Assemble the presentation bundle (step 5's assembly), self-verify it,
      // and — on a passing verdict — SHARE it with the counterparty (step 7):
      // the peer verifies the same bundle before treating this side's
      // witnessing as real. The VP binds to {challenge: exchange id, domain:
      // vrc:witness-share}; a failed self-check withholds the share rather
      // than shipping a bundle the peer would refuse.
      try {
        // Inline require: a static import would cycle (outcomeEvidence imports
        // getTrustTasksService from here) and a dynamic import() makes Metro
        // split the bundle — the "Could not load bundle" failure mode.
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const { assembleVwcPresentation, verifyVwcPresentationBundle } =
          require('./outcomeEvidence') as typeof import('./outcomeEvidence')
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const bundle = await assembleVwcPresentation(agent, {
          vwc: witnessOutcome.vwc,
          verificationMethodId,
          challenge: exchangeId,
          domain: witnessShare.WITNESS_SHARE_DOMAIN,
        })
        const verdict = await verifyVwcPresentationBundle(agent, {
          bundle,
          challenge: exchangeId,
          domain: witnessShare.WITNESS_SHARE_DOMAIN,
        })
        if (verdict.completionEvidenced) {
          logger.info(`${LOG_PREFIX} outcome evidence assembled and verified (session ${witnessOutcome.sessionId})`)
          vrcFlowStore.setStatus(connectionId, 'sharing-witness-record', true)
          await sendWitnessShareForExchange(agent, connectionId, exchangeId, record.myRelationshipDid, bundle)
        } else {
          logger.warn(
            `${LOG_PREFIX} outcome-evidence self-check failed — witness-share withheld: ${verdict.failures.join('; ')}`
          )
        }
      } catch (e) {
        logger.warn(`${LOG_PREFIX} outcome-evidence self-check errored: ${(e as Error).message}`)
      }
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
  // Diagnostic only (e2e checker): the VRC this party just issued, as sent.
  logIssuedVrcJson('ISSUER', exchangeId, '-', signedVc)
  vrcFlowStore.setStatus(connectionId, 'offer-sent', false)
  logger.info(`${LOG_PREFIX} issue sent (exchange ${exchangeId}) on connection ${connectionId}`)
  return 'delivered'
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
      const vcIssuer =
        typeof vc.issuer === 'object' && vc.issuer !== null ? (vc.issuer as { id?: string }).id : vc.issuer
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
        const storedRecord = new W3cCredentialRecord({
          credentialInstances: [{ credential: vc as never }],
        })
        await agent.w3cCredentials.store({ record: storedRecord })
        // Diagnostic only (e2e checker): the VRC this party received and stored.
        logIssuedVrcJson('RECEIVER', String(doc.threadId ?? doc.id), storedRecord.id, vc)
        agent.config.logger.info(`${LOG_PREFIX} issue stored — VRC in wallet (exchange ${doc.threadId ?? doc.id})`)
      } else {
        agent.config.logger.info(`${LOG_PREFIX} issue already stored — receipting (exchange ${doc.threadId ?? doc.id})`)
      }
      // Their credential landed. If our own delivery is still running, only
      // RECORD it — setting 'offer-received' here would hide the progress
      // dialog mid-ceremony and the next step would pop it back up.
      if (vrcFlowStore.hasSentOfferFlag(context.connectionId)) {
        vrcFlowStore.setStatus(context.connectionId, 'offer-received', false)
      } else {
        vrcFlowStore.markOfferReceived(context.connectionId)
      }

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
    logger.info(
      `${LOG_PREFIX} issue receipt matched — VRC delivery acknowledged (exchange ${document.threadId ?? document.id})`
    )
  } else {
    logger.warn(
      `${LOG_PREFIX} issue receipt digest matches no delivery of ours (exchange ${document.threadId ?? document.id}) — not acknowledged`
    )
  }
}

/**
 * Send the counterparty our witness-share (subtask §9 step 7): the assembled
 * presentation bundle, on the exchange thread, proof REQUIRED under our
 * relationship DID. Gated on the peer advertising the type — with a bounded
 * wait for its discovery answer, which (responder side) was queried only at
 * acceptance and may still be in flight when the ceremony completes.
 * Idempotent per direction.
 */
async function sendWitnessShareForExchange(
  agent: Agent,
  connectionId: string,
  exchangeId: string,
  myRelationshipDid: string,
  bundle: VwcPresentationBundle
): Promise<void> {
  const logger = agent.config.logger
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return

  // The peer's discovery answer can arrive well after our own witness leg
  // completes: with a fast radio leg (iPhone against the noble witness,
  // 2026-09-13, attempt 22) the VWC was stored 30 s before the peer had even
  // answered discovery, and a 30 s wait here missed the answer by a second —
  // the share was skipped, and the peer's contact never showed the witness
  // record. Wait up to 2 minutes; the answer is sent the moment the peer
  // processes our query, so this is bounded by the peer's own pace.
  // Follow-up: re-trigger the share from the discovery-answer consumer so
  // the outcome does not depend on a wait at all.
  let supports = await peerSupportsTaskType(agent, connectionId, witnessShare.TYPE_URI)
  for (let attempt = 0; supports === null && attempt < 24; attempt++) {
    if (attempt === 0)
      logger.info(`${LOG_PREFIX} witness-share waiting for the peer's discovery answer (exchange ${exchangeId})`)
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    supports = await peerSupportsTaskType(agent, connectionId, witnessShare.TYPE_URI)
  }
  if (supports !== true) {
    logger.info(
      `${LOG_PREFIX} witness-share skipped — peer ${supports === null ? 'discovery answer never arrived' : 'does not advertise the type'} (exchange ${exchangeId})`
    )
    return
  }

  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const prior = await documentRepository.findByQuery(agent.context, {
    typeUri: witnessShare.TYPE_URI,
    connectionId,
    role: 'request',
  })
  if (priorForExchange(prior as never, connection.did, exchangeId)) return

  const service = getTrustTasksService(agent)
  const document: Record<string, unknown> = {
    id: utils.uuid(),
    type: witnessShare.TYPE_URI,
    threadId: exchangeId,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { presentation: bundle.presentation, outcomeEvidence: bundle.outcomeEvidence },
  }
  const signed = await signDocumentProof(agent, document, myRelationshipDid)
  await service.retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  logger.info(`${LOG_PREFIX} witness-share sent (exchange ${exchangeId})`)
}

/**
 * The counterparty's witness-share: run the FULL pairing algorithm before
 * anything is stored — the Witnessed indicator is earned by verification,
 * never granted on receipt. Any failure refuses with a trust-task-error and
 * stores nothing.
 */
async function handleInboundWitnessShare(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: witnessShare.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // Same expected-controller policy as the issue leg: the document proof
    // must verify under the sender's relationship DID as accepted.
    proofPolicy: await issueProofPolicy(agent, context.senderDid),
    handler: async (doc) => {
      const payload = (
        doc as {
          payload: {
            presentation?: Record<string, unknown>
            outcomeEvidence?: { initiating?: Record<string, unknown>; terminal?: Record<string, unknown> }
          }
        }
      ).payload
      const notAccepted = (message: string) =>
        rejectWith(doc as never, utils.uuid(), {
          code: extendedCode(witnessShare.TYPE_URI, 'notAccepted'),
          message,
          retryable: false,
        })
      if (!payload.presentation || !payload.outcomeEvidence?.initiating || !payload.outcomeEvidence.terminal) {
        return notAccepted('payload is not a presentation bundle')
      }

      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      const record = await repository.findByConnectionDid(agent.context, context.senderDid)
      if (!record?.myRelationshipDid || !record.counterpartyRelationshipDid) {
        return notAccepted('no accepted relationship exchange with this sender')
      }

      // The Outcome Interpretability pairing over the whole bundle: VP under
      // {challenge: exchange id, domain}, credential valid, evidence pairs.
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { verifyVwcPresentationBundle } = require('./outcomeEvidence') as typeof import('./outcomeEvidence')
      const expectedChallenge = String(doc.threadId ?? doc.id)
      const verdict = await verifyVwcPresentationBundle(agent, {
        bundle: {
          presentation: payload.presentation,
          outcomeEvidence: {
            initiating: payload.outcomeEvidence.initiating,
            terminal: payload.outcomeEvidence.terminal,
          },
        },
        challenge: expectedChallenge,
        domain: witnessShare.WITNESS_SHARE_DOMAIN,
      })
      if (!verdict.credentialValid || !verdict.completionEvidenced) {
        return notAccepted(`bundle failed verification: ${verdict.failures.join('; ') || 'credential proof invalid'}`)
      }

      // Party bindings: the shared VWC must be ABOUT the sender (its subject
      // is the sender's relationship DID — the value the contact keys on)
      // and about THIS exchange (parties name both relationship DIDs). A
      // witnessed/1 VWC (DTG Credentials v1) carries no `parties`: they are in
      // the witness/session document it cites, which is this bundle's
      // initiating evidence — already proven above to be that document
      // (its id is the VWC's taskContext and its task digest reproduces).
      const vwc = (payload.presentation as { verifiableCredential?: Record<string, unknown>[] })
        .verifiableCredential?.[0]
      if (!vwc) return notAccepted('presentation carries no credential')
      const subject = Array.isArray(vwc.credentialSubject) ? vwc.credentialSubject[0] : vwc.credentialSubject
      const subjectId = (subject as { id?: string } | undefined)?.id
      if (subjectId !== record.counterpartyRelationshipDid) {
        return notAccepted('VWC subject is not the sender relationship DID')
      }
      const sessionParties = (payload.outcomeEvidence.initiating as { payload?: { parties?: unknown } }).payload
        ?.parties
      const parties = ((subject as { parties?: string[] } | undefined)?.parties ??
        (Array.isArray(sessionParties) ? sessionParties : [])) as string[]
      if (!parties.includes(record.myRelationshipDid) || !parties.includes(record.counterpartyRelationshipDid)) {
        return notAccepted('VWC parties do not name this exchange relationship DIDs')
      }

      const sharedDigest = digestMultibase(vwc)
      const existing = await agent.w3cCredentials.getAll()
      const alreadyStored = existing.some((r) => {
        try {
          return digestMultibase(JsonTransformer.toJSON(r.firstCredential)) === sharedDigest
        } catch {
          return false
        }
      })
      if (!alreadyStored) {
        // Verified above (the share is checked against the digest the peer
        // committed to), so it is marked: only marked records earn the witness
        // and locality marks in the UI (WITNESS_VERIFIED_TAG).
        const sharedRecord = new W3cCredentialRecord({ credentialInstances: [{ credential: vwc as never }] })
        sharedRecord.setTags({ [WITNESS_VERIFIED_TAG]: 'true' } as never)
        await agent.w3cCredentials.store({ record: sharedRecord })
      }
      logger.info(`${LOG_PREFIX} witness-share verified and stored (exchange ${doc.threadId ?? doc.id})`)
      return respondWith(doc as never, utils.uuid(), { vwcDigestMultibase: sharedDigest }, () =>
        new Date().toISOString()
      )
    },
  })

  if (outcome.kind === 'handled' && outcome.response) {
    await sendTrustTaskDocument(agent, context.connectionId, outcome.response as Record<string, unknown>)
    logger.info(`${LOG_PREFIX} witness-share receipt sent (exchange ${document.threadId ?? document.id})`)
  } else if (outcome.kind === 'rejected') {
    const error = (outcome as { error?: Record<string, unknown> }).error
    if (error) await sendTrustTaskDocument(agent, context.connectionId, error)
    logger.warn(
      `${LOG_PREFIX} witness-share refused (exchange ${document.threadId ?? document.id}): ${JSON.stringify((error as { payload?: unknown } | undefined)?.payload)}`
    )
  }
}

/**
 * The counterparty's receipt for OUR witness-share: correlate its digest
 * against the bundle we sent, mirroring the issue-receipt idiom.
 */
async function handleInboundWitnessShareReceipt(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: witnessShare.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: await issueProofPolicy(agent, context.senderDid),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') {
    logger.warn(
      `${LOG_PREFIX} witness-share receipt not consumed (${outcome.kind}): ${JSON.stringify((outcome as { error?: { payload?: unknown } }).error?.payload ?? null)}`
    )
    return
  }

  const receiptDigest = (document as { payload?: { vwcDigestMultibase?: string } }).payload?.vwcDigestMultibase
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const requests = await documentRepository.findByQuery(agent.context, {
    typeUri: witnessShare.TYPE_URI,
    connectionId: context.connectionId,
    role: 'request',
  })
  const mine = requests.find((r) => r.document.issuer === context.recipientDid)
  const sharedVwc = ((
    mine?.document as { payload?: { presentation?: { verifiableCredential?: Record<string, unknown>[] } } } | undefined
  )?.payload?.presentation?.verifiableCredential ?? [])[0]
  const myDigest = sharedVwc ? digestMultibase(sharedVwc) : undefined
  if (receiptDigest && myDigest && receiptDigest === myDigest) {
    logger.info(`${LOG_PREFIX} witness-share receipt matched (exchange ${document.threadId ?? document.id})`)
  } else {
    logger.warn(
      `${LOG_PREFIX} witness-share receipt digest matches no share of ours (exchange ${document.threadId ?? document.id})`
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
  let upgrade = false
  let mismatch = false
  let cancelled = false
  const outcome = await service.consume(agent.context, {
    spec: propose.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => {
      const payload = (doc as { payload: { relationshipDid: string; accept: boolean } }).payload
      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      const exchangeId = String((doc as { threadId?: string }).threadId ?? (doc as { id?: string }).id)
      if (await isUpgradeExchange(agent, context.connectionId, exchangeId)) {
        upgrade = true
        // The acceptance of an upgrade names the relationship DID already
        // stored, or it is not acted on; a withdrawn upgrade is not either.
        const record = await repository.findByConnectionDid(agent.context, context.senderDid)
        if (!record?.counterpartyRelationshipDid || payload.relationshipDid !== record.counterpartyRelationshipDid) {
          mismatch = true
        } else if (await isUpgradeCancelled(agent, context.connectionId, exchangeId)) {
          cancelled = true
        }
        return doc
      }
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
    // Either way nothing is waiting any more: no state lingers as 'proposed'.
    if (mismatch || cancelled) vrcFlowStore.clearFlow(context.connectionId, mismatch ? 'error' : 'cancelled')
    if (mismatch) {
      agent.config.logger.warn(
        `${LOG_PREFIX} upgrade acceptance refused: not this connection's relationship (exchange ${document.threadId ?? document.id})`
      )
      return
    }
    if (cancelled) {
      agent.config.logger.info(
        `${LOG_PREFIX} upgrade acceptance after it was withdrawn: no card (exchange ${document.threadId ?? document.id})`
      )
      return
    }
    agent.config.logger.info(
      `${LOG_PREFIX} propose#response consumed; relationship established (exchange ${document.threadId ?? document.id})`
    )
    // Proposer side of the authority flip: the exchange is accepted, deliver
    // our VRC on its thread. FIRE AND FORGET — this handler runs inside
    // credo's inbound message processing, and the delivery may await the
    // witness ceremony, whose responses arrive through that same processing:
    // awaiting here deadlocks the ceremony against its own transport (the
    // challenge sits queued behind this very handler until timeout).
    void deliverVrcViaTrustTaskForExchange(agent, context.connectionId, String(document.threadId ?? document.id)).catch(
      (e: Error) => agent.config.logger.error(`${LOG_PREFIX} VRC delivery after acceptance failed: ${e.message}`)
    )
    // And the R-Card, on the legacy leg, with the acceptance as its trigger.
    // Not on an upgrade: the profile was shared already.
    if (!upgrade) {
      void issueRCardForAcceptedExchange(agent, context.connectionId).catch((e: Error) =>
        agent.config.logger.warn(`${LOG_PREFIX} R-Card issuance after acceptance failed: ${e.message}`)
      )
    }
  }
}

/**
 * Register the built-in VRC/witness/discovery types into the same open
 * registry a demo profile registers into (R5). This is what proves the
 * registry is real dispatch rather than a decoration sitting beside the old
 * if/else: these five entries ARE the dispatch for the exchange this whole
 * file implements, looked up by `setupTrustTasksInbound`'s
 * `handleInboundDocument` exactly like any later registration would be.
 *
 * Guarded against a duplicate call (`register` throws on one) rather than
 * relying on "this file is only ever imported once" — a defensive no-op,
 * since re-registering the same handlers is harmless if it ever happened.
 */
function registerBuiltinTrustTasks(): void {
  if (trustTaskRegistry.get(propose.TYPE_URI)) return

  trustTaskRegistry.register({
    typeUri: propose.TYPE_URI,
    spec: propose.SPEC as never,
    responseSpec: propose.RESPONSE_SPEC as never,
    orchestration: {
      isDeterministicProposer,
      minRceVersion: TRUST_TASKS_MIN_RCE_VERSION,
    },
    handleRequest: handleInboundPropose,
    handleResponse: handleInboundProposeResponse,
  })

  trustTaskRegistry.register({
    typeUri: discovery.TYPE_URI,
    spec: discovery.SPEC as never,
    responseSpec: discovery.RESPONSE_SPEC as never,
    orchestration: {
      minRceVersion: TRUST_TASKS_MIN_RCE_VERSION,
      // Discovery answers the "does the peer support X" question itself —
      // it would be circular for discovery to require discovery first.
      requiresDiscovery: false,
    },
    handleRequest: handleInboundDiscovery,
    handleResponse: handleInboundDiscoveryResponse,
  })

  trustTaskRegistry.register({
    typeUri: issue.TYPE_URI,
    spec: issue.SPEC as never,
    responseSpec: issue.RESPONSE_SPEC as never,
    orchestration: { minRceVersion: TRUST_TASKS_MIN_RCE_VERSION },
    handleRequest: handleInboundIssue,
    handleResponse: handleInboundIssueReceipt,
  })

  trustTaskRegistry.register({
    typeUri: witnessShare.TYPE_URI,
    spec: witnessShare.SPEC as never,
    responseSpec: witnessShare.RESPONSE_SPEC as never,
    orchestration: { minRceVersion: TRUST_TASKS_MIN_RCE_VERSION },
    handleRequest: handleInboundWitnessShare,
    handleResponse: handleInboundWitnessShareReceipt,
  })

  // Keyring's own type (private authority): one phone asks the other to confirm two relationships are one person.
  trustTaskRegistry.register({
    typeUri: continuitySpec.TYPE_URI,
    spec: continuitySpec.SPEC as never,
    responseSpec: continuitySpec.RESPONSE_SPEC as never,
    orchestration: { requiresDiscovery: false },
    handleRequest: handleContinuityRequest,
    handleResponse: handleContinuityResponse,
  })
}

registerBuiltinTrustTasks()

/**
 * Pending credential-exchange queries awaiting the user's consent, keyed by
 * the QUERY DOCUMENT's own id (not connectionId — unlike a relationship
 * proposal, a wallet can plausibly hold open queries from more than one
 * verifier connection at once).
 */
const pendingCredentialExchangeQueries = new Map<
  string,
  { document: Record<string, unknown>; context: InboundContext }
>()

/**
 * Verifier asks to see a credential (`credential-exchange/query`): validate
 * through the pipeline, check whether the wallet actually holds something
 * satisfying the DCQL query, and — only if it does — surface it for USER
 * CONSENT. No `#response`/error variant exists for this spec (see the
 * payload's own doc comment): an unsatisfiable query or a declined prompt
 * both simply produce no `credential-exchange/present` reply.
 */
async function handleInboundCredentialExchangeQuery(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: credentialExchangeQuery.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // Defer the answer to the user: a handler returning nothing is an
    // 'accepted' outcome with no reply on the wire (mirrors handleInboundPropose).
    handler: async () => undefined,
  })

  if (outcome.kind === 'rejected') {
    logger.warn(
      `${LOG_PREFIX} credential-exchange query rejected: ${JSON.stringify((outcome as { error?: { payload?: unknown } }).error?.payload)}`
    )
    return
  }

  const payload = (document as { payload: credentialExchangeQuery.CredentialExchangeQueryPayload }).payload
  let match: Awaited<ReturnType<typeof matchDcqlQuery>>
  try {
    match = await matchDcqlQuery(agent, payload.dcql_query as never)
  } catch (e) {
    // A DCQL-matching failure should never look like a silent, opaque
    // Credo-level "Error handling message" with no explanation — log it
    // clearly through this module's own conventions instead.
    logger.error(`${LOG_PREFIX} credential-exchange query matching failed: ${(e as Error).message}`)
    return
  }
  if (!match) {
    logger.info(
      `${LOG_PREFIX} credential-exchange query has no satisfying credential — no prompt shown (query ${document.id})`
    )
    return
  }

  const connection = await agent.modules.didcomm.connections.getById(context.connectionId)
  const queryId = String(document.id)
  pendingCredentialExchangeQueries.set(queryId, { document, context })
  credentialExchangeStore.setQueryPrompt({
    queryId,
    connectionId: context.connectionId,
    verifierLabel: connection.theirLabel ?? 'Unknown Verifier',
    purpose: payload.purpose,
  })
  logger.info(`${LOG_PREFIX} credential-exchange query received — awaiting user consent (query ${document.id})`)
}

/**
 * The wallet's own credential matching a DCQL query, if any. Confirms
 * satisfiability via Credo's `DcqlService` (needs only the bare DCQL query
 * object — no OID4VP authorization-request envelope; this Trust Task
 * carries the query verbatim, so none exists), then selects the concrete
 * record directly against `agent.w3cCredentials` rather than through
 * Credo's `openid4vc` module's holder-selection helper: that module is not
 * reliably registered on `agent.modules` in this app's agent configuration
 * (confirmed empirically — `agent.modules.openid4vc` is `undefined` at
 * runtime despite being passed into the agent's module config), and this
 * flow has no other reason to depend on it — it exists for the OID4VP
 * request/response pipeline this exchange deliberately doesn't use (see
 * `respondToCredentialExchangeQuery`'s own doc comment). Our happy path
 * assumes at most one relevant credential, so the first `ldp_vc` record
 * whose `expandedTypes` tag is a superset of one of the query's
 * `type_values` entries (DCQL's own match rule — order-independent, extra
 * types allowed) is the match.
 */
async function matchDcqlQuery(
  agent: Agent,
  dcqlQuery: unknown
): Promise<{ credentialJson: Record<string, unknown> } | undefined> {
  const dcqlService = agent.dependencyManager.container.resolve(DcqlService)
  const queryResult = await dcqlService.getCredentialsForRequest(agent.context, dcqlQuery as never)
  if (!queryResult.can_be_satisfied) return undefined

  const typeValueSets = (
    (dcqlQuery as { credentials?: { format?: string; meta?: { type_values?: string[][] } }[] }).credentials ?? []
  )
    .filter((c) => c.format === 'ldp_vc')
    .flatMap((c) => c.meta?.type_values ?? [])
  if (typeValueSets.length === 0) return undefined

  const allCredentials = await agent.w3cCredentials.getAll()
  for (const record of allCredentials) {
    if (record.firstCredential.claimFormat !== ClaimFormat.LdpVc) continue
    const expandedTypes = (record.getTags() as { expandedTypes?: string[] }).expandedTypes ?? []
    const isMatch = typeValueSets.some((types) => types.every((t) => expandedTypes.includes(t)))
    if (isMatch) {
      return { credentialJson: JsonTransformer.toJSON(record.firstCredential) as Record<string, unknown> }
    }
  }
  return undefined
}

/**
 * The user's answer to a pending credential-exchange query.
 *
 * Share: build a challenge-bound VP wrapping the matched credential (the
 * SAME construction the witness ceremony uses for its own VP — a plain W3C
 * Data-Integrity presentation, not Credo's OID4VP/DCQL presentation
 * pipeline, which this exchange has no need of: the spec's own payload
 * doc says a JSON *object* `vp_token` is exactly "a W3C Data-Integrity VP
 * whose proof carries the same nonce and domain"), then send it as
 * `credential-exchange/present` on the query's own thread. Decline: nothing
 * is sent — there is no error/response variant for this spec.
 */
export async function respondToCredentialExchangeQuery(agent: Agent, queryId: string, accept: boolean): Promise<void> {
  const logger = agent.config.logger
  const pending = pendingCredentialExchangeQueries.get(queryId)
  pendingCredentialExchangeQueries.delete(queryId)
  credentialExchangeStore.clearQueryPrompt(queryId)
  if (!pending) {
    logger.warn(`${LOG_PREFIX} no pending credential-exchange query ${queryId}`)
    return
  }
  const { document, context } = pending

  if (!accept) {
    logger.info(`${LOG_PREFIX} credential-exchange query declined by user (query ${queryId})`)
    return
  }

  const payload = (document as { payload: credentialExchangeQuery.CredentialExchangeQueryPayload }).payload
  const match = await matchDcqlQuery(agent, payload.dcql_query as never)
  if (!match) {
    // Re-checked at answer time: a credential the query matched when the
    // prompt was shown may no longer be available (deleted meanwhile).
    logger.warn(`${LOG_PREFIX} credential-exchange query no longer satisfiable at answer time (query ${queryId})`)
    return
  }

  const connection = await agent.modules.didcomm.connections.getById(context.connectionId)
  if (!connection.did || !connection.theirDid) return

  const didDocument = await agent.dids.resolveDidDocument(connection.did)
  const embeddedId = (entries?: unknown[]) =>
    (entries ?? []).find((entry) => typeof entry === 'object' && entry !== null) as { id: string } | undefined
  const rawVerificationMethodId =
    didDocument.verificationMethod?.[0]?.id ??
    embeddedId(didDocument.assertionMethod)?.id ??
    embeddedId(didDocument.authentication)?.id
  if (!rawVerificationMethodId) throw new Error(`no verification method on ${connection.did}`)
  // did:peer numalgo 4 documents (connection.did here) embed a RELATIVE
  // verification method id (e.g. "#key-1") — unlike the did:peer:0 numalgo 0
  // relationship DIDs this file signs under elsewhere, whose resolved id is
  // already fully qualified. Confirmed live: signing under the bare
  // fragment silently never completed (no error, no signature) rather than
  // throwing, so this needs qualifying before use as a verificationMethod
  // reference.
  const verificationMethodId = rawVerificationMethodId.startsWith('#')
    ? `${connection.did}${rawVerificationMethodId}`
    : rawVerificationMethodId

  const vp = await buildChallengeBoundVp(
    agent,
    match.credentialJson,
    verificationMethodId,
    payload.nonce,
    connection.theirDid
  )

  const service = getTrustTasksService(agent)
  const presentDocument: Record<string, unknown> = {
    id: utils.uuid(),
    type: credentialExchangePresent.TYPE_URI,
    threadId: document.threadId ?? document.id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { vp_token: vp },
  }
  const signed = await signDocumentProof(agent, presentDocument, connection.did)
  await service.retain(agent.context, signed, 'request', context.connectionId)
  await sendTrustTaskDocument(agent, context.connectionId, signed)
  logger.info(`${LOG_PREFIX} credential-exchange present sent (query ${queryId})`)
}
