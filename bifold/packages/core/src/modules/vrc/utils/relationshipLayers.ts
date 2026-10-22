/**
 * The layers of a relationship, as the records on this phone show them: each
 * set of cards the contact issued to you (and whether it carries hardware
 * evidence, which is verified before it is said), and each witness record.
 * Newest first. A card says "exchanged", never "remotely": a first exchange
 * may well have been in person, and nothing in the card says which.
 *
 * @module vrc/utils/relationshipLayers
 */
import type { W3cCredentialRecord } from '@credo-ts/core'

import { isPeerVrcCredential } from '../credentialTypes'

import { toRawCredential } from './rcardDisplayUtils'
import { hasHardwareAttestationEvidence, type WitnessRecord } from './witnessCredentialUtils'

export type RelationshipLayer =
  | { kind: 'card'; at?: string; hardwareEvidence: boolean; raw: Record<string, unknown> }
  | { kind: 'witnessed'; at?: string; witnessName?: string; inPerson: boolean }

const issuerOf = (raw: { issuer?: unknown }): string | undefined =>
  typeof raw.issuer === 'string' ? raw.issuer : (raw.issuer as { id?: string } | undefined)?.id

export function relationshipLayers(
  records: W3cCredentialRecord[],
  issuerDid: string,
  witnessRecords: WitnessRecord[]
): RelationshipLayer[] {
  const cards: RelationshipLayer[] = []
  for (const record of records) {
    const raw = toRawCredential(record)
    if (!raw || !isPeerVrcCredential(raw) || issuerOf(raw) !== issuerDid) continue
    cards.push({
      kind: 'card',
      at: raw.validFrom ?? raw.issuanceDate,
      hardwareEvidence: hasHardwareAttestationEvidence(record),
      raw,
    })
  }
  const witnessed: RelationshipLayer[] = witnessRecords.map((w) => ({
    kind: 'witnessed',
    at: w.issuanceDate,
    witnessName: w.witnessName,
    inPerson: w.locality?.outcome === 'confirmed',
  }))
  return [...cards, ...witnessed].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
}
