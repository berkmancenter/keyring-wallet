/**
 * The vocabulary guard, promoted from a rung demonstration to a standing
 * check (locality-plan.md §10.3 item 13; the property itself was first
 * proven in tsp-reference/ref-06p-locality-binding act 6). Imports the REAL
 * `@bifold/vrc-contexts` document — not a parallel copy — so a term dropped
 * from the actual context that ships turns this suite red.
 *
 * Why this matters more than a typo check: `bbs-2023` discloses at the
 * RDF-quad level. A `locality*` member with no term defined here is not
 * merely unsigned — it never enters the dataset a derived proof discloses
 * from, so it is undisclosable. This is exactly the defect that was latent
 * in the pre-locality `witnessContext.localityVerification` shape (it
 * nested members — `challenge`, `proofs`, `did`, `sig` — that were never
 * given terms at all), which never fired only because its sole provider
 * was `NullLocalityProvider`.
 */
import jsonld from 'jsonld'

import { WITNESSED_EXCHANGE_CONTEXT_DOCUMENT } from '@bifold/vrc-contexts'

// The full tier 1+2+3 shape a confirmed locality assertion produces
// (assertionFromObservation in witness-server's trustTasks/locality.ts —
// duplicated there per the documentProof.ts sharing pattern, not imported,
// so this test is what keeps the two vocabularies from silently diverging).
const CONFIRMED_ASSERTION = {
  localityConfirmed: true,
  localityMethod: 'ble-challenge-response/0.1',
  localityTopology: 'witness-anchored',
  localitySensor: 'did:peer:4wendy',
  localityVenue: 'Applied Technology Lab, Cambridge MA — Room 2',
  localityObservedAt: '2026-08-21T00:00:00Z',
  localityWindowSeconds: 120,
  localityKeyMatchesCredentialSigner: true,
  localityHardwareAttestation: 'verified',
  localityEvidenceCommitment: 'sha256:abc123',
  localityRttMs: 180,
  localityRssiDbm: -58,
  localityRttBoundMs: 400,
}
const DECLINED_ASSERTION = {
  localityConfirmed: false,
  localityMethod: 'none',
  localityReason: 'windowLost',
}

const TIER1_FIELDS = ['localityConfirmed', 'localityMethod']

function vwcShape(context: unknown, witnessContext: Record<string, unknown>) {
  return {
    '@context': context,
    '@id': 'urn:uuid:11111111-2222-4333-8444-555555555555',
    witnessContext,
  }
}

async function nquads(doc: unknown, opts: Record<string, unknown> = {}) {
  return jsonld.canonize(doc as never, { algorithm: 'URDNA2015', format: 'application/n-quads', ...opts } as never)
}

// The inner term map — WITNESSED_EXCHANGE_CONTEXT_DOCUMENT itself is
// `{ '@context': {...} }`; jsonld's `@context` slot wants the map, not the
// wrapper (passing the wrapper nests an `@context` key inside the context,
// which safe mode correctly rejects as malformed).
const CTX = (WITNESSED_EXCHANGE_CONTEXT_DOCUMENT as { '@context': Record<string, unknown> })['@context']

describe('the real @bifold/vrc-contexts witnessed-exchange context — locality members', () => {
  test('every locality* field in a confirmed assertion has a defined term', async () => {
    const doc = vwcShape(CTX, CONFIRMED_ASSERTION)
    const quads = await nquads(doc)
    for (const field of Object.keys(CONFIRMED_ASSERTION)) {
      // The predicate IRI, not the JSON key, is what appears in the quads —
      // check the vocabulary IRI this context defines for the field, using
      // whatever the term maps to (string form or {'@id': ...} form).
      const term = CTX[field]
      const iri = typeof term === 'string' ? term : (term as { '@id': string })?.['@id']
      expect(iri).toBeDefined()
      expect(quads.includes(iri as string)).toBe(true)
    }
  })

  test('a declined assertion (three fields only) also canonicalizes with every member covered', async () => {
    const doc = vwcShape(CTX, DECLINED_ASSERTION)
    const quads = await nquads(doc)
    for (const field of Object.keys(DECLINED_ASSERTION)) {
      const term = CTX[field]
      const iri = typeof term === 'string' ? term : (term as { '@id': string })?.['@id']
      expect(quads.includes(iri as string)).toBe(true)
    }
  })

  test('a tier-1-only show canonicalizes on its own — every tier-1 quad also appears in the full set', async () => {
    const fullQuads = await nquads(vwcShape(CTX, CONFIRMED_ASSERTION))
    const tier1Only = Object.fromEntries(TIER1_FIELDS.map((k) => [k, (CONFIRMED_ASSERTION as never)[k]]))
    const tier1Quads = await nquads(vwcShape(CTX, tier1Only))
    expect(tier1Quads.split('\n').filter(Boolean).length).toBeGreaterThan(0)
    for (const line of tier1Quads.split('\n').filter(Boolean)) {
      expect(fullQuads.includes(line.split(' ').slice(1).join(' '))).toBe(true)
    }
  })

  test('the vocabulary guard actually guards something: deleting a term drops its member to zero quads', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { localityVenue: _removed, ...remainingTerms } = CTX

    const quads = await nquads(vwcShape(remainingTerms, CONFIRMED_ASSERTION), { safe: false })
    expect(quads.includes(CONFIRMED_ASSERTION.localityVenue)).toBe(false)
    const localityVenuePredicate = 'https://trustoverip.org/credentials/witnessed-exchange#localityVenue'
    expect(quads.includes(localityVenuePredicate)).toBe(false)
  })
})
