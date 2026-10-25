/**
 * ChatEventMessage — the `keyring/chat/1.0` DIDComm message
 * (rich-messaging-plan.md §4.1): one chat event per message.
 *
 * One class for both DIDComm versions, the way Credo's own BasicMessage 2.0
 * works: over v1 the event rides as the `event` member next to `@type`/`@id`;
 * over v2 `toV2Plaintext()` puts it in `body.event`, and on the way in Credo
 * spreads `body` onto the instance, so `event` lands on the same property.
 * Keeping the event one member deep means its own `type` and `eventId` never
 * collide with the DIDComm message's `type` and `id`.
 *
 * @module chat/messages/ChatEventMessage
 */

import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'

import type { ChatEvent } from '../chatEvent'

/** The message type URI (plan §4.1, D3). */
export const CHAT_EVENT_MESSAGE_TYPE = 'https://keyring.berkmancenter.org/chat/1.0/event'

export interface ChatEventMessageOptions {
  id?: string
  event: ChatEvent
}

/** The v2 plaintext this message packs to (DIDComm Messaging v2 §2). */
export interface ChatEventV2Plaintext {
  id: string
  type: string
  body: { event: ChatEvent }
}

export class ChatEventMessage extends DidCommMessage {
  public readonly allowDidSovPrefix = false

  /** The carried event. Untrusted on the way in: always pass it through `parseChatEvent`. */
  public event?: unknown

  public constructor(options?: ChatEventMessageOptions) {
    super()
    if (options) {
      this.id = options.id ?? this.generateId()
      this.event = options.event
    }
  }

  public static readonly type = parseMessageType(CHAT_EVENT_MESSAGE_TYPE)
  public readonly type = ChatEventMessage.type.messageTypeUri

  /** The hook Credo's v2 packer calls. */
  public toV2Plaintext(): ChatEventV2Plaintext {
    if (!this.event) throw new Error('ChatEventMessage: no event to pack (inbound instance?)')
    return { id: this.id, type: ChatEventMessage.type.messageTypeUri, body: { event: this.event as ChatEvent } }
  }
}

// class-validator wiring without decorator syntax, as TrustTaskMessage does.
IsValidMessageType(ChatEventMessage.type)(ChatEventMessage.prototype, 'type')
