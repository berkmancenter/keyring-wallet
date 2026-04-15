/**
 * Utility functions for working with Witness Credentials (VWCs)
 *
 * These functions help identify, filter, and extract information from
 * WitnessCredentials in the credential store.
 */

import { W3cCredentialRecord } from '@credo-ts/core'

/**
 * Locality verification information from witnessContext
 */
export interface LocalityVerification {
  /** Type of locality verification (e.g., "proximity", "gps") */
  type?: string
  /** Whether verification was confirmed */
  confirmed?: boolean
  /** Additional details */
  details?: string
}

/**
 * Extracted witness record information for display
 */
export interface WitnessRecord {
  /** Event name from witnessContext */
  event?: string
  /** Verification method used */
  method?: string
  /** Session ID */
  sessionId?: string
  /** Witness DID (issuer) */
  witnessDid: string
  /** Witness name (if available from issuer object) */
  witnessName?: string
  /** Issuance date */
  issuanceDate?: string
  /** Credential ID for navigation */
  credentialId: string
  /** Locality verification information */
  localityVerification?: LocalityVerification
  /** Whether hardware attestation was included in the exchange */
  hardwareAttestationIncluded?: boolean
}

/**
 * Check if a VRC (DTGCredential) has a hardware attestation evidence block.
 * This is the evidence added directly to the main VRC when HW signing is on,
 * regardless of whether a witness was involved.
 *
 * @param credential - W3C credential record to check
 * @returns True if the credential contains a HardwareKeyAttestation evidence block
 */
export function hasHardwareAttestationEvidence(credential: W3cCredentialRecord): boolean {
  try {
    const credentialData = credential.credential
    if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
      return false
    }

    let raw: any = credentialData
    if (typeof (credentialData as any).toJSON === 'function') {
      raw = (credentialData as any).toJSON()
    }

    if (!('evidence' in raw) || !Array.isArray(raw.evidence)) {
      return false
    }

    return raw.evidence.some((ev: any) => {
      if (!ev || typeof ev !== 'object') return false
      const types = Array.isArray(ev.type) ? ev.type : [ev.type]
      return types.includes('HardwareKeyAttestation')
    })
  } catch {
    return false
  }
}

/**
 * Check if any VRC credential (DTGCredential, non-Witness) issued by a
 * specific DID contains hardware attestation evidence.
 *
 * NOTE: This only checks for presence of evidence, NOT verification.
 * For badge display, use verifyVrcHardwareEvidence instead.
 *
 * @param credentials - All W3C credential records
 * @param issuerDid - The counterparty's relationship DID (the credential issuer)
 * @returns True if any matching VRC has HW attestation evidence
 */
export function hasVrcHardwareAttestation(
  credentials: W3cCredentialRecord[],
  issuerDid: string
): boolean {
  return credentials.some((credential) => {
    try {
      const credentialData = credential.credential
      if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
        return false
      }

      // Must be a DTGCredential (the VRC), not a WitnessCredential
      if (!('type' in credentialData)) return false
      const types = Array.isArray((credentialData as any).type)
        ? (credentialData as any).type
        : [(credentialData as any).type]
      if (!types.includes('DTGCredential')) return false
      if (types.includes('WitnessCredential')) return false

      // issuer.id must match the contact's DID
      if (!('issuer' in credentialData)) return false
      const issuer = (credentialData as any).issuer
      const issuerId = typeof issuer === 'string' ? issuer : issuer?.id
      if (issuerId !== issuerDid) return false

      return hasHardwareAttestationEvidence(credential)
    } catch {
      return false
    }
  })
}

/**
 * Get the raw VRC credential JSON (with evidence) for a specific issuer DID.
 * Used to feed into verifyVrcHardwareEvidence for actual cryptographic verification.
 *
 * @param credentials - All W3C credential records
 * @param issuerDid - The counterparty's relationship DID (the credential issuer)
 * @returns Raw credential JSON object or null
 */
export function getVrcCredentialJsonForSubject(
  credentials: W3cCredentialRecord[],
  issuerDid: string
): Record<string, unknown> | null {
  for (const credential of credentials) {
    try {
      const credentialData = credential.credential
      if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
        continue
      }

      if (!('type' in credentialData)) continue
      const types = Array.isArray((credentialData as any).type)
        ? (credentialData as any).type
        : [(credentialData as any).type]
      if (!types.includes('DTGCredential')) continue
      if (types.includes('WitnessCredential')) continue

      // Match by issuer DID (the contact who issued this credential to us)
      if (!('issuer' in credentialData)) continue
      const issuer = (credentialData as any).issuer
      const issuerId = typeof issuer === 'string' ? issuer : issuer?.id
      if (issuerId !== issuerDid) continue

      if (!hasHardwareAttestationEvidence(credential)) continue

      let raw: any = credentialData
      if (typeof (credentialData as any).toJSON === 'function') {
        raw = (credentialData as any).toJSON()
      }
      return raw as Record<string, unknown>
    } catch {
      continue
    }
  }
  return null
}

/**
 * Check if a credential has the WitnessCredential type
 *
 * @param credential - W3C credential record to check
 * @returns True if the credential includes "WitnessCredential" in its type array
 */
export function hasWitnessCredentialType(credential: W3cCredentialRecord): boolean {
  try {
    const credentialData = credential.credential

    if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
      return false
    }

    if (!('type' in credentialData)) {
      return false
    }

    const typeValue = (credentialData as any).type
    const types = Array.isArray(typeValue) ? typeValue : [typeValue]

    return types.some((type) => typeof type === 'string' && type === 'WitnessCredential')
  } catch (error) {
    return false
  }
}

/**
 * Get all witness credentials for a specific subject DID
 *
 * This filters credentials where:
 * - Type includes "WitnessCredential"
 * - credentialSubject.id matches the provided subjectDid
 *
 * @param credentials - Array of W3C credential records
 * @param subjectDid - The DID to match against credentialSubject.id (counterparty's R-DID)
 * @returns Array of matching witness credential records
 */
export function getWitnessCredentialsForSubject(
  credentials: W3cCredentialRecord[],
  subjectDid: string
): W3cCredentialRecord[] {
  return credentials.filter((credential) => {
    // Check if it's a WitnessCredential
    if (!hasWitnessCredentialType(credential)) {
      return false
    }

    // Check if credentialSubject.id matches the subjectDid
    try {
      const credentialData = credential.credential
      if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
        return false
      }

      if (!('credentialSubject' in credentialData)) {
        return false
      }

      const credentialSubject = (credentialData as any).credentialSubject
      if (!credentialSubject || typeof credentialSubject !== 'object') {
        return false
      }

      const subjectId = credentialSubject.id
      return subjectId === subjectDid
    } catch (error) {
      return false
    }
  })
}

/**
 * Extract display information from a witness credential
 *
 * @param vwc - Witness credential record
 * @returns WitnessRecord with extracted information, or null if extraction fails
 */
export function extractWitnessInfo(vwc: W3cCredentialRecord): WitnessRecord | null {
  try {
    const credentialData = vwc.credential

    if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
      return null
    }

    // Try to get raw JSON if it's a class instance
    let rawCredential: any = credentialData
    if (typeof (credentialData as any).toJSON === 'function') {
      rawCredential = (credentialData as any).toJSON()
    }

    // Extract issuer (witness DID)
    let witnessDid: string
    let witnessName: string | undefined

    if ('issuer' in rawCredential) {
      const issuerValue = rawCredential.issuer

      if (typeof issuerValue === 'string') {
        witnessDid = issuerValue
        // Fallback: derive a short name from the DID for display
        witnessName = 'Witness'
      } else if (issuerValue && typeof issuerValue === 'object' && 'id' in issuerValue) {
        witnessDid = issuerValue.id
        witnessName = issuerValue.name || 'Witness'
      } else {
        return null
      }
    } else {
      return null
    }

    // Extract witnessContext from credentialSubject
    let event: string | undefined
    let method: string | undefined
    let sessionId: string | undefined
    let localityVerification: LocalityVerification | undefined
    let hardwareAttestationIncluded: boolean | undefined

    if ('credentialSubject' in rawCredential) {
      let credentialSubject = rawCredential.credentialSubject

      // Handle array case (W3C VC allows credentialSubject to be an array)
      if (Array.isArray(credentialSubject)) {
        credentialSubject = credentialSubject[0] // Take first subject
      }

      if (credentialSubject && typeof credentialSubject === 'object') {
        // Check for hardwareAttestationIncluded directly in credentialSubject first
        if ('hardwareAttestationIncluded' in credentialSubject) {
          hardwareAttestationIncluded = credentialSubject.hardwareAttestationIncluded === true
        }

        // Try to find witnessContext - check both direct and nested under claims
        let witnessContext: any = null

        // First, check directly in credentialSubject
        if ('witnessContext' in credentialSubject && credentialSubject.witnessContext) {
          witnessContext = credentialSubject.witnessContext
        }
        // Second, check under credentialSubject.claims
        else if ('claims' in credentialSubject && credentialSubject.claims && typeof credentialSubject.claims === 'object') {
          const claims = credentialSubject.claims

          if ('witnessContext' in claims && claims.witnessContext) {
            witnessContext = claims.witnessContext
          }
        }

        if (witnessContext && typeof witnessContext === 'object') {
          event = witnessContext.event
          method = witnessContext.method
          sessionId = witnessContext.sessionId

          // Extract hardwareAttestationIncluded from witnessContext (where witness server puts it)
          if ('hardwareAttestationIncluded' in witnessContext) {
            hardwareAttestationIncluded = witnessContext.hardwareAttestationIncluded === true
          }

          // Extract locality verification if present
          if (witnessContext.localityVerification && typeof witnessContext.localityVerification === 'object') {
            localityVerification = {
              type: witnessContext.localityVerification.type,
              confirmed: witnessContext.localityVerification.confirmed,
              details: witnessContext.localityVerification.details,
            }
          }
        }
      }
    }

    // Extract issuance date
    let issuanceDate: string | undefined
    if ('validFrom' in rawCredential && typeof rawCredential.validFrom === 'string') {
      issuanceDate = rawCredential.validFrom
    } else if ('issuanceDate' in rawCredential && typeof rawCredential.issuanceDate === 'string') {
      issuanceDate = rawCredential.issuanceDate
    }

    return {
      event,
      method,
      sessionId,
      witnessDid,
      witnessName,
      issuanceDate,
      credentialId: vwc.id,
      localityVerification,
      hardwareAttestationIncluded,
    }
  } catch (error) {
    console.error('[WitnessUtils] Error extracting witness info:', error)
    return null
  }
}
