import {
  base64UrlDecode,
  base64UrlEncode,
  encodeEnrolmentLink,
  enrolmentCode,
  EnrolmentOfferError,
  isEnrolmentLink,
  parseEnrolmentLink,
  type EnrolmentOffer,
} from '@bifold/trust-tasks'

// The enrolment offer is what a phone scans or pastes to link to its agent
// (plan §5.1). The lab page and the phone derive the code both screens show
// independently, so the code is pinned to the page's own test vector.

const offer: EnrolmentOffer = {
  v: 1,
  t: 'vta-enrol',
  vta: 'did:webvh:QmExample:keyring-vti-alice.ngrok.app',
  label: 'Keyring lab agent (alice)',
  url: 'http://localhost:8190/api/offers/AAAAAAAAAAAAAAAAAAAAAA',
  n: 'AAAAAAAAAAAAAAAAAAAAAA',
  exp: 2_000_000_000,
}

describe('enrolment offer', () => {
  it('round-trips through its link', () => {
    const link = encodeEnrolmentLink(offer)
    expect(link.startsWith('keyring://vta/enrol?o=')).toBe(true)
    expect(isEnrolmentLink(link)).toBe(true)
    expect(parseEnrolmentLink(link, 1_900_000_000)).toEqual(offer)
  })

  it('fits comfortably in a QR code', () => {
    // A version-10 QR at level M holds 213 bytes of binary; stay well under a
    // version-15 code so a phone camera reads it at arm's length.
    expect(encodeEnrolmentLink(offer).length).toBeLessThan(400)
  })

  it('refuses an expired offer before anything is minted', () => {
    const link = encodeEnrolmentLink({ ...offer, exp: 100 })
    expect(() => parseEnrolmentLink(link, 200)).toThrow(EnrolmentOfferError)
    try {
      parseEnrolmentLink(link, 200)
    } catch (error) {
      expect((error as EnrolmentOfferError).reason).toBe('expired')
    }
  })

  it('refuses a link that is not an offer, or is missing a field', () => {
    expect(() => parseEnrolmentLink('https://example.com')).toThrow(EnrolmentOfferError)
    const missing = 'keyring://vta/enrol?o=' + base64UrlEncode(new TextEncoder().encode(JSON.stringify({ v: 1 })))
    expect(() => parseEnrolmentLink(missing)).toThrow(/missing a field/)
    expect(() => parseEnrolmentLink('keyring://vta/enrol?o=%%%')).toThrow(/could not be read/)
  })

  it('derives the same code as the lab enrolment page', () => {
    // Vector from scripts/openvtc/local-vti-stack/enrol-page/test/code.test.mjs.
    expect(enrolmentCode('AAAAAAAAAAAAAAAAAAAAAA', 'did:peer:2.Vz6MkTEST')).toBe('N4SP-X7H6')
  })

  it('base64url round-trips every remainder length', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff)
      expect(Array.from(base64UrlDecode(base64UrlEncode(bytes)))).toEqual(Array.from(bytes))
    }
  })
})
