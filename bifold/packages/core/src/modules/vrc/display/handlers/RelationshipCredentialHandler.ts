/**
 * Display Handler for RelationshipCredential
 *
 * RelationshipCredential is a subclass of DTGCredential used for
 * establishing verifiable relationships between parties.
 *
 * This handler extracts and formats the following fields:
 * - Issuance Date (validFrom or issuanceDate)
 * - Issuer Name
 * - Issuer Email (if present)
 * - Issuer Organization (if present)
 * - Issuer DID (relationship DID)
 * - Recipient DID (credentialSubject.id)
 */

import {
  Attribute,
  Field,
  CredentialDisplayHandler,
  CredentialButtonText,
  CredentialTerminology,
  W3cCredentialJson,
  extractIssuerObject,
  hasCredentialType,
  formatDateForDisplay,
} from '../types'
import { contactTerminology } from '../terminology/defaults'

/**
 * Handler for RelationshipCredential display
 *
 * Priority: 100 (higher than base DTGCredential handler)
 * This ensures RelationshipCredential gets its specific display treatment
 * rather than falling through to a generic DTGCredential handler.
 */
export class RelationshipCredentialHandler implements CredentialDisplayHandler {
  readonly credentialTypes = ['RelationshipCredential']
  readonly priority = 100

  canHandle(credential: W3cCredentialJson): boolean {
    return hasCredentialType(credential, 'RelationshipCredential')
  }

  /**
   * Returns the human-readable name for this credential type
   */
  getCredentialTypeName(): string {
    return 'Relationship Credential'
  }

  extractFields(credential: W3cCredentialJson): Field[] {
    const fields: Field[] = []
    const issuer = extractIssuerObject(credential)
    const credentialSubject = credential.credentialSubject || {}

    // 1. Issuance Date (validFrom or issuanceDate)
    const issuanceDate = credential.validFrom || credential.issuanceDate
    if (issuanceDate) {
      fields.push(
        new Attribute({
          name: 'issuanceDate',
          label: 'Issuance Date',
          value: formatDateForDisplay(issuanceDate),
          mimeType: 'text/plain',
        })
      )
    }

    // 2. Issuer Name
    if (issuer.name) {
      fields.push(
        new Attribute({
          name: 'issuerName',
          label: 'Issuer Name',
          value: issuer.name,
          mimeType: 'text/plain',
        })
      )
    }

    // 3. Issuer Email (if present)
    if (issuer.email) {
      fields.push(
        new Attribute({
          name: 'issuerEmail',
          label: 'Issuer Email',
          value: issuer.email,
          mimeType: 'text/plain',
        })
      )
    }

    // 4. Issuer Organization (if present)
    if (issuer.organization) {
      fields.push(
        new Attribute({
          name: 'issuerOrganization',
          label: 'Issuer Organization',
          value: issuer.organization,
          mimeType: 'text/plain',
        })
      )
    }

    // 5. Issuer DID (relationship DID)
    if (issuer.id) {
      fields.push(
        new Attribute({
          name: 'issuerDid',
          label: 'Issuer R-DID',
          value: issuer.id,
          mimeType: 'text/plain',
        })
      )
    }

    // 6. Recipient DID (your relationship DID)
    const recipientDid = credentialSubject.id as string | undefined
    if (recipientDid) {
      fields.push(
        new Attribute({
          name: 'recipientDid',
          label: 'Your R-DID',
          value: recipientDid,
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
   * Returns complete UI terminology for RelationshipCredentials
   * Uses "contact" language throughout
   */
  getTerminology(): CredentialTerminology {
    return contactTerminology
  }
}

/**
 * Singleton instance of the RelationshipCredential handler
 */
export const relationshipCredentialHandler = new RelationshipCredentialHandler()
