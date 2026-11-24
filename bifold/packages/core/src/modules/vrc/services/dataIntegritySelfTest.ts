/**
 * Level 2b runtime probe for the Data Integrity suite (dev builds only —
 * see docs/CRYPTO_SUITE_FOLLOWUP.md "Level 2b verify on-device").
 *
 * Exercises the full on-device pipeline that the static Level 2a spike could
 * not: expo-crypto's native SHA-256, askar KMS signing on React Native, and
 * RDFC canonicalization on Hermes. Mirrors production issuance shape: a
 * did:peer:0 issuer (same as vrc-manager) and a VCDM 2.0 credential.
 *
 * Call after agent.initialize(), gated by __DEV__. Creates one throwaway
 * did:peer:0 record per invocation; results go to the agent logger.
 */
import type { Agent } from '@credo-ts/core'
import { ClaimFormat, JsonTransformer, PeerDidNumAlgo, W3cCredential, W3cJsonLdVerifiableCredential } from '@credo-ts/core'

import { DATA_INTEGRITY_PROOF_TYPE, EDDSA_RDFC_2022_CRYPTOSUITE_NAME } from './EddsaRdfc2022DataIntegritySuite'

export interface DataIntegritySelfTestResult {
  ok: boolean
  signMs?: number
  verifyMs?: number
  proof?: Record<string, unknown>
  error?: string
}

export async function runDataIntegritySelfTest(agent: Agent): Promise<DataIntegritySelfTestResult> {
  const logger = agent.config.logger
  try {
    // Same DID shape production VRC issuance uses (vrc-manager)
    const didResult = await agent.dids.create({
      method: 'peer',
      options: {
        numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        createKey: { type: { kty: 'OKP', crv: 'Ed25519' } },
      },
    })
    const did = didResult.didState.did
    const verificationMethod = didResult.didState.didDocument?.verificationMethod?.[0]?.id
    if (!did || !verificationMethod) {
      throw new Error(`DID creation failed: ${JSON.stringify(didResult.didState)}`)
    }

    const credential = JsonTransformer.fromJSON(
      {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        id: `urn:uuid:di-self-test-${Date.now()}`,
        type: ['VerifiableCredential'],
        issuer: did,
        validFrom: new Date().toISOString(),
        credentialSubject: { id: did },
      },
      W3cCredential,
      { validate: false }
    )

    const signStart = Date.now()
    const signed = await agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential,
      proofType: DATA_INTEGRITY_PROOF_TYPE,
      verificationMethod,
    })
    const signMs = Date.now() - signStart

    const signedJson = JsonTransformer.toJSON(signed)
    const proof = signedJson.proof as Record<string, unknown>
    if (proof?.type !== DATA_INTEGRITY_PROOF_TYPE || proof?.cryptosuite !== EDDSA_RDFC_2022_CRYPTOSUITE_NAME) {
      throw new Error(`Unexpected proof shape: ${JSON.stringify(proof)}`)
    }

    const verifyStart = Date.now()
    const verifyResult = await agent.w3cCredentials.verifyCredential({
      credential: signed as W3cJsonLdVerifiableCredential,
    })
    const verifyMs = Date.now() - verifyStart
    if (!verifyResult.isValid) {
      throw new Error(`Verification failed: ${verifyResult.error?.message ?? JSON.stringify(verifyResult.validations)}`)
    }

    // Tamper check: a modified credential must not verify
    const tamperedJson = JsonTransformer.toJSON(signed)
    ;(tamperedJson.credentialSubject as Record<string, unknown>).id = 'did:example:forged'
    const tampered = JsonTransformer.fromJSON(tamperedJson, W3cJsonLdVerifiableCredential, { validate: false })
    const tamperResult = await agent.w3cCredentials.verifyCredential({ credential: tampered })
    if (tamperResult.isValid) {
      throw new Error('Tampered credential unexpectedly verified')
    }

    logger.info(
      `[DI self-test] PASS — ${EDDSA_RDFC_2022_CRYPTOSUITE_NAME} sign ${signMs}ms, verify ${verifyMs}ms, tamper rejected`,
      { proof }
    )
    return { ok: true, signMs, verifyMs, proof }
  } catch (error) {
    const message = (error as Error).message
    logger.error(`[DI self-test] FAIL — ${message}`, { error })
    return { ok: false, error: message }
  }
}
