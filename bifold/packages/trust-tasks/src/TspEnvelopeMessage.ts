/**
 * TspEnvelopeMessage — the DIDComm v1 carriage for a real TSP envelope
 * (HPKE-Auth sealed, CESR-framed, Ed25519-signed — this package's own
 * `tsp.pack`/`tsp.unpack`), physically delivered over an EXISTING DIDComm-v1
 * connection exactly like `TrustTaskMessage` — the only difference is the
 * attachment carries opaque base64 envelope bytes instead of an inline JSON
 * document, since the document itself is now encrypted inside the envelope.
 *
 * Deliberately NOT under the `trusttasks.org` binding namespace —
 * `TrustTaskMessage`'s type URI names an actual registered ecosystem binding
 * (0.2); this message type is Keyring-internal, wallet-to-wallet/wallet-to-
 * witness only, and not an ecosystem binding (see the parent repo's
 * docs/plans/openvtc-integration-plan.md §5.4 stage-4 scope correction —
 * this proves the real TSP crypto stack live, it is not an interop claim).
 *
 * Lives here (not in @bifold/core, where it originated) so the witness
 * server — a plain Node process with no React Native dependency — can also
 * speak it, the same reason TrustTaskMessage lives here rather than in core.
 *
 * @module TspEnvelopeMessage
 */

import { TypedArrayEncoder } from '@credo-ts/core'
import { DidCommMessage, DidCommAttachment, DidCommAttachmentData, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'

/** The reserved `~attach` entry id carrying the TSP envelope bytes. */
export const TSP_ENVELOPE_ATTACHMENT_ID = 'tsp-envelope'

/** Keyring-internal message type — not a registered Trust Tasks framework binding. */
export const TSP_ENVELOPE_MESSAGE_TYPE = 'https://github.com/berkmancenter/keyring-bifold/tsp-envelope/0.1/task'

export interface TspEnvelopeMessageOptions {
  id?: string
  /** The packed TSP envelope's raw wire bytes (`tsp.pack`'s `bytes`). */
  envelope: Uint8Array
}

/**
 * A DIDComm v1 message carrying one opaque TSP envelope. No `~thread`
 * decorator — the envelope's own thread digest (`tsp.pack`'s
 * `threadDigest`) is the correlator once unpacked; nothing about the
 * envelope's cleartext (sender/receiver VIDs only) is representable as a
 * DIDComm thread id.
 */
export class TspEnvelopeMessage extends DidCommMessage {
  public constructor(options?: TspEnvelopeMessageOptions) {
    super()
    if (options) {
      this.id = options.id ?? this.generateId()
      this.appendedAttachments = [
        new DidCommAttachment({
          id: TSP_ENVELOPE_ATTACHMENT_ID,
          mimeType: 'application/octet-stream',
          data: new DidCommAttachmentData({ base64: TypedArrayEncoder.toBase64(options.envelope) }),
        }),
      ]
    }
  }

  public static readonly type = parseMessageType(TSP_ENVELOPE_MESSAGE_TYPE)
  public readonly type = TspEnvelopeMessage.type.messageTypeUri

  /** Extract the carried TSP envelope's raw wire bytes. */
  public get envelope(): Uint8Array | undefined {
    const attachment = this.appendedAttachments?.find((a) => a.id === TSP_ENVELOPE_ATTACHMENT_ID)
    const base64 = attachment?.data.base64
    return base64 ? TypedArrayEncoder.fromBase64(base64) : undefined
  }
}

// class-validator wiring without decorator syntax — same one-liner
// TrustTaskMessage uses.
IsValidMessageType(TspEnvelopeMessage.type)(TspEnvelopeMessage.prototype, 'type')
