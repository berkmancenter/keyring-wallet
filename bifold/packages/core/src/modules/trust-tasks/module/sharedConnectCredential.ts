/**
 * sharedConnectCredential — the VRC as the shared-connect path issues and
 * verifies it (plan WP8): the explicit credential profile, signed
 * `eddsa-jcs-2022` through the document-proof signer (or `eddsa-rdfc-2022`
 * through Credo when the profile says so), and verified by the suite the
 * proof names rather than always through Credo's JSON-LD verifier, which has
 * no `eddsa-jcs-2022` suite.
 *
 * @module trust-tasks/module/sharedConnectCredential
 */

import { ClaimFormat, JsonTransformer, W3cCredential, W3cJsonLdVerifiableCredential } from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'

import { buildVrcCredential, type VrcProfile } from '../../vrc/vrc-manager'
import { signDocumentProof, verifyDocumentProof } from '../documentProof'

import { SHARED_CONNECT_VRC_PROFILE } from './sharedConnectDecisions'

const JCS = 'eddsa-jcs-2022'

/** The issuer of a credential, whichever way it is written. */
export function vcIssuerId(vc: Record<string, unknown>): string | undefined {
  const issuer = vc.issuer
  if (typeof issuer === 'string') return issuer
  if (issuer && typeof issuer === 'object') return (issuer as { id?: string }).id
  return undefined
}

export function vcSubjectId(vc: Record<string, unknown>): string | undefined {
  const subject = Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
  return (subject as { id?: string } | undefined)?.id
}

/** Build and sign this wallet's VRC for the counterparty, per the profile. */
export async function issueSharedConnectVrc(
  agent: Agent,
  myRelationshipDid: string,
  theirRelationshipDid: string,
  profile: VrcProfile = SHARED_CONNECT_VRC_PROFILE
): Promise<Record<string, unknown>> {
  const { credential } = await buildVrcCredential(agent, myRelationshipDid, theirRelationshipDid, profile)
  if (profile.suite === JCS) return signDocumentProof(agent, credential, myRelationshipDid)
  const didDocument = await agent.dids.resolveDidDocument(myRelationshipDid)
  const verificationMethodId = didDocument.verificationMethod?.[0]?.id
  if (!verificationMethodId) throw new Error('no verification method on the relationship DID')
  const signed = await agent.w3cCredentials.signCredential({
    format: ClaimFormat.LdpVc,
    credential: JsonTransformer.fromJSON(credential, W3cCredential),
    proofType: 'DataIntegrityProof',
    verificationMethod: verificationMethodId,
  })
  return JsonTransformer.toJSON(signed) as Record<string, unknown>
}

const proofOf = (vc: Record<string, unknown>): { cryptosuite?: string } | undefined => {
  const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof
  return proof && typeof proof === 'object' ? (proof as { cryptosuite?: string }) : undefined
}

/** True when the credential's proof names the `eddsa-jcs-2022` suite. */
export const hasJcsProof = (vc: Record<string, unknown>): boolean => proofOf(vc)?.cryptosuite === JCS

/**
 * Verify a received VRC's own proof, by the suite it names: JCS through the
 * document-proof verifier under the credential issuer's DID, anything else
 * through Credo. False rather than a throw.
 */
export async function verifySharedConnectVrc(agent: Agent, vc: Record<string, unknown>): Promise<boolean> {
  try {
    const issuer = vcIssuerId(vc)
    if (!issuer) return false
    // The named key must be one the issuer lists under assertionMethod. Without the purpose, a proof naming
    // `<issuer>#anything` that matched no key fell back to the issuer's first signing key.
    if (hasJcsProof(vc)) return await verifyDocumentProof(agent, vc, issuer, { proofPurpose: 'assertionMethod' })
    const instance = JsonTransformer.fromJSON(vc, W3cJsonLdVerifiableCredential)
    return (await agent.w3cCredentials.verifyCredential({ credential: instance })).isValid
  } catch {
    return false
  }
}
