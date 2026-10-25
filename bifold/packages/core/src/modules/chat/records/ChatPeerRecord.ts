/**
 * ChatPeerRecord — what this phone knows about one contact's chat support
 * beyond the announced RCE version (rich-messaging-plan.md §4.5): the notice
 * it last sent, and whether the contact has refused a chat event.
 *
 * The stored RCE version only ever rises, so a contact that went back to an
 * older build is recorded here instead, until it sends a new notice.
 *
 * @module chat/records/ChatPeerRecord
 */

import { BaseRecord, DateTransformer, TagsBase, utils } from '@credo-ts/core'

export interface ChatPeerRecordProps {
  id?: string
  connectionId: string
  noticeId?: string
  noticeSentAt?: Date
  chatRefusedAt?: Date
  createdAt?: Date
  tags?: TagsBase
}

export type ChatPeerRecordTags = {
  connectionId: string
}

export class ChatPeerRecord extends BaseRecord<ChatPeerRecordTags, TagsBase> {
  public connectionId!: string
  /** The DIDComm `@id` of the last capability notice sent to this contact. */
  public noticeId?: string
  public noticeSentAt?: Date
  /** Set when the contact answered a chat event with a problem report. */
  public chatRefusedAt?: Date

  public static readonly type = 'ChatPeerRecord'
  public readonly type = ChatPeerRecord.type

  public constructor(props: ChatPeerRecordProps) {
    super()

    if (props) {
      this.id = props.id ?? utils.uuid()
      this.connectionId = props.connectionId
      this.noticeId = props.noticeId
      this.noticeSentAt = props.noticeSentAt
      this.chatRefusedAt = props.chatRefusedAt
      this.createdAt = props.createdAt ?? new Date()
      this._tags = props.tags ?? {}
    }
  }

  public getTags() {
    return { ...this._tags, connectionId: this.connectionId }
  }
}

// Dates survive storage only with transform metadata in the class-transformer
// copy Credo's JsonTransformer reads (see ChatEventRecord).
DateTransformer()(ChatPeerRecord.prototype, 'noticeSentAt')
DateTransformer()(ChatPeerRecord.prototype, 'chatRefusedAt')
