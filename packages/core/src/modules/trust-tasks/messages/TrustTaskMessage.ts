/**
 * The binding-0.2 DIDComm carriage message — implementation in
 * @bifold/trust-tasks (shared with the witness-server since
 * 2026-08-20); re-exported here so the wallet's import paths stay stable.
 */
export {
  TRUST_TASK_ATTACHMENT_ID,
  TRUST_TASK_BINDING_URI,
  TRUST_TASK_ENVELOPE_TYPE,
  TrustTaskMessage,
  isTransportRepresentable,
} from '@bifold/trust-tasks'
export type { TrustTaskMessageOptions } from '@bifold/trust-tasks'
