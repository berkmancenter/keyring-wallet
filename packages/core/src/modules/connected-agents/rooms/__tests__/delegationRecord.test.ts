/**
 * Reading an agent's delegation record (plan §3.16, step 7.14; backlog 3, fb-P1f). Proofs go through a fake signer and
 * verifier, as in vdc.test.ts: a proof is the controller it was signed as and the claims' canonical form, so signing
 * as another key, or changing a claim, breaks it.
 */
import canonicalize from 'canonicalize'

import { SignedVdc, UnsignedVdc, VdcProofVerifier, buildVdcAcceptance, buildVdcGrant, vdcScopeFor } from '../../vdc'
import { verifyDelegationRecord } from '../delegationRecord'

const PERSONA = 'did:webvh:QmPersona:persona.example.org'
const K_A = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const OTHER = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'
const NOW = Date.parse('2026-11-25T12:00:00Z')
const HOUR = 60 * 60 * 1000

const fakeProofValue = (controller: string, claims: unknown) => `fake:${controller}:${canonicalize(claims)}`

/** Sign as `controller`: by default the credential's own issuer. */
const sign = (credential: UnsignedVdc, controller: string = credential.issuer): SignedVdc => ({
  ...credential,
  proof: {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    proofValue: fakeProofValue(controller, credential),
  },
})

const verify: VdcProofVerifier = async (credential, expectedController) => {
  const { proof, ...claims } = credential as { proof?: { proofValue?: string } }
  return proof?.proofValue === fakeProofValue(expectedController, claims)
}

/** A grant from `issuer` to `subject`, and `subject`'s acceptance of it, signed as each issuer unless told otherwise. */
function pair(over: { issuer?: string; subject?: string; acceptanceSignedAs?: string; grantSignedAs?: string } = {}) {
  const issuer = over.issuer ?? PERSONA
  const subject = over.subject ?? K_A
  const grant = sign(
    buildVdcGrant({
      personaDid: issuer,
      agentDid: subject,
      scope: vdcScopeFor({ memory: false, roomAdded: true }),
      now: NOW - HOUR,
    }),
    over.grantSignedAs
  )
  const acceptance = sign(buildVdcAcceptance(grant, NOW - HOUR + 60_000), over.acceptanceSignedAs)
  return { grant, acceptance }
}

/** A `memberProfile` body as the plugin writes it where the room lists `delegation`. */
const body = (delegation: unknown): Record<string, unknown> => ({ title: 'Notes helper', delegation })

const read = (
  profileBody: Record<string, unknown>,
  over: { authorDid?: string; roomListsDelegation?: boolean; now?: number; verify?: VdcProofVerifier } = {}
) =>
  verifyDelegationRecord({
    profileBody,
    authorDid: over.authorDid ?? K_A,
    roomListsDelegation: over.roomListsDelegation ?? true,
    verify: over.verify ?? verify,
    now: over.now ?? NOW,
  })

describe('verifyDelegationRecord', () => {
  it('a valid pair by the author is ok, and names the grant issuer as the owner', async () => {
    expect(await read(body(pair()))).toEqual({ ok: true, ownerDid: PERSONA })
  })

  it('a room that does not list delegation is notListed, and the record is not read', async () => {
    const spy = jest.fn(verify)
    expect(await read(body(pair()), { roomListsDelegation: false, verify: spy })).toEqual({
      ok: false,
      reason: 'notListed',
    })
    expect(spy).not.toHaveBeenCalled()
    // not read: even a body that is not a delegation at all gives the same answer
    expect(await read(body('garbage'), { roomListsDelegation: false })).toEqual({ ok: false, reason: 'notListed' })
  })

  it('control: the same record in a room that lists delegation is read and verified', async () => {
    const spy = jest.fn(verify)
    expect(await read(body(pair()), { verify: spy })).toEqual({ ok: true, ownerDid: PERSONA })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('a body with no delegation member is absent; a delegation that is not an object is refused', async () => {
    expect(await read({ title: 'Notes helper' })).toEqual({ ok: false, reason: 'absent' })
    expect(await read(body(null))).toEqual({ ok: false, reason: 'absent' })
    expect(await read(body('a pair'))).toEqual({ ok: false, reason: 'not-an-object' })
    expect(await read(body([pair().grant, pair().acceptance]))).toEqual({ ok: false, reason: 'not-an-object' })
  })

  it('a delegation missing its grant or acceptance is refused with the shape problem', async () => {
    const { grant, acceptance } = pair()
    expect(await read(body({ acceptance }))).toEqual({ ok: false, reason: 'not-an-object' })
    expect(await read(body({ grant }))).toEqual({ ok: false, reason: 'not-an-object' })
    // a grant in the acceptance's place is refused by vdc.ts's own shape rule
    expect(await read(body({ grant, acceptance: grant }))).toEqual({ ok: false, reason: 'acceptance-carries-scope' })
  })

  it('a grant whose subject is not the author is refused', async () => {
    // a genuine pair, but for another agent: the author copied it into its own record
    const theirs = pair({ subject: OTHER })
    expect(await read(body(theirs), { authorDid: K_A })).toEqual({ ok: false, reason: 'subjectNotAuthor' })
  })

  it('control: the same pair read on the record of the agent it names passes', async () => {
    const theirs = pair({ subject: OTHER })
    expect(await read(body(theirs), { authorDid: OTHER })).toEqual({ ok: true, ownerDid: PERSONA })
  })

  it('an acceptance by another key is refused: issued by another DID, or signed by another key', async () => {
    const { grant } = pair()
    // issued by OTHER: an acceptance of the right grant, but not the author's
    const byOther = sign({ ...buildVdcAcceptance(grant, NOW - HOUR + 60_000), issuer: OTHER })
    expect(await read(body({ grant, acceptance: byOther }))).toEqual({ ok: false, reason: 'wrong-issuer' })
    // says it is the author's, but the proof is OTHER's key
    expect(await read(body(pair({ acceptanceSignedAs: OTHER })))).toEqual({ ok: false, reason: 'acceptance-proof' })
    // unsigned
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { proof: _p, ...unsigned } = pair().acceptance
    expect(await read(body({ grant, acceptance: unsigned }))).toEqual({ ok: false, reason: 'acceptance-proof' })
  })

  it('control: the acceptance signed by the author itself passes', async () => {
    expect(await read(body(pair({ acceptanceSignedAs: K_A })))).toEqual({ ok: true, ownerDid: PERSONA })
  })

  it('a grant not signed by its issuer is refused', async () => {
    expect(await read(body(pair({ grantSignedAs: OTHER })))).toEqual({ ok: false, reason: 'grant-proof' })
  })

  it('an acceptance of another grant is refused', async () => {
    const { grant } = pair()
    const otherGrant = sign(
      buildVdcGrant({
        personaDid: PERSONA,
        agentDid: K_A,
        scope: vdcScopeFor({ memory: true, roomAdded: true }),
        now: NOW - HOUR,
      })
    )
    const acceptance = sign(buildVdcAcceptance(otherGrant, NOW - HOUR + 60_000))
    expect(await read(body({ grant, acceptance }))).toEqual({ ok: false, reason: 'accepts-other-grant' })
  })

  it('a grant the author issued to itself, or by an issuer that is not a DID, is issuerNotPersona', async () => {
    expect(await read(body(pair({ issuer: K_A })))).toEqual({ ok: false, reason: 'issuerNotPersona' })
    expect(await read(body(pair({ issuer: 'persona.example.org' })))).toEqual({ ok: false, reason: 'issuerNotPersona' })
    // control: another DID's grant passes and names it
    expect(await read(body(pair({ issuer: OTHER })))).toEqual({ ok: true, ownerDid: OTHER })
  })

  it('a pair is judged at now: not before its validFrom, not from its validUntil on', async () => {
    const p = pair()
    expect(await read(body(p), { now: NOW - 2 * HOUR })).toEqual({ ok: false, reason: 'valid-from' })
    // the acceptance was issued a minute after the grant
    expect(await read(body(p), { now: NOW - HOUR + 30_000 })).toEqual({ ok: false, reason: 'valid-from' })
    expect(await read(body(p), { now: Date.parse(p.grant.validUntil) })).toEqual({ ok: false, reason: 'valid-until' })
    // control: a moment inside the window passes
    expect(await read(body(p), { now: Date.parse(p.grant.validUntil) - 1 })).toEqual({ ok: true, ownerDid: PERSONA })
  })

  it('a claim changed after signing breaks the grant proof, even with an acceptance of the changed grant', async () => {
    const { grant } = pair()
    const widened = { ...grant, credentialSubject: { ...grant.credentialSubject, delegation: { scope: ['x'] } } }
    const acceptance = sign(buildVdcAcceptance(widened, NOW - HOUR + 60_000))
    expect(await read(body({ grant: widened, acceptance }))).toEqual({ ok: false, reason: 'grant-proof' })
  })
})
