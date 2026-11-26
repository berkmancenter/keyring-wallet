/**
 * The agent VDC (plan §3.4, step 7.3), against the DTG Credentials specification at `dtgwg-cred-spec` `3fbaeb6`.
 * Proofs go through a fake signer and verifier until step 0.1(f) names the VTA task that signs as the persona; the
 * digest the acceptance carries is recomputed here from the specification's four steps, independently of the code.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'

import {
  AGENT_VDC_SCOPE,
  DTG_CONTEXT_V1,
  SignedVdc,
  UnsignedVdc,
  VDC_CONTEXT,
  VDC_MAX_VALIDITY_MS,
  VDC_TYPE,
  VdcProofVerifier,
  VdcSigner,
  W3C_VC_V2_CONTEXT,
  buildVdcAcceptance,
  buildVdcGrant,
  issueVdc,
  shouldReissueVdc,
  stateAfterVdcLapse,
  vdcScopeFor,
  vdcShapeProblem,
  verifyVdcPair,
} from '../vdc'

const PERSONA = 'did:webvh:QmPersona:persona.example.org'
const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const OTHER = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'
const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-25T12:00:00Z')

/** A fake signature: the issuer and the claims' canonical form, so changing either breaks it. */
const fakeProofValue = (issuer: string, claims: unknown) => `fake:${issuer}:${canonicalize(claims)}`

const signer: VdcSigner = {
  async sign(credential: UnsignedVdc): Promise<SignedVdc> {
    // A signer signs the claims: any proof a test left on the credential is dropped first.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { proof: _old, ...claims } = credential as UnsignedVdc & { proof?: unknown }
    return {
      ...claims,
      proof: {
        type: 'DataIntegrityProof',
        cryptosuite: 'eddsa-jcs-2022',
        proofValue: fakeProofValue(claims.issuer, claims),
      },
    }
  },
}

const verify: VdcProofVerifier = async (credential, expectedController) => {
  const { proof, ...claims } = credential as { proof?: { proofValue?: string } }
  return proof?.proofValue === fakeProofValue(expectedController, claims)
}

/** The specification's Digest Encoding, written out here: JCS without `proof`, SHA-256, multihash, then a base. */
function specDigestBytes(credential: Record<string, unknown>): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof: _p, ...claims } = credential
  const hash = sha256(new TextEncoder().encode(canonicalize(claims) as string))
  return Uint8Array.from([0x12, 0x20, ...hash])
}
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

async function pair(over: { scope?: string[]; entryExpiresAt?: string } = {}) {
  const grant = await issueVdc(
    buildVdcGrant({
      personaDid: PERSONA,
      agentDid: K_A,
      scope: over.scope ?? vdcScopeFor({ memory: true, roomAdded: false }),
      now: NOW,
      entryExpiresAt: over.entryExpiresAt,
    }),
    signer
  )
  const acceptance = await issueVdc(buildVdcAcceptance(grant, NOW + 60_000), signer)
  return { grant, acceptance }
}

const check = (grant: unknown, acceptance: unknown, entryExpiresAt?: string) =>
  verifyVdcPair({ grant, acceptance, ownerPersonaDid: PERSONA, agentDid: K_A, entryExpiresAt, verify })

describe('the grant and its acceptance verify', () => {
  it('with the context, types, scope and validity of §3.4', async () => {
    const { grant, acceptance } = await pair({ entryExpiresAt: '2026-11-25T16:00:00Z' })
    expect(await check(grant, acceptance, '2026-11-25T16:00:00Z')).toEqual({ ok: true })
    expect(grant['@context']).toEqual([W3C_VC_V2_CONTEXT, DTG_CONTEXT_V1])
    expect(grant.type).toEqual(['VerifiableCredential', 'DTGCredential', 'DelegationCredential'])
    expect(grant).toMatchObject({
      issuer: PERSONA,
      issuerScope: 'directed',
      validFrom: '2026-11-25T12:00:00Z',
      credentialSubject: { id: K_A, delegation: { scope: ['keyring.agent.chat', 'keyring.agent.memory'] } },
    })
    expect(grant.credentialSubject.delegation).not.toHaveProperty('maxDepth')
    expect(grant).not.toHaveProperty('credentialStatus')
    expect(grant).not.toHaveProperty('salt')
    expect(acceptance).toMatchObject({ issuer: K_A, issuerScope: 'directed', credentialSubject: { id: PERSONA } })
    expect(acceptance.credentialSubject.delegation).not.toHaveProperty('scope')
  })

  it('validUntil is the earlier of 7 days and the entry expiry', async () => {
    expect((await pair({ entryExpiresAt: '2026-11-25T16:00:00Z' })).grant.validUntil).toBe('2026-11-25T16:00:00Z')
    expect((await pair()).grant.validUntil).toBe(
      new Date(NOW + VDC_MAX_VALIDITY_MS).toISOString().replace('.000Z', 'Z')
    )
    expect((await pair({ entryExpiresAt: '2026-12-31T00:00:00Z' })).grant.validUntil).toBe('2026-12-02T12:00:00Z')
  })

  it("the acceptance's accepts is the grant's digest by the specification's four steps, compared as bytes", async () => {
    const { grant, acceptance } = await pair()
    const bytes = specDigestBytes(grant as unknown as Record<string, unknown>)
    // the same digest spelled in base64url (`u`) is the same digest
    const respelled = {
      ...acceptance,
      credentialSubject: { ...acceptance.credentialSubject, delegation: { accepts: `u${base64url(bytes)}` } },
    }
    const resigned = await signer.sign(respelled as UnsignedVdc)
    expect(await check(grant, resigned)).toEqual({ ok: true })
    // control: one bit off is another grant
    const off = Uint8Array.from(bytes)
    off[5] ^= 1
    const wrong = await signer.sign({
      ...respelled,
      credentialSubject: { ...respelled.credentialSubject, delegation: { accepts: `u${base64url(off)}` } },
    } as UnsignedVdc)
    expect(await check(grant, wrong)).toEqual({ ok: false, reason: 'accepts-other-grant' })
  })

  it('the scope grows with what the agent may do', () => {
    expect(vdcScopeFor({ memory: false, roomAdded: false })).toEqual([AGENT_VDC_SCOPE.chat])
    expect(vdcScopeFor({ memory: true, roomAdded: true })).toEqual([
      AGENT_VDC_SCOPE.chat,
      AGENT_VDC_SCOPE.memory,
      AGENT_VDC_SCOPE.roomPresent,
    ])
  })
})

describe('refused (§7.3), each against a pair that otherwise verifies', () => {
  type Mutate = (vc: Record<string, unknown>) => void
  const subject = (vc: Record<string, unknown>) => vc.credentialSubject as { delegation: Record<string, unknown> }

  it.each<[string, 'grant' | 'acceptance', Mutate, string]>([
    [
      'a VDC without DTGCredential in type',
      'grant',
      (vc) => (vc.type = ['VerifiableCredential', 'DelegationCredential']),
      'type',
    ],
    ['a missing issuerScope', 'grant', (vc) => delete vc.issuerScope, 'issuer-scope'],
    ['an other-valued issuerScope', 'acceptance', (vc) => (vc.issuerScope = 'public'), 'issuer-scope'],
    ['no validUntil', 'grant', (vc) => delete vc.validUntil, 'valid-until'],
    ['a missing scope', 'grant', (vc) => delete subject(vc).delegation.scope, 'scope'],
    ['an empty scope', 'grant', (vc) => (subject(vc).delegation.scope = []), 'scope'],
    ['a grant carrying accepts', 'grant', (vc) => (subject(vc).delegation.accepts = 'zQm'), 'grant-carries-accepts'],
    [
      'an acceptance carrying scope',
      'acceptance',
      (vc) => (subject(vc).delegation.scope = ['keyring.agent.chat']),
      'acceptance-carries-scope',
    ],
    ['a wrong @context order', 'grant', (vc) => (vc['@context'] = [DTG_CONTEXT_V1, W3C_VC_V2_CONTEXT]), 'context'],
  ])('%s', async (_, which, mutate, reason) => {
    const { grant, acceptance } = await pair()
    const target = JSON.parse(JSON.stringify(which === 'grant' ? grant : acceptance)) as Record<string, unknown>
    mutate(target)
    // re-signed, so only the rule under test can refuse it
    const resigned = await signer.sign(target as unknown as UnsignedVdc)
    const result = which === 'grant' ? await check(resigned, acceptance) : await check(grant, resigned)
    expect(result).toEqual({ ok: false, reason })
    expect(vdcShapeProblem(resigned, which)).toBe(reason)
  })

  it('an acceptance whose accepts is a different digest', async () => {
    const { grant } = await pair()
    const other = await pair({ scope: [AGENT_VDC_SCOPE.chat] })
    expect(await check(grant, other.acceptance)).toEqual({ ok: false, reason: 'accepts-other-grant' })
  })

  it("the grant's issuer is the connection's persona, and its subject K_a", async () => {
    const { grant, acceptance } = await pair()
    expect(await verifyVdcPair({ grant, acceptance, ownerPersonaDid: OTHER, agentDid: K_A, verify })).toEqual({
      ok: false,
      reason: 'wrong-issuer',
    })
    expect(await verifyVdcPair({ grant, acceptance, ownerPersonaDid: PERSONA, agentDid: OTHER, verify })).toEqual({
      ok: false,
      reason: 'wrong-issuer',
    })
  })

  it('a proof that does not verify under its issuer', async () => {
    const { grant, acceptance } = await pair()
    const forged = { ...grant, proof: { proofValue: fakeProofValue(OTHER, grant) } }
    expect(await check(forged, acceptance)).toMatchObject({ ok: false })
    const tampered = { ...acceptance, validFrom: '2026-11-25T12:02:00Z' }
    expect(await check(grant, tampered)).toEqual({ ok: false, reason: 'acceptance-proof' })
  })

  it('a grant that outlives the entry, or runs longer than 7 days', async () => {
    const { grant, acceptance } = await pair()
    expect(await check(grant, acceptance, '2026-11-26T00:00:00Z')).toEqual({ ok: false, reason: 'outlives-entry' })
    const long = await signer.sign({ ...grant, validUntil: '2026-12-09T12:00:00Z' } as UnsignedVdc)
    const longAcceptance = await issueVdc(buildVdcAcceptance(long, NOW), signer)
    expect(await check(long, longAcceptance)).toEqual({ ok: false, reason: 'too-long' })
  })

  it('control: the constants are the ones the specification names', () => {
    expect(VDC_CONTEXT).toEqual([
      'https://www.w3.org/ns/credentials/v2',
      'https://registry.trustoverip.org/dtg/context/v1',
    ])
    expect(VDC_TYPE).toEqual(['VerifiableCredential', 'DTGCredential', 'DelegationCredential'])
  })
})

describe('re-issue', () => {
  const at = (hoursLeft: number) => new Date(NOW + hoursLeft * HOUR).toISOString()

  it('when 48 hours or less remain, and not before', () => {
    expect(shouldReissueVdc({ state: 'active', entryConfirmedPresent: true, grantValidUntil: at(48), now: NOW })).toBe(
      true
    )
    expect(shouldReissueVdc({ state: 'active', entryConfirmedPresent: true, grantValidUntil: at(49), now: NOW })).toBe(
      false
    )
  })

  it('only while the entry is confirmed present', () => {
    expect(shouldReissueVdc({ state: 'active', entryConfirmedPresent: false, grantValidUntil: at(1), now: NOW })).toBe(
      false
    )
  })

  it.each(['revoking', 'revoked', 'expired'] as const)('never for a %s connection', (state) => {
    expect(shouldReissueVdc({ state, entryConfirmedPresent: true, grantValidUntil: at(1), now: NOW })).toBe(false)
  })

  it('a VDC that lapsed while the phone was offline leaves active unchanged and is replaced at the next opportunity', async () => {
    expect(stateAfterVdcLapse('active')).toBe('active')
    expect(shouldReissueVdc({ state: 'active', entryConfirmedPresent: true, grantValidUntil: at(-10), now: NOW })).toBe(
      true
    )
    // and the lapsed pair still verifies: lapse is not a failed check
    const { grant, acceptance } = await pair()
    expect(await check(grant, acceptance)).toEqual({ ok: true })
  })
})

describe('issuing', () => {
  it('refuses a signer that changed what it signed', async () => {
    const sly: VdcSigner = {
      sign: async (c) => ({ ...c, issuerScope: 'directed', validUntil: '2027-01-01T00:00:00Z', proof: {} }),
    }
    await expect(
      issueVdc(buildVdcGrant({ personaDid: PERSONA, agentDid: K_A, scope: ['keyring.agent.chat'], now: NOW }), sly)
    ).rejects.toThrow('changed the credential')
  })

  it('writes whole-second timestamps, as the signer does', () => {
    const grant = buildVdcGrant({ personaDid: PERSONA, agentDid: K_A, scope: ['keyring.agent.chat'], now: NOW + 789 })
    expect(grant.validFrom).toBe('2026-11-25T12:00:00Z')
  })

  it('issues nothing for an entry that has already expired, or with no scope', () => {
    expect(() =>
      buildVdcGrant({
        personaDid: PERSONA,
        agentDid: K_A,
        scope: ['keyring.agent.chat'],
        now: NOW,
        entryExpiresAt: '2026-11-25T11:00:00Z',
      })
    ).toThrow('already expired')
    expect(() => buildVdcGrant({ personaDid: PERSONA, agentDid: K_A, scope: [], now: NOW })).toThrow(
      'at least one scope'
    )
  })
})
