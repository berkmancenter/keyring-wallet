/**
 * A store with several relationships per person and no contact links: two pairwise DIDs under one name (a second
 * exchange with the same person), several cards from one DID, and a witnessed contact. Shared by the parity suites.
 */
import { W3cCredentialRecord } from '@credo-ts/core'

import { WITNESS_VERIFIED_TAG } from '../../../../src/modules/vrc/utils/witnessCredentialUtils'
import { createDTGCredential, generateTestDid } from '../fixtures/dtg-credentials'

const HOLDER = generateTestDid('holder')
export const ALICE_FIRST = { id: generateTestDid('alice-first'), name: 'Alice Smith', email: 'alice@example.com' }
export const ALICE_AGAIN = { id: generateTestDid('alice-again'), name: 'Alice Smith', email: 'alice@example.com' }
export const BOB = { id: generateTestDid('bob'), name: 'Bob Jones' }

const card = (issuer: { id: string; name: string; email?: string }, validFrom: string, id: string) =>
  createDTGCredential({ issuer, credentialSubject: { id: HOLDER }, validFrom, createdAt: validFrom, id })

/** A verified witness record naming `subjectId`, its locality confirmed (the shape the screens read). */
const witnessed = (subjectId: string, issuanceDate: string): W3cCredentialRecord =>
  ({
    id: `witness-${subjectId}`,
    getTags: () => ({ [WITNESS_VERIFIED_TAG]: 'true' }),
    encoded: {
      type: ['VerifiableCredential', 'WitnessCredential'],
      issuer: 'did:example:witness',
      issuanceDate,
      credentialSubject: {
        id: subjectId,
        witnessContext: { localityConfirmed: true, localityMethod: 'ble-challenge-response/0.1' },
      },
    },
  }) as unknown as W3cCredentialRecord

export const SEVERAL_RELATIONSHIPS: W3cCredentialRecord[] = [
  card(ALICE_FIRST, '2026-01-05T10:00:00.000Z', 'urn:uuid:alice-first-1'),
  card(ALICE_FIRST, '2026-02-05T10:00:00.000Z', 'urn:uuid:alice-first-2'),
  card(ALICE_AGAIN, '2026-03-05T10:00:00.000Z', 'urn:uuid:alice-again-1'),
  card(BOB, '2026-01-20T10:00:00.000Z', 'urn:uuid:bob-1'),
  witnessed(BOB.id, '2026-01-21T10:00:00.000Z'),
]
