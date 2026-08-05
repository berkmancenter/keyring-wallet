/**
 * VCDM 2.0 acceptance conformance (DTG spec: verifiers MUST support VC 2.0).
 *
 * Credo 0.6's W3cCredential model is v1.1-only out of the box: its @context
 * validator requires the v1.1 URL first and issuanceDate is mandatory. Our
 * yarn patch (@credo-ts-core-npm-0.6.3-*.patch) relaxes both so v2-context
 * JSON-LD credentials flow through the DIDComm jsonld format. These tests
 * pin the patched behavior — they FAIL if the patch is dropped (e.g. after
 * a credo upgrade) without an equivalent upstream fix.
 */
import { JsonTransformer, W3cCredential } from '@credo-ts/core'
import { CREDENTIALS_V2_CONTEXT_URL, CREDENTIALS_V2_CONTEXT_DOCUMENT } from '@bifold/vrc-contexts'

import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from '../../../src/modules/vrc/types/relationshipContext'
import { CUSTOM_CONTEXTS } from '../../../src/modules/vrc/jsonLdDocumentLoader'

const CREDENTIALS_V1_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1'

const baseCredential = {
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: 'did:peer:2.Ez6LSissuer000000000',
  credentialSubject: {
    id: 'did:peer:2.Ez6LSsubject00000000',
  },
}

describe('VCDM 2.0 credential acceptance (patched @credo-ts/core)', () => {
  test('accepts a v2-context credential with validFrom/validUntil and no issuanceDate', () => {
    const json = {
      ...baseCredential,
      '@context': [CREDENTIALS_V2_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2027-01-01T00:00:00Z',
    }

    const credential = JsonTransformer.fromJSON(json, W3cCredential)

    expect(credential.contexts[0]).toBe(CREDENTIALS_V2_CONTEXT_URL)
    expect(credential.issuerId).toBe(baseCredential.issuer)
    expect(credential.issuanceDate).toBeUndefined()
  })

  test('still accepts a v1.1-context credential with issuanceDate', () => {
    const json = {
      ...baseCredential,
      '@context': [CREDENTIALS_V1_CONTEXT_URL, DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      issuanceDate: '2026-01-01T00:00:00Z',
    }

    const credential = JsonTransformer.fromJSON(json, W3cCredential)

    expect(credential.contexts[0]).toBe(CREDENTIALS_V1_CONTEXT_URL)
    expect(credential.issuanceDate).toBe('2026-01-01T00:00:00Z')
  })

  test('rejects a credential whose first context is neither v1.1 nor v2', () => {
    const json = {
      ...baseCredential,
      '@context': [DTG_CONTEXT_URL, CREDENTIALS_V1_CONTEXT_URL],
      issuanceDate: '2026-01-01T00:00:00Z',
    }

    expect(() => JsonTransformer.fromJSON(json, W3cCredential)).toThrow()
  })

  test('rejects a malformed issuanceDate even though the field is optional', () => {
    const json = {
      ...baseCredential,
      '@context': [CREDENTIALS_V1_CONTEXT_URL, DTG_CONTEXT_URL],
      issuanceDate: 'not-a-date',
    }

    expect(() => JsonTransformer.fromJSON(json, W3cCredential)).toThrow()
  })
})

describe('VCDM 2.0 context bundling', () => {
  test('the bundled v2 context document is the W3C base context', () => {
    expect(CREDENTIALS_V2_CONTEXT_URL).toBe('https://www.w3.org/ns/credentials/v2')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (CREDENTIALS_V2_CONTEXT_DOCUMENT as any)['@context']
    expect(context['@protected']).toBe(true)
    expect(context.VerifiableCredential).toBeDefined()
    // validFrom/validUntil live in the VerifiableCredential scoped context
    const scoped = context.VerifiableCredential['@context']
    expect(scoped.validFrom).toBeDefined()
    expect(scoped.validUntil).toBeDefined()
  })

  test('CUSTOM_CONTEXTS resolves the v2 context URL offline', () => {
    expect(CUSTOM_CONTEXTS[CREDENTIALS_V2_CONTEXT_URL]).toBe(CREDENTIALS_V2_CONTEXT_DOCUMENT)
  })
})
