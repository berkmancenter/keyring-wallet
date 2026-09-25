/**
 * vtiEligibility — a vetter's eligibility presentation (`eligibilityVp` on a
 * `vetting/request#response`), built and judged as the spec and the VTI SDK
 * do it.
 *
 * The spec (dtgwg-trust-tasks-tf `specs/vetting/request/0.1/spec.md:105-113`,
 * at bdae1cf9): `holder` is the vetter; `nonce` is the `id` of the request
 * document it answers and `domain` that request's `joinDid`; the credentials
 * include the community's `CommunityRole` endorsement naming the vetter in the
 * manifest's `eligibleVetters.role`; the proof is by `holder` for
 * `authentication`. The applicant's check (spec.md:113) is advisory.
 *
 * The check is a port of vta-sdk `vetting/eligibility.rs` `verify_eligibility_vp`
 * (:252-354, at VTI ed672fff), the function an openvtc applicant runs
 * (openvtc-core `vetting/inbound.rs:607-620`, at ed13d29), in its order:
 * presentation type, holder, nonce, domain, the presentation's proof
 * (`authentication`), then each CommunityRole credential for this community
 * and role — issuer, subject, a bounded validity window with the SDK's clock
 * skew, the community's proof (`assertionMethod`). Revocation is left to the
 * caller, which gets the verified credential's `credentialStatus`, as upstream
 * leaves it (`VerifiedEligibility::credential_status`).
 *
 * One deliberate addition: Keyring vetters up to build 223 presented with
 * `nonce` = their own desk uuid (echoed as the response's `requestId`) and an
 * `assertionMethod` proof. That exact shape is accepted, logged as legacy,
 * until {@link LEGACY_ELIGIBILITY_UNTIL}; nothing else gets a second path.
 *
 * @module trust-tasks/module/vtiEligibility
 */

import type { Agent } from '@credo-ts/core'
import { signDocumentProof, verifyDocumentProof } from '@bifold/trust-tasks'

import { COMMUNITY_ROLE_ENDORSEMENT_TYPE } from './vtiInbox'

/** vta-sdk `vetting/eligibility.rs:43` `ELIGIBILITY_PROOF_PURPOSE`. */
export const ELIGIBILITY_PROOF_PURPOSE = 'authentication'
/** The role a community's requirements name when they name none (openvtc `applicant.rs:619-623` `vetter_role`). */
export const VETTER_ROLE = 'vetter'
/** vta-sdk `vetting/card.rs:45` `CLOCK_SKEW`, applied to the grant's window at eligibility.rs:332. */
export const ELIGIBILITY_CLOCK_SKEW_MS = 60 * 1000
/**
 * After this day a presentation in the pre-224 Keyring shape is refused like
 * any other that does not verify. Every Keyring vetter should have updated by
 * then; the date is the whole of the policy, so moving it is a code change.
 */
export const LEGACY_ELIGIBILITY_UNTIL = '2026-11-01'

const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2'

/** What the applicant expects the presentation to prove (vta-sdk `EligibilityExpectations`, eligibility.rs:128-143). */
export interface EligibilityExpectations {
  /** The vetter the request was sent to — the response's issuer. */
  vetter: string
  /** The community being joined. */
  community: string
  /** The manifest's `eligibleVetters.role`. */
  role: string
  /** The `id` of the applicant's `vetting/request` document. */
  challenge: string
  /** The applicant's `joinDid` from that request. */
  domain: string
  now: Date
  /**
   * The response's `requestId`: what a Keyring vetter up to 223 put in
   * `nonce`. Only used to recognise that shape; absent, there is no legacy path.
   */
  legacyRequestId?: string
}

/**
 * Why a presentation did not show eligibility — the codes a screen words.
 * `legacyExpired` is the pre-224 Keyring shape after {@link LEGACY_ELIGIBILITY_UNTIL}.
 */
export type EligibilityRefusal =
  | 'malformed'
  | 'holder'
  | 'nonce'
  | 'domain'
  | 'proof'
  | 'noRoleCredential'
  | 'grantIssuer'
  | 'grantSubject'
  | 'grantMalformed'
  | 'grantExpired'
  | 'grantProof'
  | 'legacyExpired'

export type EligibilityResult =
  | {
      ok: true
      credential: Record<string, unknown>
      credentialId?: string
      validFrom: string
      validUntil: string
      /** For the caller's revocation check. */
      credentialStatus?: unknown
      /** Set when accepted in the pre-224 Keyring shape: why it was recognised as such. */
      legacy?: string
    }
  | { ok: false; reason: EligibilityRefusal; detail: string }

/** vta-sdk `protocols/vetting.rs:227` `role_matches`: `vetter` and `custom:vetter` are one role; others match exactly. */
export function roleMatches(held: string, required: string): boolean {
  const bare = (role: string) => (role.startsWith('custom:') ? role.slice('custom:'.length) : role)
  return held === required || (bare(held) === VETTER_ROLE && bare(required) === VETTER_ROLE)
}

/** vta-sdk `eligibility.rs:56` `community_role`: `(communityDid, role)` of a CommunityRole credential, shape only. */
export function communityRole(credential: unknown): { communityDid: string; role: string } | undefined {
  if (!credential || typeof credential !== 'object') return undefined
  const c = credential as Record<string, unknown>
  const types = ([] as unknown[]).concat(c.type ?? [])
  if (!types.includes('EndorsementCredential')) return undefined
  const endorsement = (c.credentialSubject as { endorsement?: Record<string, unknown> } | undefined)?.endorsement
  if (endorsement?.type !== COMMUNITY_ROLE_ENDORSEMENT_TYPE) return undefined
  if (typeof endorsement.communityDid !== 'string' || typeof endorsement.role !== 'string') return undefined
  return { communityDid: endorsement.communityDid, role: endorsement.role }
}

/**
 * Build the presentation per spec, as vta-sdk `build_eligibility_vp`
 * (eligibility.rs:87-124) does: `nonce` the request document's `id`,
 * `domain` its `joinDid`, signed by the holder for `authentication`.
 */
export async function buildEligibilityPresentation(
  agent: Agent,
  holder: { did: string; kmsKeyId?: string; verificationMethodId?: string },
  credentials: Record<string, unknown>[],
  binding: { nonce: string; domain: string }
): Promise<Record<string, unknown>> {
  const vp = {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiablePresentation'],
    holder: holder.did,
    verifiableCredential: credentials,
    nonce: binding.nonce,
    domain: binding.domain,
  }
  return signDocumentProof(agent, vp, holder.did, {
    kmsKeyId: holder.kmsKeyId,
    verificationMethodId: holder.verificationMethodId,
    proofPurpose: ELIGIBILITY_PROOF_PURPOSE,
  })
}

const refuse = (reason: EligibilityRefusal, detail: string): EligibilityResult => ({ ok: false, reason, detail })

/**
 * Judge an eligibility presentation — the port of `verify_eligibility_vp`
 * (eligibility.rs:252-304). Returns the first failed check; when several
 * candidate credentials fail, the first one's reason, as upstream does.
 */
export async function verifyEligibilityPresentation(
  agent: Agent,
  vp: Record<string, unknown>,
  expect: EligibilityExpectations
): Promise<EligibilityResult> {
  const types = ([] as unknown[]).concat(vp.type ?? [])
  if (typeof vp.holder !== 'string' || !Array.isArray(vp.verifiableCredential ?? []))
    return refuse('malformed', 'no holder, or verifiableCredential is not a list')
  if (!types.includes('VerifiablePresentation'))
    return refuse('malformed', 'type does not include VerifiablePresentation')
  if (vp.holder !== expect.vetter) return refuse('holder', `holder ${vp.holder} is not the vetter asked`)

  const purpose = (vp.proof as { proofPurpose?: unknown } | undefined)?.proofPurpose
  // The pre-224 Keyring shape, recognised exactly: its nonce is the vetter's
  // own requestId (echoed in the response), its proof is for assertionMethod,
  // and its domain is still the applicant. An openvtc presentation can never
  // look like this — its nonce is our request id.
  const legacyShape =
    !!expect.legacyRequestId &&
    vp.nonce === expect.legacyRequestId &&
    vp.nonce !== expect.challenge &&
    purpose === 'assertionMethod' &&
    vp.domain === expect.domain
  let legacy: string | undefined
  if (legacyShape) {
    if (expect.now.getTime() >= Date.parse(`${LEGACY_ELIGIBILITY_UNTIL}T00:00:00Z`))
      return refuse(
        'legacyExpired',
        `the pre-224 Keyring presentation shape is refused from ${LEGACY_ELIGIBILITY_UNTIL}`
      )
    if (!(await verifyDocumentProof(agent, vp, expect.vetter)))
      return refuse('proof', 'the presentation proof does not verify under the vetter')
    legacy = `nonce is the vetter's requestId (${expect.legacyRequestId}), not our request id, and the proof is for assertionMethod — a Keyring vetter up to build 223`
  } else {
    if (vp.nonce !== expect.challenge) return refuse('nonce', 'nonce is not the id of the request we sent')
    if (vp.domain !== expect.domain) return refuse('domain', 'domain is not our join DID')
    if (purpose !== ELIGIBILITY_PROOF_PURPOSE)
      return refuse('proof', `proofPurpose ${String(purpose)}, expected ${ELIGIBILITY_PROOF_PURPOSE}`)
    if (!(await verifyDocumentProof(agent, vp, expect.vetter, { proofPurpose: ELIGIBILITY_PROOF_PURPOSE })))
      return refuse('proof', 'the presentation proof does not verify under an authentication key of the vetter')
  }

  let first: EligibilityResult | undefined
  for (const credential of (vp.verifiableCredential as unknown[]) ?? []) {
    const named = communityRole(credential)
    if (!named || named.communityDid !== expect.community || !roleMatches(named.role, expect.role)) continue
    const verdict = await verifyRoleCredential(agent, credential as Record<string, unknown>, expect)
    if (verdict.ok) return legacy ? { ...verdict, legacy } : verdict
    first ??= verdict
  }
  return first ?? refuse('noRoleCredential', `no ${expect.role} credential from the community names this vetter`)
}

/** vta-sdk `eligibility.rs:306-354` `verify_role_credential`. */
async function verifyRoleCredential(
  agent: Agent,
  credential: Record<string, unknown>,
  expect: EligibilityExpectations
): Promise<EligibilityResult> {
  const issuer =
    typeof credential.issuer === 'string' ? credential.issuer : (credential.issuer as { id?: string } | undefined)?.id
  const subjectId = (credential.credentialSubject as { id?: unknown } | undefined)?.id
  const validFrom = Date.parse(String(credential.validFrom ?? ''))
  if (typeof issuer !== 'string' || typeof subjectId !== 'string' || !Number.isFinite(validFrom))
    return refuse('grantMalformed', 'the role credential has no issuer, subject or validFrom')
  if (issuer !== expect.community) return refuse('grantIssuer', 'the role credential was not issued by the community')
  if (subjectId !== expect.vetter) return refuse('grantSubject', 'the role credential names someone else')
  const validUntil = Date.parse(String(credential.validUntil ?? ''))
  if (!Number.isFinite(validUntil)) return refuse('grantMalformed', 'no validUntil — a role grant is bounded')
  const now = expect.now.getTime()
  if (validFrom > now + ELIGIBILITY_CLOCK_SKEW_MS || now > validUntil + ELIGIBILITY_CLOCK_SKEW_MS)
    return refuse('grantExpired', 'the role credential is outside its validity window')
  if (!(await verifyDocumentProof(agent, credential, issuer)))
    return refuse('grantProof', "the role credential's proof does not verify under the community")
  return {
    ok: true,
    credential,
    credentialId: typeof credential.id === 'string' ? credential.id : undefined,
    validFrom: String(credential.validFrom),
    validUntil: String(credential.validUntil),
    credentialStatus: credential.credentialStatus,
  }
}
