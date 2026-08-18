/**
 * TrustTaskMessage
 *
 * The DIDComm v1 carriage for a Trust Task document, per
 * `bindings/didcomm-v1/0.2` §2: the binding's own message `@type` with the
 * document riding a `~attach` entry under the reserved id `trust-task`.
 * Adopted upstream from Keyring's own carrier measurement (binding 0.2 §2.1);
 * proven against Credo 0.6.3 in reference rungs ref-06v1c/ref-06x.
 *
 * @module trust-tasks/messages/TrustTaskMessage
 */

import {
  DidCommMessage,
  DidCommAttachment,
  DidCommAttachmentData,
  IsValidMessageType,
  parseMessageType,
} from '@credo-ts/didcomm'

/** The reserved `~attach` entry id carrying the Trust Task document (binding 0.2 §2). */
export const TRUST_TASK_ATTACHMENT_ID = 'trust-task'

/** The binding's message `@type` (binding 0.2 §2, RFC 0020 shape). */
export const TRUST_TASK_ENVELOPE_TYPE = 'https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task'

/** The stable binding identifier this module implements (SPEC §9.3). */
export const TRUST_TASK_BINDING_URI = 'https://trusttasks.org/binding/didcomm-v1/0.2'

export interface TrustTaskMessageOptions {
  id?: string
  /** The Trust Task document to carry. */
  document: Record<string, unknown>
  /** DIDComm thread id — only set when representable; see the omit rule (binding §4). */
  threadId?: string
}

/**
 * RFC 0008 thread-id shape: `[-_./a-zA-Z0-9]{8,64}`. A correlator that cannot
 * satisfy it is omitted from `~thread`, never rewritten (binding §4, the omit
 * rule adopted from Keyring's #208).
 */
export function isTransportRepresentable(value: string): boolean {
  return value.length >= 8 && value.length <= 64 && /^[-_./a-zA-Z0-9]+$/.test(value)
}

/**
 * A DIDComm v1 message of the binding's dedicated type carrying one Trust Task
 * document. Note: the document's own `threadId`/`id` remain authoritative; the
 * `~thread` decorator is a transport convenience populated only where
 * representable.
 */
export class TrustTaskMessage extends DidCommMessage {
  public constructor(options?: TrustTaskMessageOptions) {
    super()
    if (options) {
      this.id = options.id ?? this.generateId()
      this.appendedAttachments = [
        new DidCommAttachment({
          id: TRUST_TASK_ATTACHMENT_ID,
          mimeType: 'application/json',
          data: new DidCommAttachmentData({ json: options.document }),
        }),
      ]
      const thid = options.threadId ?? (options.document.threadId as string | undefined) ?? (options.document.id as string | undefined)
      if (thid && isTransportRepresentable(thid)) {
        this.setThread({ threadId: thid })
      }
    }
  }

  public readonly type = TrustTaskMessage.type.messageTypeUri
  public static readonly type = parseMessageType(TRUST_TASK_ENVELOPE_TYPE)

  /** Extract the carried Trust Task document (the reserved attachment's inline JSON). */
  public get document(): Record<string, unknown> | undefined {
    const attachment = this.appendedAttachments?.find((a) => a.id === TRUST_TASK_ATTACHMENT_ID)
    return attachment?.getDataAsJson() as Record<string, unknown> | undefined
  }
}

// class-validator wiring without decorator syntax (this package compiles with
// no decorator support) — the same one-liner Credo's own message classes
// reduce to, applied the way the reference rungs apply it.
IsValidMessageType(TrustTaskMessage.type)(TrustTaskMessage.prototype, 'type')
