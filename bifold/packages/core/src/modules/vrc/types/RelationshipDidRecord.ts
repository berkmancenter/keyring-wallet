import { BaseRecord, TagsBase } from '@credo-ts/core'
import { uuid } from '@credo-ts/core/build/utils/uuid'

export interface RelationshipDidRecordProps {
  id?: string
  counterpartyConnectionDid: string
  myRelationshipDid: string
  counterpartyRelationshipDid?: string
  connectionId?: string
  createdAt?: Date
  tags?: CustomTags
}

export type CustomTags = TagsBase & {
  counterpartyConnectionDid: string
}

export type DefaultRelationshipDidRecordTags = {
  counterpartyConnectionDid: string
  counterpartyRelationshipDid?: string
}

/**
 * Record to store relationship DID mappings for VRC bidirectional exchange
 *
 * DID Types:
 * - counterpartyConnectionDid: The connection's theirDid (did:peer:1z...) - used for backend lookups
 * - counterpartyRelationshipDid: The counterparty's relationship DID (did:peer:0z6Mk...) - used in VRC credentials
 *
 * This enables:
 * - Each party has ONE relationshipDid per relationship (used for both issuing and receiving)
 * - Persistent storage across connection re-establishments
 * - Privacy-preserving pairwise unique DIDs
 */
export class RelationshipDidRecord extends BaseRecord<DefaultRelationshipDidRecordTags, CustomTags> {
  public counterpartyConnectionDid!: string
  public myRelationshipDid!: string
  public counterpartyRelationshipDid?: string
  public connectionId?: string

  public static readonly type = 'RelationshipDidRecord'
  public readonly type = RelationshipDidRecord.type

  public constructor(props: RelationshipDidRecordProps) {
    super()

    if (props) {
      this.id = props.id ?? uuid()
      this.counterpartyConnectionDid = props.counterpartyConnectionDid
      this.myRelationshipDid = props.myRelationshipDid
      this.counterpartyRelationshipDid = props.counterpartyRelationshipDid
      this.connectionId = props.connectionId
      this.createdAt = props.createdAt ?? new Date()
      this._tags = props.tags ?? ({} as CustomTags)
    }
  }

  public getTags() {
    return {
      ...this._tags,
      counterpartyConnectionDid: this.counterpartyConnectionDid,
      counterpartyRelationshipDid: this.counterpartyRelationshipDid,
    }
  }
}
