/**
 * ChatEventRecord — one stored chat event, sent or received
 * (rich-messaging-plan.md §5). Reactions, redactions and timer changes are
 * stored as their own records and folded into their targets when the
 * timeline is built.
 *
 * @module chat/records/ChatEventRecord
 */

import { BaseRecord, TagsBase, utils } from '@credo-ts/core'

import type { ChatEventType, ChatMessageContent } from '../chatEvent'

export type ChatEventRole = 'sent' | 'received'

export interface ChatEventRecordProps {
  id?: string
  connectionId: string
  role: ChatEventRole
  eventId: string
  eventType: ChatEventType
  content?: ChatMessageContent
  inReplyTo?: string
  target?: string
  emoji?: string
  expiresIn?: number
  timer?: { expiresIn: number; version: number }
  clientTs?: string
  /** When this phone sent or stored the event. */
  sentTime?: Date
  createdAt?: Date
  tags?: TagsBase
}

export type ChatEventRecordTags = {
  connectionId: string
  role: ChatEventRole
  eventId: string
  eventType: ChatEventType
  target?: string
}

export class ChatEventRecord extends BaseRecord<ChatEventRecordTags, TagsBase> {
  public connectionId!: string
  public role!: ChatEventRole
  public eventId!: string
  public eventType!: ChatEventType
  public content?: ChatMessageContent
  public inReplyTo?: string
  public target?: string
  public emoji?: string
  public expiresIn?: number
  public timer?: { expiresIn: number; version: number }
  public clientTs?: string
  public sentTime!: Date

  public static readonly type = 'ChatEventRecord'
  public readonly type = ChatEventRecord.type

  public constructor(props: ChatEventRecordProps) {
    super()

    if (props) {
      this.id = props.id ?? utils.uuid()
      this.connectionId = props.connectionId
      this.role = props.role
      this.eventId = props.eventId
      this.eventType = props.eventType
      this.content = props.content
      this.inReplyTo = props.inReplyTo
      this.target = props.target
      this.emoji = props.emoji
      this.expiresIn = props.expiresIn
      this.timer = props.timer
      this.clientTs = props.clientTs
      this.createdAt = props.createdAt ?? new Date()
      this.sentTime = props.sentTime ?? this.createdAt
      this._tags = props.tags ?? {}
    }
  }

  public getTags() {
    return {
      ...this._tags,
      connectionId: this.connectionId,
      role: this.role,
      eventId: this.eventId,
      eventType: this.eventType,
      target: this.target,
    }
  }
}
