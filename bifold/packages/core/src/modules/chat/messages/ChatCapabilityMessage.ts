/**
 * ChatCapabilityMessage — the one-time chat capability notice
 * (rich-messaging-plan.md §4.5).
 *
 * The relationship handshake announces the RCE version once per relationship,
 * and re-sending it would restart the relationship exchange. So a contact made
 * before this build learns that the other phone now speaks `keyring/chat/1.0`
 * from this separate message, which only raises the stored version.
 *
 * `reply` marks an answer to a notice, so an answer is never answered.
 *
 * @module chat/messages/ChatCapabilityMessage
 */

import { DidCommMessage, IsValidMessageType, parseMessageType } from '@credo-ts/didcomm'

/** The message type URI (plan §4.5). */
export const CHAT_CAPABILITY_MESSAGE_TYPE = 'https://keyring.berkmancenter.org/chat/1.0/capability'

export interface ChatCapabilityMessageOptions {
  id?: string
  rceVersion: number
  reply?: boolean
}

export class ChatCapabilityMessage extends DidCommMessage {
  public readonly allowDidSovPrefix = false

  /** The sender's RCE protocol version. Untrusted on the way in. */
  public rceVersion?: unknown

  /** True on an answer to a notice. Untrusted on the way in. */
  public reply?: unknown

  public constructor(options?: ChatCapabilityMessageOptions) {
    super()
    if (options) {
      this.id = options.id ?? this.generateId()
      this.rceVersion = options.rceVersion
      if (options.reply) this.reply = true
    }
  }

  public static readonly type = parseMessageType(CHAT_CAPABILITY_MESSAGE_TYPE)
  public readonly type = ChatCapabilityMessage.type.messageTypeUri
}

// class-validator wiring without decorator syntax, as ChatEventMessage does.
IsValidMessageType(ChatCapabilityMessage.type)(ChatCapabilityMessage.prototype, 'type')
