/**
 * documentProof tests — the RFC 8785 canonicalization and DigestMultibase
 * primitives the issue leg stands on. `signDocumentProof` needs a live KMS
 * and DID resolver, so its behavior is proven by the e2e run rather than
 * mocked into meaninglessness here; the digest math is pure and tested.
 */
import { TypedArrayEncoder } from '@credo-ts/core'

import { digestMultibase, jcsCanonicalize } from '../documentProof'

describe('jcsCanonicalize', () => {
  test('orders members lexicographically and strips insignificant whitespace', () => {
    expect(jcsCanonicalize({ b: 1, a: { d: [2, 3], c: 'x' } })).toBe('{"a":{"c":"x","d":[2,3]},"b":1}')
  })

  test('is insensitive to member insertion order', () => {
    const one = jcsCanonicalize({ x: 1, y: { b: 2, a: 3 } })
    const two = jcsCanonicalize({ y: { a: 3, b: 2 }, x: 1 })
    expect(one).toBe(two)
  })
})

describe('digestMultibase', () => {
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
    issuer: 'did:peer:0zAlice',
    credentialSubject: { id: 'did:peer:0zBob' },
  }

  test('is a base58btc multibase of a sha-256 multihash', () => {
    const digest = digestMultibase(credential)
    expect(digest.startsWith('z')).toBe(true)
    const multihash = TypedArrayEncoder.fromBase58(digest.slice(1))
    // multihash header: 0x12 = sha2-256, 0x20 = 32-byte digest
    expect(multihash[0]).toBe(0x12)
    expect(multihash[1]).toBe(0x20)
    expect(multihash.length).toBe(34)
  })

  test('is stable across member ordering (canonicalization is doing the work)', () => {
    const reordered = {
      credentialSubject: { id: 'did:peer:0zBob' },
      issuer: 'did:peer:0zAlice',
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      '@context': ['https://www.w3.org/ns/credentials/v2'],
    }
    expect(digestMultibase(reordered)).toBe(digestMultibase(credential))
  })

  test('changes when the credential changes', () => {
    expect(digestMultibase({ ...credential, issuer: 'did:peer:0zMallory' })).not.toBe(digestMultibase(credential))
  })
})
