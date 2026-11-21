/**
 * A record body signed as its author's VTA signs one (eddsa-jcs-2022, `assertionMethod`; vta-sdk `trust_task_sign`),
 * and that author's DID document, for the tests that check who shared a file (`real/files/sender.ts`).
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import { jcsCanonicalize } from '@bifold/trust-tasks'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import type { SenderDidDocument } from '../../real/files/sender'

export interface TestAuthor {
  did: string
  method: string
  document: SenderDidDocument
  secretKey: Uint8Array
}

/** An author with an Ed25519 assertion key, from a one-byte seed. */
export function testAuthor(did: string, seed = 7): TestAuthor {
  const secretKey = new Uint8Array(32).fill(seed)
  const method = `${did}#key-1`
  return {
    did,
    method,
    secretKey,
    document: {
      id: did,
      verificationMethod: [
        {
          id: method,
          type: 'Ed25519VerificationKey2018',
          controller: did,
          publicKeyBase58: TypedArrayEncoder.toBase58(ed25519.getPublicKey(secretKey)),
        } as never,
      ],
      assertionMethod: [method],
    },
  }
}

/** `body` with an eddsa-jcs-2022 proof by `by` (its method; `proof` overrides members of the proof, unsigned). */
export function signBody(
  by: TestAuthor,
  body: Record<string, unknown>,
  proof: Record<string, unknown> = {}
): Record<string, unknown> {
  const config = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: '2026-11-02T12:00:00Z',
    verificationMethod: by.method,
    proofPurpose: 'assertionMethod',
    ...proof,
  }
  const configHash = sha256(new TextEncoder().encode(jcsCanonicalize(config)))
  const bodyHash = sha256(new TextEncoder().encode(jcsCanonicalize(body)))
  const input = new Uint8Array(64)
  input.set(configHash, 0)
  input.set(bodyHash, 32)
  return {
    ...body,
    proof: { ...config, proofValue: `z${TypedArrayEncoder.toBase58(ed25519.sign(input, by.secretKey))}` },
  }
}

/** A resolver that knows these authors only, counting each ask. */
export function resolverOf(...authors: TestAuthor[]) {
  const asked: string[] = []
  const resolve = jest.fn(async (did: string) => {
    asked.push(did)
    const found = authors.find((a) => a.did === did)
    if (!found) throw new Error(`no DID document for ${did}`)
    return found.document
  })
  return { resolve, asked }
}
