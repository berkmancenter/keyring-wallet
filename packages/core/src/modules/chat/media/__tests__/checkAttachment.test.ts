import { Buffer } from 'buffer'

import * as header from '../imageHeader'
import {
  MAX_ANIMATION_PIXELS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  checkImageAttachment,
  sizeFailure,
} from '../checkAttachment'
import { REAL, bytesOf, descriptorFor, gifOf, jpegHeader, pngHeader, webpExtended } from './fixtures/images'

const real = (base64: string, mediaType: string, width: number, height: number) =>
  descriptorFor(bytesOf(base64), { mediaType, width, height })

describe('checkImageAttachment accepts', () => {
  it.each([
    ['a JPEG', REAL.jpeg, 'image/jpeg', 5, 3],
    ['a PNG', REAL.png, 'image/png', 5, 3],
    ['a GIF', REAL.gif, 'image/gif', 5, 3],
    ['a lossy WebP', REAL.webpLossy, 'image/webp', 5, 3],
    ['an animated GIF', REAL.gifAnimated, 'image/gif', 6, 4],
    ['an animated WebP', REAL.webpAnimated, 'image/webp', 6, 4],
  ])('%s whose descriptor matches its bytes, and returns the bytes', (_name, base64, mediaType, width, height) => {
    const result = checkImageAttachment(real(base64, mediaType, width, height))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Buffer.from(result.image.bytes).toString('base64')).toBe(base64)
    expect(result.image.header).toMatchObject({ mediaType, width, height })
  })
})

describe('checkImageAttachment refuses', () => {
  const jpeg = () => real(REAL.jpeg, 'image/jpeg', 5, 3)

  it.each([
    ['no object', null, 'bad-descriptor'],
    ['no id', { ...jpeg(), id: '' }, 'bad-descriptor'],
    ['an over-long filename', { ...jpeg(), filename: 'x'.repeat(257) }, 'bad-descriptor'],
    ['a fractional byteCount', { ...jpeg(), byteCount: 837.5 }, 'bad-descriptor'],
    ['a zero width', { ...jpeg(), width: 0 }, 'bad-descriptor'],
    ['data that is not { base64 }', { ...jpeg(), data: { json: {} } }, 'bad-descriptor'],
    ['HEIC', { ...jpeg(), mediaType: 'image/heic' }, 'unsupported-type'],
    ['an SVG', { ...jpeg(), mediaType: 'image/svg+xml' }, 'unsupported-type'],
    ['a byteCount over the limit', { ...jpeg(), byteCount: MAX_IMAGE_BYTES + 1 }, 'too-large'],
    [
      'base64 with a character outside the alphabet',
      { ...jpeg(), data: { base64: `${REAL.jpeg.slice(0, -4)}*AA=` } },
      'bad-base64',
    ],
    ['base64 of a length no encoder writes', { ...jpeg(), data: { base64: REAL.jpeg.slice(0, -1) } }, 'bad-base64'],
    ['a byteCount that is not the decoded length', { ...jpeg(), byteCount: 837 }, 'byte-count-mismatch'],
    ['JPEG bytes declared as PNG', { ...jpeg(), mediaType: 'image/png' }, 'type-mismatch'],
    ['dimensions other than the header’s', { ...jpeg(), width: 6 }, 'dimension-mismatch'],
  ])('%s', (_name, raw, reason) => {
    expect(checkImageAttachment(raw)).toEqual({ ok: false, reason })
  })

  it('an animated PNG, whose frames would escape the animation budget, as unreadable', () => {
    const bytes = bytesOf(REAL.apng)
    expect(checkImageAttachment(descriptorFor(bytes, { mediaType: 'image/png', width: 6, height: 4 }))).toEqual({
      ok: false,
      reason: 'unreadable-header',
    })
  })

  it('a PNG whose IHDR is missing, as unreadable', () => {
    const bytes = pngHeader(5, 3)
    bytes.set([0x49, 0x44, 0x41, 0x54], 12) // "IDAT" where IHDR belongs
    expect(checkImageAttachment(descriptorFor(bytes, { mediaType: 'image/png', width: 5, height: 3 }))).toEqual({
      ok: false,
      reason: 'unreadable-header',
    })
  })

  it('base64 longer than any image within the limit, before decoding it', () => {
    const raw = { ...jpeg(), data: { base64: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) } }
    const from = jest.spyOn(Buffer, 'from')
    expect(checkImageAttachment(raw)).toEqual({ ok: false, reason: 'too-large' })
    expect(from).not.toHaveBeenCalled()
    from.mockRestore()
  })
})

// The caps must hold before any native decoder or <Image> sees the bytes: nothing here decodes pixels, and a canvas
// claimed too large is refused whether the descriptor or only the header claims it.
describe('size caps, from the header, without decoding', () => {
  it('refuses a descriptor claiming 4097 × 4097 before decoding its base64', () => {
    const from = jest.spyOn(Buffer, 'from')
    const read = jest.spyOn(header, 'readImageHeader')
    const raw = descriptorFor(pngHeader(4097, 4097), { mediaType: 'image/png', width: 4097, height: 4097 })
    from.mockClear() // descriptorFor encoded the base64 itself
    expect(checkImageAttachment(raw)).toEqual({ ok: false, reason: 'too-many-pixels' })
    expect(from).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    from.mockRestore()
    read.mockRestore()
  })

  it.each([
    ['PNG', pngHeader(4097, 4097), 'image/png'],
    ['JPEG', jpegHeader(4097, 4097), 'image/jpeg'],
    ['GIF', gifOf(4097, 4097, 1), 'image/gif'],
    ['WebP', webpExtended(4097, 4097), 'image/webp'],
  ])('refuses a %s whose header claims 4097 × 4097 under a descriptor claiming 5 × 3', (_name, bytes, mediaType) => {
    // The descriptor lies small, so only the header shows the size: refused as a mismatch, never decoded.
    expect(checkImageAttachment(descriptorFor(bytes, { mediaType, width: 5, height: 3 }))).toEqual({
      ok: false,
      reason: 'dimension-mismatch',
    })
  })

  it('refuses a canvas over a side, over the pixel count, or an animation over its budget', () => {
    expect(sizeFailure(MAX_IMAGE_SIDE + 1, 1)).toBe('too-many-pixels')
    expect(sizeFailure(1, MAX_IMAGE_SIDE + 1)).toBe('too-many-pixels')
    expect(sizeFailure(4096, 4000)).toBe('too-many-pixels') // 16.38 MP, under the side cap
    expect(sizeFailure(1000, 1000, MAX_ANIMATION_PIXELS / 1_000_000 + 1)).toBe('animation-too-large')
    // At each cap exactly, accepted.
    expect(sizeFailure(MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS / MAX_IMAGE_SIDE)).toBeUndefined()
    expect(sizeFailure(1000, 1000, MAX_ANIMATION_PIXELS / 1_000_000)).toBeUndefined()
  })

  it('refuses an animated GIF over the frame budget that is honest about its canvas', () => {
    const bytes = gifOf(1000, 1000, 41) // 41 frames × 1 MP > 40 MP
    expect(checkImageAttachment(descriptorFor(bytes, { mediaType: 'image/gif', width: 1000, height: 1000 }))).toEqual({
      ok: false,
      reason: 'animation-too-large',
    })
    const fits = gifOf(1000, 1000, 40)
    expect(checkImageAttachment(descriptorFor(fits, { mediaType: 'image/gif', width: 1000, height: 1000 })).ok).toBe(
      true
    )
  })
})
