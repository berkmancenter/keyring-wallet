import { CACHED_SECURITY_CONTEXTS } from '../../types/cachedSecurityContexts'

const EXPECTED_URLS = [
  'https://w3id.org/security/suites/x25519-2019/v1',
  'https://w3id.org/security/suites/ed25519-2018/v1',
  'https://w3id.org/did/v1',
  'https://www.w3.org/ns/did/v1',
  'https://w3.org/ns/did/v1',
  'https://www.w3.org/2018/credentials/v1',
]

describe('CACHED_SECURITY_CONTEXTS', () => {
  it('should contain all expected URLs', () => {
    for (const url of EXPECTED_URLS) {
      expect(CACHED_SECURITY_CONTEXTS[url]).toBeDefined()
    }
  })

  it('should not contain unexpected entries', () => {
    expect(Object.keys(CACHED_SECURITY_CONTEXTS)).toHaveLength(EXPECTED_URLS.length)
  })

  describe.each(EXPECTED_URLS)('%s', (url) => {
    it('should have a top-level @context object', () => {
      const doc = CACHED_SECURITY_CONTEXTS[url] as Record<string, any>
      expect(doc['@context']).toBeDefined()
      expect(typeof doc['@context']).toBe('object')
    })
  })

  describe('x25519-2019/v1', () => {
    const ctx = (CACHED_SECURITY_CONTEXTS['https://w3id.org/security/suites/x25519-2019/v1'] as any)['@context']

    it('should define X25519KeyAgreementKey2019', () => {
      expect(ctx['X25519KeyAgreementKey2019']).toBeDefined()
      expect(ctx['X25519KeyAgreementKey2019']['@id']).toContain('X25519KeyAgreementKey2019')
    })

    it('should include publicKeyBase58 in the key context', () => {
      const keyCtx = ctx['X25519KeyAgreementKey2019']['@context']
      expect(keyCtx['publicKeyBase58']).toBeDefined()
    })
  })

  describe('ed25519-2018/v1', () => {
    const ctx = (CACHED_SECURITY_CONTEXTS['https://w3id.org/security/suites/ed25519-2018/v1'] as any)['@context']

    it('should define Ed25519VerificationKey2018', () => {
      expect(ctx['Ed25519VerificationKey2018']).toBeDefined()
      expect(ctx['Ed25519VerificationKey2018']['@id']).toContain('Ed25519VerificationKey2018')
    })

    it('should define Ed25519Signature2018', () => {
      expect(ctx['Ed25519Signature2018']).toBeDefined()
      expect(ctx['Ed25519Signature2018']['@id']).toContain('Ed25519Signature2018')
    })

    it('should define proof term', () => {
      expect(ctx['proof']).toBeDefined()
      expect(ctx['proof']['@type']).toBe('@id')
    })

    it('should define proofPurpose with assertion and authentication methods', () => {
      const sigCtx = ctx['Ed25519Signature2018']['@context']
      const purposeCtx = sigCtx['proofPurpose']['@context']

      expect(purposeCtx['assertionMethod']).toBeDefined()
      expect(purposeCtx['authentication']).toBeDefined()
      expect(purposeCtx['capabilityInvocation']).toBeDefined()
      expect(purposeCtx['capabilityDelegation']).toBeDefined()
      expect(purposeCtx['keyAgreement']).toBeDefined()
    })
  })

  describe('DID contexts (all three variants)', () => {
    const didUrls = ['https://w3id.org/did/v1', 'https://www.w3.org/ns/did/v1', 'https://w3.org/ns/did/v1']

    it.each(didUrls)('%s should define core DID document terms', (url) => {
      const ctx = (CACHED_SECURITY_CONTEXTS[url] as any)['@context']

      expect(ctx['assertionMethod']).toBeDefined()
      expect(ctx['authentication']).toBeDefined()
      expect(ctx['capabilityDelegation']).toBeDefined()
      expect(ctx['capabilityInvocation']).toBeDefined()
      expect(ctx['controller']).toBeDefined()
      expect(ctx['keyAgreement']).toBeDefined()
      expect(ctx['verificationMethod']).toBeDefined()
      expect(ctx['service']).toBeDefined()
    })

    it('all DID context variants should have identical content', () => {
      const v1 = CACHED_SECURITY_CONTEXTS['https://w3id.org/did/v1']
      const nsV1 = CACHED_SECURITY_CONTEXTS['https://www.w3.org/ns/did/v1']
      const w3OrgV1 = CACHED_SECURITY_CONTEXTS['https://w3.org/ns/did/v1']

      expect(v1).toEqual(nsV1)
      expect(v1).toEqual(w3OrgV1)
    })
  })

  describe('W3C Credentials v1 (https://www.w3.org/2018/credentials/v1)', () => {
    const ctx = (CACHED_SECURITY_CONTEXTS['https://www.w3.org/2018/credentials/v1'] as any)['@context']

    it('should define VerifiableCredential', () => {
      expect(ctx['VerifiableCredential']).toBeDefined()
      expect(ctx['VerifiableCredential']['@id']).toContain('VerifiableCredential')
    })

    it('should define VerifiablePresentation', () => {
      expect(ctx['VerifiablePresentation']).toBeDefined()
      expect(ctx['VerifiablePresentation']['@id']).toContain('VerifiablePresentation')
    })

    it('should define Ed25519Signature2018 within the VC context', () => {
      expect(ctx['Ed25519Signature2018']).toBeDefined()
      expect(ctx['Ed25519Signature2018']['@id']).toContain('Ed25519Signature2018')
    })

    it('should define core credential terms (issuer, credentialSubject, proof)', () => {
      const vcCtx = ctx['VerifiableCredential']['@context']
      expect(vcCtx['issuer']).toBeDefined()
      expect(vcCtx['credentialSubject']).toBeDefined()
      expect(vcCtx['proof']).toBeDefined()
      expect(vcCtx['issuanceDate']).toBeDefined()
      expect(vcCtx['expirationDate']).toBeDefined()
    })

    it('should have @version 1.1', () => {
      expect(ctx['@version']).toBe(1.1)
    })
  })
})
