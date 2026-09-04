/**
 * The Keyring-internal TSP envelope carriage message — implementation in
 * @bifold/trust-tasks (shared with the witness-server, same reason
 * TrustTaskMessage lives there); re-exported here so this module's own
 * import paths stay stable.
 */
export {
  TSP_ENVELOPE_ATTACHMENT_ID,
  TSP_ENVELOPE_MESSAGE_TYPE,
  TspEnvelopeMessage,
} from '@bifold/trust-tasks'
export type { TspEnvelopeMessageOptions } from '@bifold/trust-tasks'
