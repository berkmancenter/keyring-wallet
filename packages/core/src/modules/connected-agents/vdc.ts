/**
 * The agent VDC: the owner's DTG Verifiable Delegation Credential for an AI agent they connected, and the agent's
 * acceptance of it (docs/plans/agent-connect-plan.md §3.4).
 *
 * Read against the DTG Credentials specification at `trustoverip/dtgwg-cred-spec` `3fbaeb6` (upstream `main`,
 * 2026-11-24), `spec/body.md`: "Base Structure", "Context Versions", "Digest Encoding", "VDC (Verifiable Delegation
 * Credential)" and "Delegation Edges". The pin in `scripts/openvtc/PINS.json` (`b89f389`, 2026-08-12) predates the
 * VDC section, which is why that commit is named here.
 *
 * What it is here: a record of whose agent this is, never presented in room operations, and carrying no authority
 * (the ACL entry is the authority, §3.3). So this module builds, checks and re-issues; it signs and verifies proofs
 * only through what it is given:
 *
 * - the signer: which VTA task signs a credential as the persona is step 0.1(f) (VTI-Q32), and its fallback is a
 *   Trust Task envelope the VTA signs (D19). TODO(0.1(f)): the real {@link VdcSigner}.
 * - the verifier: a `DataIntegrityProof`. The specification recommends `eddsa-jcs-2022`, which
 *   `@bifold/trust-tasks`' `verifyDocumentProof` checks against an expected controller; the grant's signature
 *   follows whatever 0.1(f) finds.
 *
 * Pure apart from those two: no storage, no network.
 *
 * @module connected-agents/vdc
 */

import { digestBytesEqual, taskDigestMultibase } from '@bifold/trust-tasks'

export const W3C_VC_V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2'
/** Compared as an exact string (Base Structure). `v1` carries no `salt` and MUST NOT (Context Versions). */
export const DTG_CONTEXT_V1 = 'https://registry.trustoverip.org/dtg/context/v1'
export const VDC_CONTEXT = [W3C_VC_V2_CONTEXT, DTG_CONTEXT_V1] as const
export const VDC_TYPE = ['VerifiableCredential', 'DTGCredential', 'DelegationCredential'] as const

/** A VDC lives at most this long (§3.4). */
export const VDC_MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000
/** A grant is re-issued once this little of it remains (§3.4). */
export const VDC_REISSUE_WITHIN_MS = 48 * 60 * 60 * 1000

/** The Keyring-defined scope strings (§3.4), opaque and compared for exact equality. */
export const AGENT_VDC_SCOPE = {
  chat: 'keyring.agent.chat',
  memory: 'keyring.agent.memory',
  roomPresent: 'keyring.agent.room-present',
} as const

export type VdcDelegation = { scope?: string[]; accepts?: string; maxDepth?: number }

/** A VDC without its proof, as it is signed. */
export type UnsignedVdc = {
  '@context': string[]
  type: string[]
  issuer: string
  issuerScope: 'directed'
  validFrom: string
  validUntil: string
  credentialSubject: { id: string; delegation: VdcDelegation }
}

/** A VDC with its proof. */
export type SignedVdc = UnsignedVdc & { proof: unknown }

/** Signs a VDC as `issuer`. TODO(0.1(f)): for the grant, the VTA task that signs as the persona, or D19's envelope. */
export interface VdcSigner {
  sign(credential: UnsignedVdc): Promise<SignedVdc>
}

/** Whether a credential's proof verifies under a key of `expectedController`. */
export type VdcProofVerifier = (credential: Record<string, unknown>, expectedController: string) => Promise<boolean>

/**
 * ISO 8601 to the whole second. `@bifold/trust-tasks`' signer writes whole-second timestamps (`wireTimestamp`), so a
 * credential built with milliseconds would come back from signing with different claims.
 */
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z')

/** The grant's scope (§3.4): chat always; memory when a memory context is set; room-present once a room is added. */
export function vdcScopeFor(options: { memory: boolean; roomAdded: boolean }): string[] {
  return [
    AGENT_VDC_SCOPE.chat,
    ...(options.memory ? [AGENT_VDC_SCOPE.memory] : []),
    ...(options.roomAdded ? [AGENT_VDC_SCOPE.roomPresent] : []),
  ]
}

/**
 * The grant, unsigned (§3.4): issued by the owner's persona to the agent's lasting key `K_a`, `directed`, valid
 * from `now` until the earlier of 7 days later and the ACL entry's expiry. No `credentialStatus` in P0 (expiry alone
 * bounds it), no `maxDepth` (absent: no re-delegation), no `salt` (context `v1`).
 */
export function buildVdcGrant(options: {
  personaDid: string
  agentDid: string
  scope: string[]
  now: number
  /** The ACL entry's `expiresAt` (ISO 8601), when it has one. */
  entryExpiresAt?: string
}): UnsignedVdc {
  if (options.scope.length === 0) throw new Error('a VDC grant states at least one scope entry')
  const sevenDays = options.now + VDC_MAX_VALIDITY_MS
  const entryEnd = options.entryExpiresAt === undefined ? Infinity : Date.parse(options.entryExpiresAt)
  if (Number.isNaN(entryEnd)) throw new Error('the entry expiry is not a date')
  const until = Math.min(sevenDays, entryEnd)
  if (until <= options.now) throw new Error('the entry has already expired: no VDC is issued')
  return {
    '@context': [...VDC_CONTEXT],
    type: [...VDC_TYPE],
    issuer: options.personaDid,
    issuerScope: 'directed',
    validFrom: iso(options.now),
    validUntil: iso(until),
    credentialSubject: { id: options.agentDid, delegation: { scope: [...new Set(options.scope)] } },
  }
}

/**
 * The acceptance, unsigned (§3.4, Delegation Edges): issued by the agent `K_a` to the persona, `directed`, with the
 * grant's `validUntil` and `accepts` = the grant's digest (JCS without `proof`, SHA-256, multihash, base58btc:
 * Digest Encoding, the same four steps as `taskDigestMultibase`), and no `scope`.
 */
export function buildVdcAcceptance(grant: SignedVdc | UnsignedVdc, now: number): UnsignedVdc {
  return {
    '@context': [...VDC_CONTEXT],
    type: [...VDC_TYPE],
    issuer: grant.credentialSubject.id,
    issuerScope: 'directed',
    validFrom: iso(now),
    validUntil: grant.validUntil,
    credentialSubject: {
      id: grant.issuer,
      delegation: { accepts: taskDigestMultibase(grant as unknown as Record<string, unknown>) },
    },
  }
}

export type VdcProblem =
  | 'not-an-object'
  | 'context'
  | 'type'
  | 'issuer-scope'
  | 'valid-from'
  | 'valid-until'
  | 'subject'
  | 'scope'
  | 'grant-carries-accepts'
  | 'acceptance-carries-scope'
  | 'accepts'
  | 'wrong-issuer'
  | 'wrong-subject'
  | 'valid-until-differs'
  | 'too-long'
  | 'outlives-entry'
  | 'accepts-other-grant'
  | 'grant-proof'
  | 'acceptance-proof'

const isDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))

/** Why a credential is not a VDC grant or acceptance as §3.4 builds them, or undefined. Proofs are not checked here. */
export function vdcShapeProblem(value: unknown, role: 'grant' | 'acceptance'): VdcProblem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not-an-object'
  const vc = value as Record<string, unknown>
  const context = vc['@context']
  if (!Array.isArray(context) || context.length !== 2 || context[0] !== VDC_CONTEXT[0] || context[1] !== VDC_CONTEXT[1])
    return 'context'
  const type = vc.type
  if (!Array.isArray(type) || type.length !== VDC_TYPE.length || !VDC_TYPE.every((t) => type.includes(t))) return 'type'
  if (vc.issuerScope !== 'directed') return 'issuer-scope'
  if (!isDate(vc.validFrom)) return 'valid-from'
  if (!isDate(vc.validUntil) || Date.parse(vc.validUntil) <= Date.parse(vc.validFrom)) return 'valid-until'
  const subject = vc.credentialSubject as { id?: unknown; delegation?: unknown } | undefined
  if (!subject || typeof subject.id !== 'string' || typeof vc.issuer !== 'string') return 'subject'
  const delegation = subject.delegation as VdcDelegation | undefined
  if (!delegation || typeof delegation !== 'object') return role === 'grant' ? 'scope' : 'accepts'
  if (role === 'grant') {
    if ('accepts' in delegation) return 'grant-carries-accepts'
    const scope = delegation.scope
    if (!Array.isArray(scope) || scope.length === 0 || !scope.every((s) => typeof s === 'string' && s !== ''))
      return 'scope'
    return undefined
  }
  if ('scope' in delegation) return 'acceptance-carries-scope'
  if (typeof delegation.accepts !== 'string' || delegation.accepts === '') return 'accepts'
  return undefined
}

export type VdcPairCheck = { ok: true } | { ok: false; reason: VdcProblem }

/**
 * Verify a grant and its acceptance as a pair (§3.4, Delegation Edges): each is a VDC of its role; the grant's issuer
 * is the connection's `ownerPersonaDid` and its subject `K_a`, the acceptance's the other way round; both run to the
 * same `validUntil`, at most 7 days after the grant's `validFrom` and not after the entry's expiry; the acceptance's
 * `accepts` is the grant's digest, compared as decoded bytes; and each proof verifies under its issuer.
 *
 * Expiry is not judged here: a lapsed pair still verifies, and is re-issued ({@link shouldReissueVdc}). A connection
 * stays `active` while its pair verifies and its entry was present at the last reconcile (§3.4).
 */
export async function verifyVdcPair(options: {
  grant: unknown
  acceptance: unknown
  ownerPersonaDid: string
  agentDid: string
  entryExpiresAt?: string
  verify: VdcProofVerifier
}): Promise<VdcPairCheck> {
  const fail = (reason: VdcProblem): VdcPairCheck => ({ ok: false, reason })
  const grantProblem = vdcShapeProblem(options.grant, 'grant')
  if (grantProblem) return fail(grantProblem)
  const acceptanceProblem = vdcShapeProblem(options.acceptance, 'acceptance')
  if (acceptanceProblem) return fail(acceptanceProblem)
  const grant = options.grant as SignedVdc
  const acceptance = options.acceptance as SignedVdc
  if (grant.issuer !== options.ownerPersonaDid || acceptance.issuer !== options.agentDid) return fail('wrong-issuer')
  if (grant.credentialSubject.id !== options.agentDid || acceptance.credentialSubject.id !== options.ownerPersonaDid)
    return fail('wrong-subject')
  if (Date.parse(acceptance.validUntil) !== Date.parse(grant.validUntil)) return fail('valid-until-differs')
  if (Date.parse(grant.validUntil) - Date.parse(grant.validFrom) > VDC_MAX_VALIDITY_MS) return fail('too-long')
  if (options.entryExpiresAt !== undefined && Date.parse(grant.validUntil) > Date.parse(options.entryExpiresAt))
    return fail('outlives-entry')
  const expected = taskDigestMultibase(grant as unknown as Record<string, unknown>)
  if (!digestBytesEqual(acceptance.credentialSubject.delegation.accepts as string, expected))
    return fail('accepts-other-grant')
  if (!(await options.verify(grant as unknown as Record<string, unknown>, options.ownerPersonaDid)))
    return fail('grant-proof')
  if (!(await options.verify(acceptance as unknown as Record<string, unknown>, options.agentDid)))
    return fail('acceptance-proof')
  return { ok: true }
}

/** An agent connection's state, as far as re-issuing its VDC is concerned (§3.11). */
export type VdcConnectionState = 'pairing' | 'active' | 'expired' | 'revoking' | 'revoked' | 'notFinished'

/**
 * Whether to re-issue the grant now (§3.4): when 48 hours or less remain (or it has lapsed), only for an `active`
 * connection whose entry is confirmed present (`device/list` by `deviceId`, §3.9), never for `revoking`, `revoked`
 * or `expired`. When to ask (app start, opening the agent list or details, Extend) is the connect screens', step 7.7.
 */
export function shouldReissueVdc(options: {
  state: VdcConnectionState
  entryConfirmedPresent: boolean
  grantValidUntil: string
  now: number
}): boolean {
  if (options.state !== 'active') return false
  if (!options.entryConfirmedPresent) return false
  const until = Date.parse(options.grantValidUntil)
  if (Number.isNaN(until)) return true
  return until - options.now <= VDC_REISSUE_WITHIN_MS
}

/**
 * The connection's state after its VDC lapsed with the phone offline (§3.4): unchanged. A lapsed VDC is replaced at
 * the next opportunity; it is the entry, not the VDC, that ends a connection.
 */
export function stateAfterVdcLapse(state: VdcConnectionState): VdcConnectionState {
  return state
}

/** Sign a grant built by {@link buildVdcGrant}, and refuse a signer that changed what it was asked to sign. */
export async function issueVdc(unsigned: UnsignedVdc, signer: VdcSigner): Promise<SignedVdc> {
  const signed = await signer.sign(unsigned)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof: _proof, ...claims } = signed
  if (taskDigestMultibase(claims) !== taskDigestMultibase(unsigned as unknown as Record<string, unknown>))
    throw new Error('the signer changed the credential it signed')
  if (signed.proof === undefined || signed.proof === null) throw new Error('the signer returned no proof')
  return signed
}
