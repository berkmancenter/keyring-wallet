import { cardVariantForDid, hueRotationForDid, rotateHueHex } from '@/demo-profiles/trading-card/didColorVariant'

describe('didColorVariant', () => {
  describe('hueRotationForDid', () => {
    it('is deterministic for the same DID', () => {
      const did = 'did:peer:alice'
      expect(hueRotationForDid(did)).toBe(hueRotationForDid(did))
    })

    it('differs across DIDs (in general)', () => {
      // Not a mathematical guarantee for arbitrary strings, but any hash worth
      // using should not collide for these two everyday examples.
      expect(hueRotationForDid('did:peer:alice')).not.toBe(hueRotationForDid('did:peer:bob'))
    })

    it('always lands in [0, 360)', () => {
      const dids = ['did:peer:alice', 'did:peer:bob', 'did:peer:carol', '', 'x', 'did:peer:' + 'z'.repeat(200)]
      for (const did of dids) {
        const rotation = hueRotationForDid(did)
        expect(rotation).toBeGreaterThanOrEqual(0)
        expect(rotation).toBeLessThan(360)
      }
    })
  })

  describe('rotateHueHex', () => {
    it('returns the same color for a 0 or 360 degree rotation', () => {
      expect(rotateHueHex('#2B1B4A', 0)).toBe('#2b1b4a')
      expect(rotateHueHex('#2B1B4A', 360)).toBe('#2b1b4a')
    })

    it('preserves lightness for grayscale input (no hue to rotate)', () => {
      expect(rotateHueHex('#808080', 90)).toBe('#808080')
    })

    it('produces a valid 6-digit hex color for any rotation', () => {
      for (let degrees = 0; degrees < 360; degrees += 37) {
        const result = rotateHueHex('#C9A227', degrees)
        expect(result).toMatch(/^#[0-9a-f]{6}$/)
      }
    })
  })

  describe('cardVariantForDid', () => {
    const base = { primary: '#2B1B4A', secondary: '#C9A227' }

    it('is deterministic for the same DID', () => {
      const did = 'did:peer:alice'
      expect(cardVariantForDid(did, base)).toEqual(cardVariantForDid(did, base))
    })

    it('gives different contacts a different look', () => {
      const alice = cardVariantForDid('did:peer:alice', base)
      const bob = cardVariantForDid('did:peer:bob', base)
      expect(alice).not.toEqual(bob)
    })

    it('returns the base colors unchanged when the DID hashes to a zero rotation', () => {
      // hueRotationForDid('') === 5381 % 360 === 341, so pick a DID that
      // actually hashes to 0 rather than assuming the empty string does.
      let did = ''
      for (let i = 0; i < 100000; i++) {
        did = `did:peer:probe-${i}`
        if (hueRotationForDid(did) === 0) break
      }
      expect(hueRotationForDid(did)).toBe(0)
      // rotateHueHex normalizes to lowercase, so compare case-insensitively
      // rather than against `base`'s own (uppercase) casing.
      expect(cardVariantForDid(did, base)).toEqual({
        primary: base.primary.toLowerCase(),
        secondary: base.secondary.toLowerCase(),
      })
    })
  })
})
