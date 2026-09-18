/**
 * Trust Tasks module — the wallet's seam onto the Trust Tasks framework
 * (documents, §7.2 consumption, binding-0.2 carriage, outcome-evidence
 * retention). See the reference evidence in `tsp-reference/` (rungs
 * ref-06v1c, ref-06w4, ref-06x) and the plan's Phase D gate.
 *
 * @module trust-tasks
 */

export {
  TrustTaskMessage,
  TRUST_TASK_ATTACHMENT_ID,
  TRUST_TASK_ENVELOPE_TYPE,
  TRUST_TASK_BINDING_URI,
  isTransportRepresentable,
} from './messages/TrustTaskMessage'
export {
  TrustTaskEnvelopeV2Message,
  TRUST_TASK_V2_BINDING_URI,
  TRUST_TASK_V2_ENVELOPE_TYPE,
} from './messages/TrustTaskEnvelopeV2Message'
export { TrustTaskDocumentRecord } from './services/TrustTaskDocumentRecord'
export type { TrustTaskDocumentRole, TrustTaskDocumentRecordTags } from './services/TrustTaskDocumentRecord'
export { TrustTaskDocumentRepository } from './services/TrustTaskDocumentRepository'
export { TrustTasksService, respondWith, refuse, extendedCode } from './services/TrustTasksService'
export type { ConsumeOptions, TrustTaskSpecPolicy } from './services/TrustTasksService'
export { TrustTasksModule } from './module/TrustTasksModule'
export { trustTaskPayloadValidator } from './validator'
export {
  setupTrustTasksInbound,
  maybeOpenRelationshipExchange,
  resumeInterruptedExchanges,
  sendTrustTaskDocument,
  getTrustTasksService,
  isDeterministicProposer,
  setTspCarriageEnabled,
  isTspCarriageEnabled,
  setDidCommV2Enabled,
  isDidCommV2Enabled,
  selectCarriage,
  TRUST_TASKS_MIN_RCE_VERSION,
} from './ceremony'

// R5 — the open type→handler registry and its render/approve-deny scaffold.
// See docs/plans/reference-app-sdk-packaging.md and its 2026-09-01-al.md /
// 2026-09-06-agent.md companions.
export { TrustTaskRegistry, trustTaskRegistry } from './registry'
export type {
  TrustTaskRegistration,
  TrustTaskOrchestration,
  TrustTaskDocumentHandler,
  InboundContext,
} from './registry'
export { registerTrustTask } from './registerTrustTask'
export type { RegisterTrustTaskOptions } from './registerTrustTask'
export { createApprovalRequestHandler, respondToPendingTrustTask } from './genericApproval'
export type { CreateApprovalRequestHandlerOptions } from './genericApproval'
export { trustTaskPromptStore } from './trustTaskPromptStore'
export type { PendingTrustTaskPrompt } from './trustTaskPromptStore'
export { trustTaskDisplayRegistry } from './display/trustTaskDisplayRegistry'
export { registerTrustTaskDisplay } from './display/register'
export { findV2MediationRecord, getRoutingForV2, provisionV2Mediation, startV2MessagePickup } from './v2Routing'
export {
  VtiMediatorSession,
  VtiMediatorOutboundTransport,
  resolveVtiMediator,
  vtiClientIdentityFromPersona,
  vtiClientIdentityFromDid,
  createVtiClientDid,
} from './module/VtiMediatorTransport'
export type { VtiMediatorEndpoints, VtiClientIdentity } from './module/VtiMediatorTransport'
export { vtiAgent, VtiRefusal } from './module/vtiAgent'
export { VtaClient, VTA_TASK, resolveVtaMediator } from './module/VtaClient'
export type { VtaWhoAmI, VtaContext, VtaMintedDid } from './module/VtaClient'
export { GenericRecordsIdentityStore } from './module/VtiIdentityStore'
export type { VtiIdentityStore, VtiManagerIdentity, VtiPersona } from './module/VtiIdentityStore'
export { importVtaKey, decodeMultibaseKey } from './module/vtaKeys'
export type { VtaExportedKey } from './module/vtaKeys'
export type { VtiAgentState, VtiAgentStatus, VtiCriterion, VtiManifest, VtiVerdict } from './module/vtiAgent'
export {
  GenericRecordsCommunityStore,
  type VtiCommunityStore,
  type VtiInvitation,
  type VtiMembership,
} from './module/VtiCommunityStore'
export { isVtiInvitationLink, buildVtiInvitationLink, parseVtiInvitationLink, describeInvitation } from './module/vtiInvitation'
export { joinCommunity, ensurePersonaFor, membershipFromVerdict, type VtiJoinStep, type VtiJoinDeps, type VtiJoinResult } from './module/vtiJoin'

export { vtaAgent, type VtaAgentState, type VtiApproval } from './module/vtaAgent'
export type { VtaConsentRequest } from './module/VtaClient'
export { receiveIssue, classifyCredential, credentialsOfIssue, CREDENTIAL_EXCHANGE_ISSUE, type VtiReceivedCredential, type VtiCredentialKind } from './module/vtiInbox'
export type { VtiHeldCredential } from './module/VtiCommunityStore'
