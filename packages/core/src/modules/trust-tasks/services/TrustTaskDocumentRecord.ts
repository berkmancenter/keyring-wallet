/**
 * TrustTaskDocumentRecord
 *
 * Credo BaseRecord persisting one Trust Task document. Retention exists for
 * one load-bearing reason (cred-spec Outcome Interpretability): outcome
 * evidence is a PAIR — the exchange's initiating document and its terminal
 * `#response` — and a holder presenting a `taskContext`-bearing credential
 * must ship both. A document that isn't retained can't be shipped.
 *
 * @module trust-tasks/services/TrustTaskDocumentRecord
 */

import { BaseRecord, utils } from '@credo-ts/core'

export type TrustTaskDocumentRole = 'request' | 'response' | 'error'

export type TrustTaskDocumentRecordTags = {
  /** The document's own `id` member. */
  documentId: string
  /** The exchange's thread — the initiating document's id under §4.9's fallback. */
  exchangeId: string
  /** The document's Type URI (without any `#response` fragment). */
  typeUri: string
  /** request | response | error */
  role: TrustTaskDocumentRole
  /** The Credo connection the document arrived on / left through. */
  connectionId?: string
}

export interface TrustTaskDocumentRecordProps {
  id?: string
  createdAt?: Date
  document: Record<string, unknown>
  role: TrustTaskDocumentRole
  connectionId?: string
  undelivered?: boolean
}

export class TrustTaskDocumentRecord extends BaseRecord {
  public static readonly type = 'TrustTaskDocumentRecord'
  public readonly type = TrustTaskDocumentRecord.type

  /** The Trust Task document, verbatim — the store never rewrites a document. */
  public document!: Record<string, unknown>
  public role!: TrustTaskDocumentRole
  public connectionId?: string
  /**
   * An outbound document this phone signed and retained whose send then failed (the mailbox refused it, the
   * connection was down): kept as signed, so the next trigger sends this very document again instead of signing
   * another or, as before, taking the retained copy as proof it was sent and answering "already issued". Cleared
   * once it leaves. Absent (never set) on every document that was sent first time or that arrived.
   */
  public undelivered?: boolean

  public constructor(props: TrustTaskDocumentRecordProps) {
    super()
    if (props) {
      this.id = props.id ?? utils.uuid()
      this.createdAt = props.createdAt ?? new Date()
      this.document = props.document
      this.role = props.role
      this.connectionId = props.connectionId
      if (props.undelivered) this.undelivered = true
    }
  }

  public getTags(): TrustTaskDocumentRecordTags {
    const doc = this.document ?? {}
    const documentId = String(doc.id ?? '')
    const threadId = doc.threadId ? String(doc.threadId) : documentId
    const rawType = String(doc.type ?? '')
    return {
      documentId,
      exchangeId: threadId,
      typeUri: rawType.split('#')[0],
      role: this.role,
      connectionId: this.connectionId,
    }
  }
}
