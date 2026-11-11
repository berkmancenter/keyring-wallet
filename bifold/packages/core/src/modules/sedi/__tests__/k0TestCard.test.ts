/**
 * The K0 test Guardian card shipped in src (sedi/guardian/k0TestCard.ts) is exactly the K0 kit's "G-ok" card, built
 * from the fixtures the verifier is tested against: drift on either side fails here.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { K0_TEST_GUARDIAN_CARD } from '../guardian/k0TestCard'
import { K0_TEST_ROOT, K0_TEST_WARD } from '../guardian/stateRoots'

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

describe('the K0 test Guardian card', () => {
  test("is the fixtures' G-ok card, byte for byte", () => {
    expect(K0_TEST_GUARDIAN_CARD).toEqual({
      guardianSaid: prov.creds['G-ok'].said,
      holder: prov.aids.jordan,
      kels: ['roy', 'deb', 'sue', 'jordan'].map((k) => text(`kel-${k}.cesr`)),
      tels: [tel('unit'), tel('agent'), tel('G-ok')],
      creds: [
        text('acdc-unit-issued-proofed.cesr'),
        text('acdc-agent-issued-proofed.cesr'),
        text('acdc-G-ok-issued-proofed.cesr'),
      ],
    })
  })

  test("its chain ends at the K0 test root and names the K0 test ward (control: both are the kit's)", () => {
    expect(K0_TEST_ROOT.aid).toBe(prov.trustedRoot)
    expect(K0_TEST_WARD).toBe(prov.aids.sam)
    expect(K0_TEST_GUARDIAN_CARD.kels[0]).toBe(text('kel-roy.cesr'))
  })
})
