/**
 * The Social Authorization (S2) a guardian's phone issues, checked by this package's own verifier: the round trip
 * from the builders (sedi/guardian/issue) to verifySocialAuthorization, over a Guardian card a test state issued to
 * a holder whose key the test holds (fixtures/keriTestKit). Each refusal row breaks exactly one thing the check reads.
 */
import { SEDI_SCHEMAS, parseProof, type Sad } from '../guardian/chain'
import { verifyGuardian, verifySocialAuthorization } from '../guardian/index'
import {
  blindedState,
  proofOf,
  registryInception,
  registryUpdate,
  sealOf,
  socialAuthorization,
} from '../guardian/issue'
import { digest } from '../guardian/kel'

import { TestController, random, revoke, testState } from './fixtures/keriTestKit'

jest.mock('../../trust-tasks/module/stateVerifiedApproversFlag', () => ({
  isStateVerifiedApproversEnabled: () => true,
}))

const te = new TextEncoder()
const NOW = '2026-11-13T01:00:00.000Z'
const LATER = '2026-12-13T01:00:00.000Z'
const now = new Date('2026-11-14T00:00:00.000Z')

/** The guardian's phone issues S2 for the card it holds: a registry, the credential, its issuance, one anchor. */
function issueS2(
  holder: TestController,
  guardianSaid: string,
  ward: string,
  opts: { anchor?: 'both' | 'ripOnly' | 'none' } = {}
) {
  const rip = registryInception(digest, holder.aid, NOW, random)
  const s2 = socialAuthorization(
    digest,
    { issuer: holder.aid, ward, rd: rip.rd, guardianSaid, issued: NOW, expires: LATER },
    random
  )
  const blinder = blindedState(digest, s2.sad.d, 'issued', random)
  const bup = registryUpdate(digest, rip.rd, 1, rip.rd, NOW, blinder.blid)
  const anchor = opts.anchor ?? 'both'
  if (anchor === 'both') holder.anchor([sealOf(rip.rd, 0, rip.rd), sealOf(rip.rd, 1, bup.said)])
  if (anchor === 'ripOnly') holder.anchor([sealOf(rip.rd, 0, rip.rd)])
  return {
    rip,
    s2,
    blinder,
    bup,
    tel: { ripText: rip.text, updateTexts: [bup.text] },
    proof: proofOf(s2.text, blinder),
  }
}

function setup() {
  const state = testState()
  const jordan = new TestController()
  const sam = new TestController()
  const g = state.guardian(jordan.aid, sam.aid)
  return { state, jordan, sam, g }
}

const material = (ev: { kels: string[]; tels: { ripText: string; updateTexts: string[] }[]; creds: string[] }) => ({
  kels: ev.kels.map((k) => te.encode(k)),
  tels: ev.tels,
  creds: ev.creds,
})

function withS2(
  ev: ReturnType<ReturnType<typeof testState>['evidenceOf']>,
  holderKel: string,
  s2: { tel: { ripText: string; updateTexts: string[] }; proof: string }
) {
  return material({ kels: [...ev.kels, holderKel], tels: [...ev.tels, s2.tel], creds: [...ev.creds, s2.proof] })
}

describe('S2 round trip: what the guardian phone issues, our verifier accepts', () => {
  it('the test state issues a Guardian card to a holder whose key the test holds (control for every row)', () => {
    const { state, jordan, sam, g } = setup()
    const ev = state.evidenceOf(g)
    const r = verifyGuardian(
      material(ev),
      ev.guardianSaid,
      { holder: jordan.aid, ward: sam.aid },
      {
        trustedRoots: [state.root.aid],
        now,
      }
    )
    expect(r).toMatchObject({ ok: true, guardian: jordan.aid, ward: sam.aid, root: state.root.aid })
  })

  it('S2 issued by the card holder to the ward verifies, chained to the Guardian card and the state root', () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, s2),
      s2.s2.sad.d,
      { ward: sam.aid },
      {
        trustedRoots: [state.root.aid],
        now,
      }
    )
    expect(r).toEqual({ ok: true, guardian: jordan.aid, ward: sam.aid, root: state.root.aid, expires: LATER })
  })

  it("the S2 is in the K0 kit's shape: schema, issuer, issuee, I2I guardian edge, and one -aAj disclosure", () => {
    const { jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    const sad = s2.s2.sad as Sad
    expect(sad.s).toBe(SEDI_SCHEMAS.social)
    expect(sad.i).toBe(jordan.aid)
    expect(sad.a?.i).toBe(sam.aid)
    expect(sad.e?.guardian).toMatchObject({ n: g.sad.d, s: SEDI_SCHEMAS.guardian, o: 'I2I' })
    expect(Object.keys(sad)).toEqual(['v', 't', 'd', 'u', 'i', 'rd', 's', 'a', 'e', 'r'])
    const p = parseProof(s2.proof)
    expect(p).toMatchObject({ ok: true, blinder: { blid: s2.blinder.blid, td: sad.d, ts: 'issued' } })
    expect(s2.proof.slice(s2.s2.text.length, s2.s2.text.length + 8)).toBe('-CAk-aAj')
  })
})

describe('S2 refusals: each breaks one thing', () => {
  const trust = (state: ReturnType<typeof testState>) => ({ trustedRoots: [state.root.aid], now })

  it('a ward other than the one it names is refused (wrongHolder)', () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    const other = new TestController()
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, s2),
      s2.s2.sad.d,
      { ward: other.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false, reason: 'wrongHolder' })
  })

  it('an edited S2 (its ward changed after issuing) fails its SAID', () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    const other = new TestController()
    const edited = { ...s2, proof: s2.proof.split(sam.aid).join(other.aid) }
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, edited),
      s2.s2.sad.d,
      { ward: other.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toMatch(/saidMismatch|chainMissing/)
  })

  it('an S2 issued by someone other than the card holder is refused (its guardian edge is not I2I)', () => {
    const { state, sam, g } = setup()
    const impostor = new TestController()
    const s2 = issueS2(impostor, g.sad.d, sam.aid)
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), impostor.kel, s2),
      s2.s2.sad.d,
      { ward: sam.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false, reason: 'edgeNotI2I' })
  })

  it("the holder's KEL without the issuance anchor: the S2 is not issued (anchor seal)", () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid, { anchor: 'ripOnly' })
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, s2),
      s2.s2.sad.d,
      { ward: sam.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false, reason: 'telUnanchored' })
  })

  it('a disclosure that does not unblind the issuance is refused (blinded state)', () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    const wrong = blindedState(digest, s2.s2.sad.d, 'issued', random)
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, { tel: s2.tel, proof: proofOf(s2.s2.text, wrong) }),
      s2.s2.sad.d,
      { ward: sam.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false, reason: 'statusNotCurrent' })
  })

  it('CASCADE: once the Guardian card is revoked, the S2 under it is refused (revoked)', () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    revoke(g)
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, s2),
      s2.s2.sad.d,
      { ward: sam.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false, reason: 'revoked' })
  })

  it("CASCADE, live: the card's own copy leaves the revocation out, the issuer's published KEL has it", () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    // The KELs the card carried when it was sent: before the state revoked it.
    const sentKels = state.evidenceOf(g).kels
    revoke(g)
    const omitted = { ...state.evidenceOf(g, { omitRevocation: true }), kels: sentKels }
    // Control: the card's own copy alone reads as valid (that is what a holder could keep showing).
    const own = verifySocialAuthorization(withS2(omitted, jordan.kel, s2), s2.s2.sad.d, { ward: sam.aid }, trust(state))
    expect(own).toMatchObject({ ok: true })
    // With the issuing agent's published KEL (which anchors the revocation) read in its place: refused.
    const live = { ...trust(state), resolvedKels: [te.encode(state.agentAid.kel)] }
    const r = verifySocialAuthorization(withS2(omitted, jordan.kel, s2), s2.s2.sad.d, { ward: sam.aid }, live)
    expect(r).toMatchObject({ ok: false, reason: 'statusNotCurrent' })
  })

  it('the S2 itself revoked by the guardian is refused (revoked)', () => {
    const { state, jordan, sam, g } = setup()
    const s2 = issueS2(jordan, g.sad.d, sam.aid)
    const revoked = blindedState(digest, s2.s2.sad.d, 'revoked', random)
    const bup2 = registryUpdate(digest, s2.rip.rd, 2, s2.bup.said, NOW, revoked.blid)
    jordan.anchor([sealOf(s2.rip.rd, 2, bup2.said)])
    const r = verifySocialAuthorization(
      withS2(state.evidenceOf(g), jordan.kel, {
        tel: { ripText: s2.rip.text, updateTexts: [s2.bup.text, bup2.text] },
        proof: proofOf(s2.s2.text, revoked),
      }),
      s2.s2.sad.d,
      { ward: sam.aid },
      trust(state)
    )
    expect(r).toMatchObject({ ok: false, reason: 'revoked' })
  })

  it('an S2 chained to a different Guardian card (one naming another ward) is refused (wardMismatch)', () => {
    const { state, jordan, sam, g } = setup()
    const other = new TestController()
    const g2 = state.guardian(jordan.aid, other.aid)
    const s2 = issueS2(jordan, g2.sad.d, sam.aid)
    const ev = state.evidenceOf(g2)
    const r = verifySocialAuthorization(withS2(ev, jordan.kel, s2), s2.s2.sad.d, { ward: sam.aid }, trust(state))
    expect(r).toMatchObject({ ok: false, reason: 'wardMismatch' })
    void g
  })
})
