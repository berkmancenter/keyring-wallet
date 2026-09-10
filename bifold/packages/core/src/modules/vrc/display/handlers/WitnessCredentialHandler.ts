/**
 * Display Handler for WitnessCredential (VWC)
 *
 * WitnessCredential is a credential issued by a witness server
 * attesting to a witnessed exchange with event context and locality proof.
 *
 * This handler extracts and formats the following fields:
 * - Event Name (from witnessContext.event)
 * - Witness Method (from witnessContext.method)
 * - Locality Verification Status
 * - Session ID (from witnessContext.sessionId)
 * - Issuance Date
 * - Witness Issuer DID
 */

import {
  Attribute,
  Field,
  CredentialDisplayHandler,
  CredentialButtonText,
  W3cCredentialJson,
  extractIssuerObject,
  hasCredentialType,
  formatDateForDisplay,
} from '../types'

/**
 * Handler for WitnessCredential display
 *
 * Priority: 110 (higher than RelationshipCredential to ensure VWCs get special treatment)
 */
export class WitnessCredentialHandler implements CredentialDisplayHandler {
  readonly credentialTypes = ['WitnessCredential']
  readonly priority = 110

  canHandle(credential: W3cCredentialJson): boolean {
    return hasCredentialType(credential, 'WitnessCredential')
  }

  /**
   * Returns the human-readable name for this credential type
   */
  getCredentialTypeName(): string {
    return 'Witness Credential'
  }

  extractFields(credential: W3cCredentialJson): Field[] {
    const fields: Field[] = []
    const issuer = extractIssuerObject(credential)
    const credentialSubject = credential.credentialSubject || {}

    // Extract witness context from credentialSubject
    const witnessContext = (credentialSubject.witnessContext as any) || {}

    // 1. Event Name (from witnessContext.event)
    if (witnessContext.event) {
      fields.push(
        new Attribute({
          name: 'event',
          label: 'Witness.VWC.Event',
          value: witnessContext.event as string,
          mimeType: 'text/plain',
        })
      )
    }

    // 2. Witness Method (from witnessContext.method)
    if (witnessContext.method) {
      fields.push(
        new Attribute({
          name: 'method',
          label: 'Witness.VWC.Method',
          value: this.formatMethod(witnessContext.method as string),
          mimeType: 'text/plain',
        })
      )
    }

    // 3. Locality — three states, never collapsed into a boolean
    // (locality-plan.md §7.1 rule 5, §10.3 item 11): confirmed (venue-scale,
    // never "verified together"), declined-or-interrupted (with a reason,
    // read differently — a choice vs. "try again"), or nothing at all when
    // this witness doesn't do locality (the honest read of total absence).
    const localityField = this.getLocalityField(witnessContext)
    if (localityField) {
      fields.push(localityField)
    }

    // 4. Session ID (from witnessContext.sessionId)
    if (witnessContext.sessionId) {
      fields.push(
        new Attribute({
          name: 'sessionId',
          label: 'Witness.VWC.SessionID',
          value: this.formatSessionId(witnessContext.sessionId as string),
          mimeType: 'text/plain',
        })
      )
    }

    // 5. Issuance Date (validFrom or issuanceDate)
    const issuanceDate = credential.validFrom || credential.issuanceDate
    if (issuanceDate) {
      fields.push(
        new Attribute({
          name: 'issuanceDate',
          label: 'Contacts.IssuanceDate',
          value: formatDateForDisplay(issuanceDate),
          mimeType: 'text/plain',
        })
      )
    }

    // 6. Witness Issuer DID
    if (issuer.id) {
      fields.push(
        new Attribute({
          name: 'witnessDid',
          label: 'Witness.Status.WitnessDID',
          value: issuer.id,
          mimeType: 'text/plain',
        })
      )
    }

    // 7. Witness Issuer Name (if available)
    if (issuer.name) {
      fields.push(
        new Attribute({
          name: 'witnessName',
          label: 'Contacts.IssuerName',
          value: issuer.name,
          mimeType: 'text/plain',
        })
      )
    }

    return fields
  }

  getButtonText(): CredentialButtonText {
    return {
      accept: 'Contacts.AcceptContact',
      decline: 'Contacts.DeclineContact',
    }
  }

  /**
   * Format the witness method for display
   */
  private formatMethod(method: string): string {
    // Convert kebab-case or snake_case to Title Case
    return method.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
  }

  /**
   * The locality field, in one of three visibly different states — never a
   * boolean. Reads the flat `locality*` members first (current shape);
   * falls back to the old nested `witnessContext.localityVerification` only
   * for VWCs issued before that shape existed. Absence of BOTH means this
   * witness doesn't do locality at all, and renders nothing (§7.1 rule 5 —
   * the only signal for "not offered" is total absence, so this method
   * returns null rather than a field saying "not offered").
   */
  private getLocalityField(witnessContext: any): Attribute | null {
    if ('localityConfirmed' in witnessContext) {
      const confirmed = witnessContext.localityConfirmed === true
      return new Attribute({
        name: 'locality',
        label: 'Witness.VWC.Locality',
        value: confirmed
          ? 'Witness.VWC.LocalityConfirmed'
          : this.formatDeclineReason(witnessContext.localityReason),
        mimeType: 'text/plain',
      })
    }

    const legacy = witnessContext.localityVerification
    if (legacy && typeof legacy === 'object') {
      return new Attribute({
        name: 'locality',
        label: 'Witness.VWC.Locality',
        value: legacy.confirmed === true ? 'Witness.VWC.LocalityConfirmed' : 'Witness.VWC.LocalityDeclined',
        mimeType: 'text/plain',
      })
    }

    return null
  }

  /** `declinedByHolder` (a choice) reads differently to a holder than `windowLost` (try again, not suspicious) — plan §7.1 rule 5. */
  private formatDeclineReason(reason: unknown): string {
    if (reason === 'windowLost') return 'Witness.VWC.LocalityInterrupted'
    return 'Witness.VWC.LocalityDeclined'
  }

  /**
   * Format session ID for display (show first and last parts)
   */
  private formatSessionId(sessionId: string): string {
    if (!sessionId || sessionId.length <= 20) {
      return sessionId
    }

    // Show prefix and suffix with ellipsis in middle
    const prefix = sessionId.substring(0, 8)
    const suffix = sessionId.substring(sessionId.length - 8)
    return `${prefix}...${suffix}`
  }
}

/**
 * Singleton instance of the WitnessCredential handler
 */
export const witnessCredentialHandler = new WitnessCredentialHandler()
