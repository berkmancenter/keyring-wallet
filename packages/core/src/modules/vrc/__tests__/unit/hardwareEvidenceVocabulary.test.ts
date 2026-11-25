/**
 * Vocabulary guard for the hardware-evidence context, modeled on
 * localityVocabulary.test.ts. Imports the REAL bundled documents — not a
 * parallel copy — so a term dropped from the context that ships turns this
 * suite red.
 *
 * What it proves, in JSON-LD safe mode + URDNA2015:
 * - every evidence variant the wallet emits (biometric and passcode, with and
 *   without the deprecated `biometricMethod`) canonicalizes
 * - every quad predicate or type outside credentials/v2 and the registry
 *   context lives in the declared hardware-evidence namespace (plus the one
 *   dcterms:created term)
 * - a misspelled evidence member throws instead of being silently signed —
 *   which the legacy DTG_CONTEXT_URL `@vocab` did not do
 * - the canonical form is the same under the real registry v1 document and the
 *   earlier two-term stand-in (evidence never touches the other registry terms)
 * - the certificate-chain order is part of the signed bytes
 */
import jsonld from 'jsonld'

import {
  CREDENTIALS_V2_CONTEXT_DOCUMENT,
  CREDENTIALS_V2_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  DTG_CONTEXT_URL,
  HARDWARE_EVIDENCE_CONTEXT_DOCUMENT,
  HARDWARE_EVIDENCE_CONTEXT_URL,
  HARDWARE_EVIDENCE_NAMESPACE,
  REGISTRY_DTG_CONTEXT_DOCUMENT,
  REGISTRY_DTG_CONTEXT_URL,
} from '@bifold/vrc-contexts'

const DOCS: Record<string, unknown> = {
  [CREDENTIALS_V2_CONTEXT_URL]: CREDENTIALS_V2_CONTEXT_DOCUMENT,
  [REGISTRY_DTG_CONTEXT_URL]: REGISTRY_DTG_CONTEXT_DOCUMENT,
  [DTG_CONTEXT_URL]: DTG_CONTEXT_DOCUMENT,
  [HARDWARE_EVIDENCE_CONTEXT_URL]: HARDWARE_EVIDENCE_CONTEXT_DOCUMENT,
}

const loaderWith =
  (overrides: Record<string, unknown> = {}) =>
  async (url: string) => {
    const document = { ...DOCS, ...overrides }[url]
    if (!document) throw new Error(`unexpected context fetch (must resolve offline): ${url}`)
    return { contextUrl: null, documentUrl: url, document }
  }

const canonize = (doc: unknown, overrides?: Record<string, unknown>) =>
  jsonld.canonize(
    doc as never,
    {
      algorithm: 'URDNA2015',
      format: 'application/n-quads',
      documentLoader: loaderWith(overrides),
      safe: true,
      base: null,
    } as never
  )

const BASE_EVIDENCE = {
  id: 'urn:uuid:1b2c3d4e-0000-4000-8000-000000000001',
  created: '2026-09-29T10:00:00Z',
  hardwareBinding: {
    keyStorage: 'SecureEnclave',
    platform: 'ios',
    keyType: 'EC-P256',
    algorithm: 'ECDSA-SHA256',
    publicKey: 'BAAA',
  },
  attestation: { format: 'apple-appattest-v1', certificateChain: ['leaf', 'intermediate', 'root'] },
  signature: { value: 'MEUC', algorithm: 'ECDSA-SHA256', signedContentHash: 'abc' },
}

// The variants HardwareEvidenceBuilder.buildEvidenceBlock emits.
const VARIANTS: Record<string, Record<string, unknown>> = {
  'biometric (authenticationMethod + deprecated biometricMethod)': {
    ...BASE_EVIDENCE,
    type: ['BiometricAttestation', 'HardwareKeyAttestation'],
    authenticationMethod: { type: 'FaceID', authenticatorType: 'platform', userVerification: 'required' },
    biometricMethod: { type: 'FaceID', authenticatorType: 'platform', userVerification: 'required' },
  },
  'device passcode (authenticationMethod only)': {
    ...BASE_EVIDENCE,
    type: ['DeviceAuthentication', 'HardwareKeyAttestation'],
    authenticationMethod: { type: 'DevicePasscode', authenticatorType: 'platform', userVerification: 'required' },
  },
  'legacy biometric (biometricMethod only)': {
    ...BASE_EVIDENCE,
    type: ['BiometricAttestation', 'HardwareKeyAttestation'],
    biometricMethod: { type: 'TouchID', authenticatorType: 'platform', userVerification: 'required' },
  },
}

const vrc = (context: string[], evidence?: unknown) => ({
  '@context': context,
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:2.issuer',
  validFrom: '2026-09-29T10:00:00Z',
  credentialSubject: { id: 'did:peer:2.subject' },
  ...(evidence ? { evidence: [evidence] } : {}),
})

const NEW_CONTEXT = [CREDENTIALS_V2_CONTEXT_URL, REGISTRY_DTG_CONTEXT_URL, HARDWARE_EVIDENCE_CONTEXT_URL]

// Predicates/types the base contexts legitimately contribute.
const ALLOWED_OUTSIDE_NAMESPACE = [
  'https://www.w3.org/2018/credentials#',
  'https://registry.trustoverip.org/dtg/credentials#',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://purl.org/dc/terms/created',
]

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

// Predicate IRIs, plus the class IRIs named by rdf:type quads (node ids such
// as the DIDs and evidence urn:uuid are objects of other predicates, not vocabulary).
const vocabularyIris = (nquads: string): string[] =>
  nquads
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const m = line.match(/^(?:<[^>]*>|_:\S+) <([^>]*)> (<[^>]*>|_:\S+|".*")(?:\^\^<[^>]*>)? (?:<[^>]*> )?\.$/)
      if (!m) return []
      const out = [m[1]]
      if (m[1] === RDF_TYPE && m[2].startsWith('<')) out.push(m[2].slice(1, -1))
      return out
    })

describe('hardware-evidence context vocabulary', () => {
  test('the namespace is declared once and every term points into it', () => {
    const ctx = HARDWARE_EVIDENCE_CONTEXT_DOCUMENT['@context']
    expect(ctx['@protected']).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(ctx, '@vocab')).toBe(false)
    expect(HARDWARE_EVIDENCE_NAMESPACE.startsWith('https://')).toBe(true)
    expect(ctx.BiometricAttestation).toBe(`${HARDWARE_EVIDENCE_NAMESPACE}BiometricAttestation`)
    expect(ctx.DeviceAuthentication).toBe(`${HARDWARE_EVIDENCE_NAMESPACE}DeviceAuthentication`)
    expect(ctx.HardwareKeyAttestation['@id']).toBe(`${HARDWARE_EVIDENCE_NAMESPACE}HardwareKeyAttestation`)
  })

  describe.each(Object.entries(VARIANTS))('evidence variant: %s', (_name, evidence) => {
    test('canonicalizes in safe mode and stays inside the declared namespaces', async () => {
      const nquads = await canonize(vrc(NEW_CONTEXT, evidence))
      const outside = vocabularyIris(nquads).filter(
        (iri) =>
          !iri.startsWith(HARDWARE_EVIDENCE_NAMESPACE) && !ALLOWED_OUTSIDE_NAMESPACE.some((ns) => iri.startsWith(ns))
      )
      // Anything left would be an undeclared vocabulary leaking into the signed graph
      expect(outside).toEqual([])
      // every envelope member the variant carries became a quad in our namespace
      for (const member of ['hardwareBinding', 'attestation', 'signature']) {
        expect(nquads).toContain(`<${HARDWARE_EVIDENCE_NAMESPACE}${member}>`)
      }
      expect(nquads).toContain(
        `<${DCTERMS_CREATED}> "2026-09-29T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`
      )
    })

    test('canonical form does not depend on the registry terms evidence never uses (two-term stand-in gives the same bytes)', async () => {
      const standIn = {
        '@context': {
          '@version': 1.1,
          '@protected': true,
          DTGCredential: 'https://registry.trustoverip.org/dtg/credentials#DTGCredential',
          RelationshipCredential: 'https://registry.trustoverip.org/dtg/credentials#RelationshipCredential',
        },
      }
      const a = await canonize(vrc(NEW_CONTEXT, evidence))
      const b = await canonize(vrc(NEW_CONTEXT, evidence), { [REGISTRY_DTG_CONTEXT_URL]: standIn })
      expect(b).toBe(a)
    })

    test('a misspelled evidence member throws in safe mode', async () => {
      await expect(canonize(vrc(NEW_CONTEXT, { ...evidence, hardwareBindng: { x: 1 } }))).rejects.toThrow()
    })
  })

  test('the legacy DTG_CONTEXT_URL @vocab silently signs the same typo (why it is being replaced)', async () => {
    const legacy = [CREDENTIALS_V2_CONTEXT_URL, REGISTRY_DTG_CONTEXT_URL, DTG_CONTEXT_URL]
    const nquads = await canonize(
      vrc(legacy, { ...VARIANTS['device passcode (authenticationMethod only)'], hardwareBindng: { x: 1 } })
    )
    expect(nquads).toContain('hardwareBindng')
  })

  test('an unknown evidence type does not get the member terms (safe mode rejects the envelope)', async () => {
    await expect(
      canonize(
        vrc(NEW_CONTEXT, { ...BASE_EVIDENCE, type: ['BiometricAttestation'], biometricMethod: { type: 'FaceID' } })
      )
    ).rejects.toThrow()
  })

  test('certificate-chain order is part of the signed bytes (@json preserves array order)', async () => {
    const evidence = VARIANTS['device passcode (authenticationMethod only)']
    const reordered = {
      ...evidence,
      attestation: { format: 'apple-appattest-v1', certificateChain: ['root', 'intermediate', 'leaf'] },
    }
    expect(await canonize(vrc(NEW_CONTEXT, reordered))).not.toBe(await canonize(vrc(NEW_CONTEXT, evidence)))
  })

  describe('issuerScope (cred-spec Base Structure: REQUIRED, pairwise for a VRC)', () => {
    const ISSUER_SCOPE_IRI = 'https://registry.trustoverip.org/dtg/credentials#issuerScope'
    const scoped = (context: string[], evidence?: unknown) => ({ ...vrc(context, evidence), issuerScope: 'pairwise' })

    test('safe-mode URDNA2015 expands it to the registry IRI with no evidence', async () => {
      const nquads = await canonize(scoped(NEW_CONTEXT))
      expect(nquads).toContain(`<${ISSUER_SCOPE_IRI}> "pairwise"`)
      expect(vocabularyIris(nquads).filter((iri) => iri.endsWith('issuerScope'))).toEqual([ISSUER_SCOPE_IRI])
    })

    test.each(Object.entries(VARIANTS))(
      'with evidence variant %s: expands to the registry IRI only (not a firstperson namespace)',
      async (_name, evidence) => {
        const nquads = await canonize(scoped(NEW_CONTEXT, evidence))
        expect(nquads).toContain(`<${ISSUER_SCOPE_IRI}> "pairwise"`)
        expect(vocabularyIris(nquads).filter((iri) => iri.endsWith('issuerScope'))).toEqual([ISSUER_SCOPE_IRI])
        const outside = vocabularyIris(nquads).filter(
          (iri) =>
            !iri.startsWith(HARDWARE_EVIDENCE_NAMESPACE) && !ALLOWED_OUTSIDE_NAMESPACE.some((ns) => iri.startsWith(ns))
        )
        expect(outside).toEqual([])
      }
    )

    test('it is part of the signed bytes: a different scope changes the canonical form', async () => {
      const a = await canonize(scoped(NEW_CONTEXT))
      const b = await canonize({ ...scoped(NEW_CONTEXT), issuerScope: 'public' })
      expect(b).not.toBe(a)
    })

    test('also resolves under the legacy evidence context (older peers)', async () => {
      const legacy = [CREDENTIALS_V2_CONTEXT_URL, REGISTRY_DTG_CONTEXT_URL, DTG_CONTEXT_URL]
      const nquads = await canonize(scoped(legacy))
      expect(nquads).toContain(`<${ISSUER_SCOPE_IRI}> "pairwise"`)
    })
  })

  test('a VRC with no evidence canonicalizes the same with or without the evidence context listed', async () => {
    const withCtx = await canonize(vrc(NEW_CONTEXT))
    const without = await canonize(vrc([CREDENTIALS_V2_CONTEXT_URL, REGISTRY_DTG_CONTEXT_URL]))
    expect(withCtx).toBe(without)
  })
})

const DCTERMS_CREATED = 'http://purl.org/dc/terms/created'
