/**
 * Utilities for resolving contact display info (name/email/organization).
 *
 * Since the RCard/VRC separation (DTG spec alignment), contact info travels in
 * a received RelationshipCard credential (issuer = counterparty's relationship
 * DID, credentialSubject.card = jCard). Wallets that exchanged credentials
 * before the separation embedded the info in the VRC's issuer object instead,
 * so resolution falls back to that legacy shape.
 */

import { W3cCredentialRecord } from '@credo-ts/core'

import { isPeerVrcCredential, isRCard } from '../credentialTypes'
import { extractFormInputFromJCard, JCard } from '../types/rcard'

export interface ContactDisplayInfo {
  name?: string
  email?: string
  organization?: string
}

/**
 * Get the credential JSON out of a record's `encoded` field, tolerating both
 * plain objects and class instances (via `.toJSON()`). Canonical extraction —
 * use this instead of reading `record.encoded` inline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toRawCredential = (record: W3cCredentialRecord): any | null => {
  try {
    const credentialData = record.encoded
    if (!credentialData || typeof credentialData !== 'object' || Array.isArray(credentialData)) {
      return null
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (credentialData as any).toJSON === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (credentialData as any).toJSON()
    }
    return credentialData
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getIssuerId = (raw: any): string | null => {
  const issuer = raw?.issuer
  if (typeof issuer === 'string') return issuer
  if (issuer && typeof issuer === 'object' && typeof issuer.id === 'string') return issuer.id
  return null
}

/**
 * Check whether a record is a *received* RelationshipCard — i.e. an exchanged
 * contact card, not the local self-issued RCardTemplate.
 */
export function isReceivedRCard(record: W3cCredentialRecord): boolean {
  const raw = toRawCredential(record)
  if (!raw) return false
  return isRCard(raw)
}

/**
 * Find the received RCard issued by a specific relationship DID (the contact).
 * When multiple exist (re-issued cards), the most recently issued one wins.
 */
export function getReceivedRCardForIssuer(
  records: W3cCredentialRecord[],
  issuerDid: string
): W3cCredentialRecord | undefined {
  const matches = records.filter((record) => {
    if (!isReceivedRCard(record)) return false
    return getIssuerId(toRawCredential(record)) === issuerDid
  })

  if (matches.length <= 1) return matches[0]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issuedAt = (record: W3cCredentialRecord): number => {
    const raw = toRawCredential(record)
    const date = raw?.validFrom || raw?.issuanceDate
    const time = date ? new Date(date).getTime() : NaN
    return Number.isNaN(time) ? 0 : time
  }
  return matches.sort((a, b) => issuedAt(b) - issuedAt(a))[0]
}

/**
 * Extract contact display info from a received RCard's jCard.
 */
export function extractContactInfoFromRCard(record: W3cCredentialRecord): ContactDisplayInfo {
  const raw = toRawCredential(record)
  if (!raw) return {}

  const rawSubject = raw.credentialSubject
  const subject = Array.isArray(rawSubject) ? rawSubject[0] : rawSubject
  // Credo class instances may nest custom subject properties under `claims`
  const card = subject?.card ?? subject?.claims?.card

  if (!Array.isArray(card) || card[0] !== 'vcard') return {}

  const formInput = extractFormInputFromJCard(card as JCard)
  const firstName = formInput.firstName?.trim() || ''
  const lastName = formInput.lastName?.trim() || ''
  const name = `${firstName} ${lastName}`.trim() || undefined

  return {
    name,
    email: formInput.email?.trim() || undefined,
    organization: formInput.organization?.trim() || undefined,
  }
}

/**
 * Resolve contact display info for a contact identified by their relationship
 * DID (the issuer of the VRC/RCard we hold).
 *
 * Priority:
 * 1. Received RCard issued by that DID (post-separation exchanges)
 * 2. Legacy VRC issuer object fields (pre-separation exchanges)
 */
export function resolveContactDisplayInfo(records: W3cCredentialRecord[], issuerDid: string): ContactDisplayInfo {
  const rcard = getReceivedRCardForIssuer(records, issuerDid)
  if (rcard) {
    const info = extractContactInfoFromRCard(rcard)
    if (info.name || info.email || info.organization) {
      return info
    }
  }

  // Legacy fallback: VRC with an embedded issuer object. When several match
  // (re-issued credentials), the most recently issued one wins.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyMatches: { raw: any; time: number }[] = []
  for (const record of records) {
    const raw = toRawCredential(record)
    if (!raw) continue
    if (!isPeerVrcCredential(raw)) continue
    const issuer = raw.issuer
    if (!issuer || typeof issuer !== 'object' || issuer.id !== issuerDid) continue
    if (!issuer.name && !issuer.email && !issuer.organization) continue

    const date = raw.validFrom || raw.issuanceDate
    const time = date ? new Date(date).getTime() : NaN
    legacyMatches.push({ raw, time: Number.isNaN(time) ? 0 : time })
  }

  if (legacyMatches.length > 0) {
    const issuer = legacyMatches.sort((a, b) => b.time - a.time)[0].raw.issuer
    return {
      name: issuer.name || undefined,
      email: issuer.email || undefined,
      organization: issuer.organization || undefined,
    }
  }

  return {}
}
