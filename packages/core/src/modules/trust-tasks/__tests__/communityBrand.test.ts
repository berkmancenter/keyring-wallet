/**
 * How a community's cards look: readable colour for every community (its own, made readable, or one drawn from its
 * DID), a stable pattern, a monogram from its name or handle, and only usable branding kept.
 */
import {
  ERROR_HUE_SPAN,
  MIN_CONTRAST,
  colourAtHue,
  communityBrand,
  contrastWithWhite,
  didColour,
  didHue,
  httpsLogoUrl,
  hueDistanceFromError,
  monogramOf,
  normalisedAccent,
  readableAccent,
} from '../module/communityBrand'

const WEBVH = 'did:webvh:QmScid123:dids.example.org:al-community2-vtc'

describe('what is kept of a community’s branding', () => {
  test('a colour is #rrggbb, from #rgb or #rrggbb in any case; anything else is none', () => {
    expect(normalisedAccent('#1A2b3C')).toBe('#1a2b3c')
    expect(normalisedAccent(' #abc ')).toBe('#aabbcc')
    for (const bad of ['1a2b3c', '#12345', '#1234567', 'red', 'rgb(1,2,3)', '#ggg', '', 42, undefined, null]) {
      expect(normalisedAccent(bad)).toBeUndefined()
    }
  })

  test('a logo address is https only, without credentials, and of a sane length', () => {
    expect(httpsLogoUrl('https://vtc.example.org/logo.png')).toBe('https://vtc.example.org/logo.png')
    for (const bad of [
      'http://vtc.example.org/logo.png',
      'https://user:pass@vtc.example.org/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      `https://vtc.example.org/${'a'.repeat(2100)}`,
      'not a url',
      '',
      42,
      undefined,
    ]) {
      expect(httpsLogoUrl(bad)).toBeUndefined()
    }
  })
})

describe('the colour', () => {
  test('every hue a DID can draw keeps white text readable (HSL 50%, 30%): 4.98:1 at worst, near yellow', () => {
    const ratios = Array.from({ length: 360 }, (_, hue) => contrastWithWhite(colourAtHue(hue)))
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.98)
  })

  test('no DID draws a hue near the error red, so no card reads as revoked', () => {
    const hues = Array.from({ length: 5000 }, (_, i) => didHue(`did:example:community-${i}`))
    // Positive control: the hash does reach hues all around the wheel.
    expect(new Set(hues.map((h) => Math.floor(h / 30))).size).toBeGreaterThanOrEqual(11)
    for (const hue of hues) expect(hueDistanceFromError(hue)).toBeGreaterThanOrEqual(ERROR_HUE_SPAN)
  })

  test('one community always draws the same colour; two communities usually differ', () => {
    expect(didColour(WEBVH)).toBe(didColour(WEBVH))
    expect(didColour(WEBVH)).not.toBe(didColour(`${WEBVH}-other`))
  })

  test("a community's own colour is kept when white text is readable on it", () => {
    expect(readableAccent('#1a4d80')).toBe('#1a4d80')
  })

  test('a colour too light for white text is darkened, same hue, until it is readable', () => {
    for (const light of ['#ffeb3b', '#ffffff', '#7fdbff', '#ff851b']) {
      const made = readableAccent(light)
      expect(contrastWithWhite(made)).toBeGreaterThanOrEqual(MIN_CONTRAST)
      expect(made).not.toBe(light)
    }
  })

  test('the community’s colour wins over the DID’s, and says so', () => {
    const own = communityBrand({ communityDid: WEBVH, accentColor: '#1a4d80' })
    expect(own).toMatchObject({ color: '#1a4d80', fromAccent: true })
    const drawn = communityBrand({ communityDid: WEBVH })
    expect(drawn).toMatchObject({ color: didColour(WEBVH), fromAccent: false })
    expect(communityBrand({ communityDid: WEBVH, accentColor: 'not a colour' }).fromAccent).toBe(false)
  })
})

describe('the monogram and pattern', () => {
  test("a name gives its first and last words' initials", () => {
    expect(monogramOf('Riverside Climbing Club', undefined)).toBe('RC')
    expect(monogramOf('  harbor   tenants union ', undefined)).toBe('HU')
    expect(monogramOf('Keyring', undefined)).toBe('K')
    expect(monogramOf('Ωmega Σociety', undefined)).toBe('ΩΣ')
    expect(monogramOf('— The Club —', undefined)).toBe('TC')
  })

  test('without a name, the first two parts of the DID’s handle', () => {
    expect(monogramOf(undefined, 'al-community2-vtc')).toBe('AC')
    expect(communityBrand({ communityDid: WEBVH }).monogram).toBe('AC')
  })

  test('with nothing to go on, a placeholder rather than nothing', () => {
    expect(communityBrand({ communityDid: 'did:key:z6Mk' }).monogram).toBe('?')
  })

  test('the pattern is one of four, and stable for a community', () => {
    const patterns = new Set(
      Array.from({ length: 200 }, (_, i) => communityBrand({ communityDid: `did:x:${i}` }).pattern)
    )
    expect([...patterns].sort()).toEqual(['dots', 'rings', 'stripes', 'waves'])
    expect(communityBrand({ communityDid: WEBVH }).pattern).toBe(communityBrand({ communityDid: WEBVH }).pattern)
  })
})
