/**
 * The demo card shipped in src (sedi/guardian/k0RevokedOmittedCard.ts) is exactly the K0 kit's "G-revoked" card with its
 * revocation left out: drift on either side fails here. And it behaves as the demo needs it to: from its own copy it
 * reads as issued (the known bound), and against the issuing agent's full published history it is refused.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { setStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import { verifyGuardian } from '../guardian'
import { K0_REVOKED_OMITTED_CARD } from '../guardian/k0RevokedOmittedCard'

const FX = join(__dirname, 'fixtures', 'k0-utah-v2')
const text = (f: string) => readFileSync(join(FX, f), 'utf8')
const prov = JSON.parse(text('PROVENANCE.json')) as {
  aids: Record<string, string>
  creds: Record<string, { said: string }>
  trustedRoot: string
}
const tel = (stem: string) => ({
  ripText: text(`tel-${stem}-rip.json`),
  updateTexts: [text(`tel-${stem}-issued.json`)],
})
const sueCut = () => {
  const t = text('kel-sue.cesr')
  const rev = (JSON.parse(text('tel-G-revoked-revoked.json')) as { d: string }).d
  return t.slice(0, t.lastIndexOf('{"v":"', t.indexOf(rev)))
}
const te = new TextEncoder()
const material = (kels: string[]) => ({
  kels: kels.map((k) => te.encode(k)),
  tels: K0_REVOKED_OMITTED_CARD.tels.map((t) => ({ ripText: t.ripText, updateTexts: [...t.updateTexts] })),
  creds: [...K0_REVOKED_OMITTED_CARD.creds],
})
const options = (resolvedKels: Uint8Array[] = []) => ({
  trustedRoots: [prov.trustedRoot],
  now: new Date('2026-11-11T12:00:00Z'),
  resolvedKels,
})
const expect_ = { holder: prov.aids.jordan, ward: prov.aids.sam }
const verdict = (r: { ok: boolean } & { reason?: string }) => (r.ok ? 'valid' : r.reason)

beforeEach(() => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
})
afterEach(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
})

describe('the K0 card with its revocation left out', () => {
  test("is the fixtures' G-revoked card, issued state, with Sue's history cut before the revocation, byte for byte", () => {
    expect(K0_REVOKED_OMITTED_CARD).toEqual({
      guardianSaid: prov.creds['G-revoked'].said,
      holder: prov.aids.jordan,
      kels: [text('kel-roy.cesr'), text('kel-deb.cesr'), sueCut(), text('kel-jordan.cesr')],
      tels: [tel('unit'), tel('agent'), tel('G-revoked')],
      creds: [
        text('acdc-unit-issued-proofed.cesr'),
        text('acdc-agent-issued-proofed.cesr'),
        text('acdc-G-revoked-issued-proofed.cesr'),
      ],
    })
    // The cut really removed something: the shipped Sue history is shorter than the published one.
    expect(K0_REVOKED_OMITTED_CARD.kels[2].length).toBeLessThan(text('kel-sue.cesr').length)
  })

  test("from its own copy it reads as issued; with Sue's published history it is refused (control: the same card from its own copy is valid)", () => {
    const own = verifyGuardian(
      material(K0_REVOKED_OMITTED_CARD.kels),
      K0_REVOKED_OMITTED_CARD.guardianSaid,
      expect_,
      options()
    )
    const live = verifyGuardian(
      material(K0_REVOKED_OMITTED_CARD.kels),
      K0_REVOKED_OMITTED_CARD.guardianSaid,
      expect_,
      options([te.encode(text('kel-sue.cesr'))])
    )
    expect([verdict(own), verdict(live)]).toEqual(['valid', 'statusNotCurrent'])
  })
})
