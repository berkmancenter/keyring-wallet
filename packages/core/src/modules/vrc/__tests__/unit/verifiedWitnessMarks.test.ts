/**
 * The witness and locality marks are shown for VERIFIED witness credentials
 * only.
 *
 * A witness credential arrives in the wallet by one of two routes. The
 * ceremony routes (`trust-tasks/witnessCeremony.ts`, and the witness-share leg
 * in `trust-tasks/ceremony.ts`) check the credential before storing it — the
 * session binding, and, for a locality claim, that the witness's observation
 * matches the transcript this device itself produced. They mark what they
 * store. Anything else in the wallet is unmarked, whatever it says about
 * itself, and the UI must not present it as witnessed or as confirmed in
 * person.
 *
 * These tests fix that rule at the selector, which is what every screen reads.
 */

import { JsonTransformer, W3cCredentialRecord } from '@credo-ts/core'

import { isWitnessCredential } from '../../credentialTypes'
import {
  WITNESS_VERIFIED_TAG,
  getVerifiedWitnessCredentialsForSubject,
  getWitnessCredentialsForSubject,
} from '../../utils/witnessCredentialUtils'

const SUBJECT = 'did:example:contact-r-did'

/** A credential record as the store really holds one, tags included. */
function record(credential: Record<string, unknown>, tags: Record<string, string> = {}): W3cCredentialRecord {
  const issuanceDate = '2026-10-13T00:00:00Z'
  return JsonTransformer.fromJSON(
    {
      _tags: { claimFormat: 'ldp_vc', issuerId: 'did:example:witness', ...tags },
      type: 'W3cCredentialRecord',
      id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
      createdAt: issuanceDate,
      credential: { issuanceDate, ...credential },
    },
    W3cCredentialRecord
  )
}

const witnessedBody = (subjectId: string, localityConfirmed: boolean) => ({
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
  issuer: 'did:example:witness',
  credentialSubject: {
    id: subjectId,
    witnessContext: {
      localityConfirmed,
      localityMethod: localityConfirmed ? 'ble-challenge-response/0.1' : 'none',
    },
  },
  // A record only round-trips through the store (and `getTags()`) with a
  // proof present; a forged credential would carry one too — its signature is
  // not what is in question here, its provenance is.
  proof: {
    type: 'Ed25519Signature2018',
    created: '2026-10-13T00:00:00Z',
    proofPurpose: 'assertionMethod',
    verificationMethod: 'did:example:witness#key-1',
    jws: 'mock-jws-signature',
  },
})

describe('only a verified witness credential earns the marks', () => {
  it('a credential a peer supplied is not selected, even typed exactly right and claiming locality', () => {
    // Nothing here is malformed: the type is exactly WitnessCredential, the
    // subject names the contact, and it claims a confirmed locality. It is
    // simply not one this device verified, so it earns nothing.
    const unverified = record(witnessedBody(SUBJECT, true))

    expect(getVerifiedWitnessCredentialsForSubject([unverified], SUBJECT)).toEqual([])
  })

  it('a credential the ceremony verified and marked is selected', () => {
    const verified = record(witnessedBody(SUBJECT, true), { [WITNESS_VERIFIED_TAG]: 'true' })

    expect(getVerifiedWitnessCredentialsForSubject([verified], SUBJECT)).toHaveLength(1)
  })

  it('the mark alone is not enough — the subject must still match', () => {
    const verified = record(witnessedBody('did:example:someone-else', true), { [WITNESS_VERIFIED_TAG]: 'true' })

    expect(getVerifiedWitnessCredentialsForSubject([verified], SUBJECT)).toEqual([])
  })

  it('picks only the verified one out of a mixed wallet', () => {
    const verified = record(witnessedBody(SUBJECT, true), { [WITNESS_VERIFIED_TAG]: 'true' })
    const unverified = record(witnessedBody(SUBJECT, true))

    const selected = getVerifiedWitnessCredentialsForSubject([unverified, verified, unverified], SUBJECT)
    expect(selected).toHaveLength(1)
    expect(selected[0].id).toBe(verified.id)
  })

  it('the unverified-inclusive selector still returns everything, so non-display callers are unchanged', () => {
    const verified = record(witnessedBody(SUBJECT, true), { [WITNESS_VERIFIED_TAG]: 'true' })
    const unverified = record(witnessedBody(SUBJECT, true))

    expect(getWitnessCredentialsForSubject([unverified, verified], SUBJECT)).toHaveLength(2)
  })
})

describe('a credential type is matched exactly, not by substring', () => {
  it('a type that merely contains WitnessCredential is not one', () => {
    expect(
      isWitnessCredential({
        type: ['VerifiableCredential', 'NotAWitnessCredentialReally'],
        credentialSubject: { id: SUBJECT },
      })
    ).toBe(false)
  })

  it('the exact type still is one', () => {
    expect(
      isWitnessCredential({
        type: ['VerifiableCredential', 'WitnessCredential'],
        credentialSubject: { id: SUBJECT },
      })
    ).toBe(true)
  })

  it('the expanded IRI form is still one', () => {
    // A loader that hands us expanded JSON-LD names the type by IRI. Matching
    // the bare name alone would silently stop recognizing those.
    expect(
      isWitnessCredential({
        type: ['https://trustoverip.org/credentials/witnessed-exchange#WitnessCredential'],
        credentialSubject: { id: SUBJECT },
      })
    ).toBe(true)
  })

  it('an IRI whose last segment merely contains the name is not one', () => {
    expect(
      isWitnessCredential({
        type: ['https://attacker.example/vocab#NotAWitnessCredentialReally'],
        credentialSubject: { id: SUBJECT },
      })
    ).toBe(false)
  })
})
