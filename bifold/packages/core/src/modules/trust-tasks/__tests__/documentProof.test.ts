/**
 * documentProof tests — the RFC 8785 canonicalization and DigestMultibase
 * primitives the issue leg stands on. `signDocumentProof` needs a live KMS
 * and DID resolver, so its behavior is proven by the e2e run rather than
 * mocked into meaninglessness here; the digest math is pure and tested.
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { digestMultibase, jcsCanonicalize, verifyDocumentProof } from '../documentProof'

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

describe('verifyDocumentProof', () => {
  // A real Ed25519 keypair; the DID document resolves to its Multikey form
  // (multicodec 0xed01 + raw key, base58btc) — the shape did:peer:0 yields.
  const secretKey = new Uint8Array(32).fill(7)
  const publicKey = ed25519.getPublicKey(secretKey)
  const multikey = (() => {
    const prefixed = new Uint8Array(2 + publicKey.length)
    prefixed.set([0xed, 0x01], 0)
    prefixed.set(publicKey, 2)
    return `z${TypedArrayEncoder.toBase58(prefixed)}`
  })()
  const controller = `did:peer:0${multikey}`
  const verificationMethodId = `${controller}#${multikey}`
  const fakeAgent = {
    dids: {
      resolveDidDocument: async () => ({
        verificationMethod: [
          { id: verificationMethodId, type: 'Multikey', controller, publicKeyMultibase: multikey },
        ],
      }),
    },
  } as never

  const signedDocument = (mutate?: (doc: Record<string, unknown>) => void) => {
    const document: Record<string, unknown> = {
      id: 'ffff1111-0000-4000-8000-00000000000f',
      type: 'https://trusttasks.org/spec/vrc/relationships/issue/0.1',
      threadId: 'ffff1111-0000-4000-8000-00000000000f',
      issuer: 'did:peer:4aaa',
      recipient: 'did:peer:4zzz',
      issuedAt: '2026-08-18T00:00:00Z',
      payload: { vrc: { hello: 'world' }, vrcDigestMultibase: digestMultibase({ hello: 'world' }) },
    }
    const proofConfig = {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      created: '2026-08-18T00:00:00Z',
      verificationMethod: verificationMethodId,
      proofPurpose: 'assertionMethod',
    }
    const configHash = sha256(new TextEncoder().encode(jcsCanonicalize(proofConfig)))
    const documentHash = sha256(new TextEncoder().encode(jcsCanonicalize(document)))
    const signedInput = new Uint8Array(configHash.length + documentHash.length)
    signedInput.set(configHash, 0)
    signedInput.set(documentHash, configHash.length)
    const signature = ed25519.sign(signedInput, secretKey)
    const signed = { ...document, proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(signature)}` } }
    if (mutate) mutate(signed)
    return signed
  }

  test('a valid proof under the expected controller verifies', async () => {
    expect(await verifyDocumentProof(fakeAgent, signedDocument(), controller)).toBe(true)
  })

  test('a tampered document fails', async () => {
    const doc = signedDocument((d) => {
      ;(d.payload as { vrc: Record<string, unknown> }).vrc = { hello: 'tampered' }
    })
    expect(await verifyDocumentProof(fakeAgent, doc, controller)).toBe(false)
  })

  test('a proof under a different controller fails even if the signature is valid', async () => {
    expect(await verifyDocumentProof(fakeAgent, signedDocument(), 'did:peer:0zSomebodyElse')).toBe(false)
  })

  test('a proofless document fails', async () => {
    const { proof: _proof, ...bare } = signedDocument()
    expect(await verifyDocumentProof(fakeAgent, bare, controller)).toBe(false)
  })

  test('a wrong cryptosuite fails', async () => {
    const doc = signedDocument((d) => {
      ;(d.proof as Record<string, unknown>).cryptosuite = 'eddsa-rdfc-2022'
    })
    expect(await verifyDocumentProof(fakeAgent, doc, controller)).toBe(false)
  })
})
