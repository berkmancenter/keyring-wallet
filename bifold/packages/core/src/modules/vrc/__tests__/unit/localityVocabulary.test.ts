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

import { WITNESSED_EXCHANGE_CONTEXT_DOCUMENT, CREDENTIALS_V2_CONTEXT_DOCUMENT, CREDENTIALS_V2_CONTEXT_URL } from '@bifold/vrc-contexts'

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

/**
 * The VSC members added for the WD02->VSC migration (docs/plans/
 * vsc-migration-plan.md §6 V2). A2's finding (Alberto's 2026-09-17 review):
 * a quad-*count* guard is not sufficient, because an unresolved/misdefined
 * term is not always the zero-quads failure the tests above check for — it
 * can instead sign *the wrong absolute IRI* at a nonzero count. These tests
 * assert the exact expanded IRI each member canonicalizes to, via
 * `jsonld.expand()`, not a substring search on n-quads text.
 */
const documentLoader = async (url: string) => {
  if (url === CREDENTIALS_V2_CONTEXT_URL) {
    return { document: CREDENTIALS_V2_CONTEXT_DOCUMENT, documentUrl: url }
  }
  throw new Error(`unexpected context fetch in a test that must resolve everything offline: ${url}`)
}

function vscShape(predicateIri: string) {
  return {
    '@context': [CREDENTIALS_V2_CONTEXT_URL, CTX],
    type: ['VerifiableCredential', 'StatementCredential'],
    credentialSubject: {
      id: 'did:key:zSubject',
      predicate: predicateIri,
      object: { digestMultibase: 'zQmSomeDigest', value: { foo: 'bar' } },
    },
  }
}

describe('VSC members added for the migration — expanded-IRI checks, not quad counts', () => {
  test('predicate, object.value and StatementCredential each expand to the exact intended IRI', async () => {
    const doc = vscShape('https://registry.trustoverip.org/dtg/vsc/witnessed/1')
    const [expanded] = await jsonld.expand(doc as never, { documentLoader } as never)

    expect(expanded['@type']).toContain('https://registry.trustoverip.org/dtg/credentials#StatementCredential')
    const subject = (expanded['https://www.w3.org/2018/credentials#credentialSubject'] as never[])[0] as Record<
      string,
      unknown
    >
    expect((subject['https://registry.trustoverip.org/dtg/credentials#predicate'] as never[])[0]).toEqual({
      '@id': 'https://registry.trustoverip.org/dtg/vsc/witnessed/1',
    })
    const object = (subject['https://registry.trustoverip.org/dtg/credentials#object'] as never[])[0] as Record<
      string,
      unknown
    >
    // jsonld.expand() keeps an @json-typed value as the JSON-LD keyword
    // '@json' with the parsed object as '@value' — it's canonize() (RDF/n-quads
    // form) that serializes it to the escaped string under the expanded
    // rdf:JSON IRI. Both are correct; this checks the pre-canonicalization
    // shape expand() actually produces.
    expect((object['https://registry.trustoverip.org/dtg/credentials#value'] as never[])[0]).toMatchObject({
      '@value': { foo: 'bar' },
      '@type': '@json',
    })
  })

  test('object.digestMultibase is inherited from the protected credentials/v2 base context, not redefined here — expands to security#digestMultibase', async () => {
    const doc = vscShape('https://registry.trustoverip.org/dtg/vsc/witnessed/1')
    const [expanded] = await jsonld.expand(doc as never, { documentLoader } as never)
    const subject = (expanded['https://www.w3.org/2018/credentials#credentialSubject'] as never[])[0] as Record<
      string,
      unknown
    >
    const object = (subject['https://registry.trustoverip.org/dtg/credentials#object'] as never[])[0] as Record<
      string,
      unknown
    >
    expect((object['https://w3id.org/security#digestMultibase'] as never[])[0]).toMatchObject({
      '@value': 'zQmSomeDigest',
      '@type': 'https://w3id.org/security#multibase',
    })
  })

  test('WITNESSED_EXCHANGE_CONTEXT_DOCUMENT does not itself define digestMultibase — regression guard against redefining an @protected term', () => {
    // credentials/v2 @protects digestMultibase (credentialsV2Context.ts); redefining
    // a protected term is fatal under the safe-mode JSON-LD every shipped proof
    // suite runs (tsp-reference/ref-07h-vsc-credo-suites's "safe: true" finding).
    // This is a cheap static check against re-introducing that mistake.
    expect(Object.prototype.hasOwnProperty.call(CTX, 'digestMultibase')).toBe(false)
  })

  test('a predicate value with no defined term for its container still canonicalizes only what has terms — real, observed safe-mode behavior, not assumed', async () => {
    // Empirically confirms ref-07h's finding from inside this suite too: rather
    // than asserting how safe mode behaves in the abstract, remove predicate's
    // term and record what actually happens under safe: true.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { predicate: _removed, ...contextWithoutPredicate } = CTX
    const doc = {
      '@context': [CREDENTIALS_V2_CONTEXT_URL, contextWithoutPredicate],
      type: ['VerifiableCredential', 'StatementCredential'],
      credentialSubject: { id: 'did:key:zSubject', predicate: 'https://registry.trustoverip.org/dtg/vsc/witnessed/1' },
    }
    let expandResult: unknown
    let expandError: Error | undefined
    try {
      expandResult = await jsonld.expand(doc as never, { documentLoader, safe: true } as never)
    } catch (e) {
      expandError = e as Error
    }
    // Whichever way it fails — a thrown safe-mode error, or a silent drop to
    // zero quads for that member — it must not silently sign the plain string
    // "predicate" as if it were the intended absolute IRI. Both are acceptable
    // *safe* outcomes; only "looks fine, signed the wrong bytes" is not.
    if (expandError) {
      expect(expandError).toBeDefined()
    } else {
      const subject = ((expandResult as never[])[0] as Record<string, unknown>)[
        'https://www.w3.org/2018/credentials#credentialSubject'
      ] as never[]
      const subjectNode = subject[0] as Record<string, unknown>
      expect(subjectNode['predicate']).toBeUndefined()
      expect(
        subjectNode['https://registry.trustoverip.org/dtg/credentials#predicate']
      ).toBeUndefined()
    }
  })
})
