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
  sendTrustTaskDocument,
  getTrustTasksService,
  isDeterministicProposer,
  TRUST_TASKS_MIN_RCE_VERSION,
} from './ceremony'
