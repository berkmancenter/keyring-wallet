/**
 * TrustTaskEnvelopeV2Message — the Trust Tasks framework's **DIDComm v2**
 * binding (`binding/didcomm/0.2`) as a Credo message class.
 *
 * The binding (dtgwg-trust-tasks-tf `bindings/didcomm/0.2/spec.md`):
 *   - message `type` is the framework-reserved envelope type — kept at the
 *     `/0.1/envelope` URI across 0.2 by design (a 0.1 consumer recognises a
 *     0.2 producer and vice versa);
 *   - `body` IS the Trust Task document, verbatim;
 *   - the producer SHOULD set `thid` from the document's `threadId`, falling
 *     back to the document `id`, and `pthid` from `parentThreadId` (§3.1);
 *   - authcrypt only; the verified `skid`'s bare DID is the transport-
 *     authenticated sender (§2, §4) — enforced by the carriage, not here.
 *
 * Outbound: Credo's v2 packer honours `toV2Plaintext()`, so the wire shape is
 * exactly the binding's.
 *
 * Inbound: Credo normalises a v2 plaintext to v1 shape by SPREADING `body`
 * next to `@type`/`@id` before class-transformer builds the instance
 * (tsp-reference/ref-16, finding 1). A Trust Task document's own `id`, `type`,
 * `threadId` and `parentThreadId` would then overwrite the message's — and
 * `threadId` is a getter-only accessor on DidCommMessage, so a plain class
 * THROWS on any threaded document. The four `Expose`-renamed properties below
 * absorb those keys; `document` reassembles the body by subtracting the
 * DIDComm-layer members.
 *
 * Platform-neutral (no Node, no React Native imports), like everything in
 * this package.
 *
 * @module TrustTaskEnvelopeV2Message
 */

import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'
import { Expose } from 'class-transformer'

/** The stable binding identifier this module implements (SPEC §9.3). */
export const TRUST_TASK_V2_BINDING_URI = 'https://trusttasks.org/binding/didcomm/0.2'

/** The envelope message `type` — unchanged across binding 0.1 → 0.2 by design. */
export const TRUST_TASK_V2_ENVELOPE_TYPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'

/** The plaintext members that belong to the DIDComm layer, never to the document. */
const DIDCOMM_LAYER_MEMBERS = new Set(['from', 'to', 'created_time', 'expires_time', 'return_route', 'from_prior'])

export interface TrustTaskEnvelopeV2MessageOptions {
  id?: string
  /** The Trust Task document to carry — becomes the v2 `body` verbatim. */
  document: Record<string, unknown>
}

/** The v2 plaintext this message packs to (DIDComm Messaging v2 §2). */
export interface TrustTaskV2Plaintext {
  id: string
  type: string
  body: Record<string, unknown>
  thid?: string
  pthid?: string
}

export class TrustTaskEnvelopeV2Message extends DidCommMessage {
  public readonly allowDidSovPrefix = false

  /** v2-only: the binding is defined over DIDComm v2.1 authcrypt. */
  public readonly supportedDidCommVersions = ['v2'] as const

  /** Set on outbound instances only. */
  private outboundDocument?: Record<string, unknown>

  // Inbound: the spread body's reserved-looking members land here instead of
  // on the DIDComm message (see the module comment).
  public documentId?: string
  public documentType?: string
  public documentThreadId?: string
  public documentParentThreadId?: string

  public constructor(options?: TrustTaskEnvelopeV2MessageOptions) {
    super()
    if (options) {
      this.id = options.id ?? this.generateId()
      this.outboundDocument = options.document
    }
  }

  public static readonly type = parseMessageType(TRUST_TASK_V2_ENVELOPE_TYPE)
  public readonly type = TrustTaskEnvelopeV2Message.type.messageTypeUri

  /** The hook Credo's v2 packer calls: body = the document, headers per §3.1. */
  public toV2Plaintext(): TrustTaskV2Plaintext {
    const document = this.outboundDocument
    if (!document) throw new Error('TrustTaskEnvelopeV2Message: no document to pack (inbound instance?)')
    const plaintext: TrustTaskV2Plaintext = { id: this.id, type: TRUST_TASK_V2_ENVELOPE_TYPE, body: document }
    const thid = (document.threadId as string | undefined) ?? (document.id as string | undefined)
    if (thid !== undefined) plaintext.thid = thid
    const pthid = document.parentThreadId as string | undefined
    if (pthid !== undefined) plaintext.pthid = pthid
    return plaintext
  }

  /** The carried Trust Task document (outbound: as given; inbound: reassembled from the spread body). */
  public get document(): Record<string, unknown> | undefined {
    if (this.outboundDocument) return this.outboundDocument
    const json = this.toJSON() as Record<string, unknown>
    const document: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(json)) {
      if (key.startsWith('@') || key.startsWith('~') || DIDCOMM_LAYER_MEMBERS.has(key) || value === undefined) continue
      document[key] = value
    }
    // Reassembled from a v2 envelope: a document has at least `id` and `type`.
    if (typeof document.id !== 'string' || typeof document.type !== 'string') return undefined
    return document
  }

  /** The DIDComm-layer `from` (the sender's DID as the plaintext carried it), inbound only. */
  public get plaintextFrom(): string | undefined {
    return (this as unknown as { from?: string }).from
  }

  /** The DIDComm-layer `to` (our DID as the plaintext carried it), inbound only. */
  public get plaintextTo(): string[] | undefined {
    const to = (this as unknown as { to?: string | string[] }).to
    return to === undefined ? undefined : Array.isArray(to) ? to : [to]
  }
}

// class-validator / class-transformer wiring without decorator syntax (this
// package compiles with no decorator support) — the same one-liner
// TrustTaskMessage uses, plus the four renamed properties that catch the
// spread body's `id`/`type`/`threadId`/`parentThreadId`.
IsValidMessageType(TrustTaskEnvelopeV2Message.type)(TrustTaskEnvelopeV2Message.prototype, 'type')
Expose({ name: 'id' })(TrustTaskEnvelopeV2Message.prototype, 'documentId')
Expose({ name: 'type' })(TrustTaskEnvelopeV2Message.prototype, 'documentType')
Expose({ name: 'threadId' })(TrustTaskEnvelopeV2Message.prototype, 'documentThreadId')
Expose({ name: 'parentThreadId' })(TrustTaskEnvelopeV2Message.prototype, 'documentParentThreadId')
