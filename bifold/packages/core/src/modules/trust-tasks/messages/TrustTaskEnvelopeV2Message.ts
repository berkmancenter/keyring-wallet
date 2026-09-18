/**
 * The binding/didcomm 0.2 (DIDComm v2) carriage message — implementation in
 * @bifold/trust-tasks (shared with the witness-server); re-exported here so
 * the wallet's import paths stay stable, like TrustTaskMessage.
 */
export { TRUST_TASK_V2_BINDING_URI, TRUST_TASK_V2_ENVELOPE_TYPE, TrustTaskEnvelopeV2Message } from '@bifold/trust-tasks'
export type { TrustTaskEnvelopeV2MessageOptions, TrustTaskV2Plaintext } from '@bifold/trust-tasks'
