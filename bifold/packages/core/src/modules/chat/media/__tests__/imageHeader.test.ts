import { readImageHeader, sniffMediaType } from '../imageHeader'
import { REAL, bytesOf, gifOf, jpegHeader, pngHeader, webpExtended } from './fixtures/images'

describe('readImageHeader, on real encoder output', () => {
  it.each([
    ['PNG', REAL.png, 'image/png', 5, 3, 1],
    ['JPEG', REAL.jpeg, 'image/jpeg', 5, 3, 1],
    ['GIF', REAL.gif, 'image/gif', 5, 3, 1],
    ['lossy WebP', REAL.webpLossy, 'image/webp', 5, 3, 1],
    ['lossless WebP', REAL.webpLossless, 'image/webp', 5, 3, 1],
    ['animated GIF', REAL.gifAnimated, 'image/gif', 6, 4, 3],
    ['animated WebP', REAL.webpAnimated, 'image/webp', 6, 4, 3],
  ])('reads a %s', (_name, base64, mediaType, width, height, frames) => {
    expect(readImageHeader(bytesOf(base64))).toEqual({ mediaType, width, height, frames })
  })
})

describe('readImageHeader, on built headers', () => {
  it('reads the full range of each format’s size fields', () => {
    expect(readImageHeader(pngHeader(100000, 70000))).toMatchObject({ width: 100000, height: 70000 })
    expect(readImageHeader(jpegHeader(65535, 65535))).toMatchObject({ width: 65535, height: 65535 })
    expect(readImageHeader(gifOf(65535, 2, 1))).toMatchObject({ width: 65535, height: 2, frames: 1 })
    expect(readImageHeader(webpExtended(16384, 9000))).toMatchObject({ width: 16384, height: 9000, frames: 1 })
  })

  it('counts every frame of an animation', () => {
    expect(readImageHeader(gifOf(10, 10, 250))?.frames).toBe(250)
    expect(readImageHeader(webpExtended(10, 10, 40))?.frames).toBe(40)
  })

  it('skips a JPEG’s fill bytes and segments before the frame header', () => {
    const jpeg = jpegHeader(640, 480)
    const padded = new Uint8Array([...jpeg.subarray(0, 2), 0xff, 0xff, ...jpeg.subarray(2)])
    expect(readImageHeader(padded)).toMatchObject({ width: 640, height: 480 })
  })
})

// An APNG has a still PNG's signature, and its frames are compressed, so hundreds fit in the byte limit: refused, not
// read as one frame (found in review).
describe('readImageHeader refuses an animated PNG', () => {
  it('made by ImageMagick, and built, while the same PNG still is read', () => {
    expect(readImageHeader(bytesOf(REAL.apng))).toBeUndefined()
    expect(readImageHeader(pngHeader(1000, 1000, { animated: true }))).toBeUndefined()
    expect(readImageHeader(pngHeader(1000, 1000))).toEqual({
      mediaType: 'image/png',
      width: 1000,
      height: 1000,
      frames: 1,
    })
  })
})

describe('readImageHeader refuses what it cannot read', () => {
  it.each([
    [
      'a PNG whose IHDR is not 13 bytes',
      (() => {
        const b = pngHeader(10, 10)
        b[11] = 12
        return b
      })(),
    ],
    ['a PNG whose chunks end before any IDAT', pngHeader(10, 10).slice(0, 33)],
    ['a PNG cut inside IHDR', pngHeader(10, 10).subarray(0, 20)],
    [
      'a PNG whose first chunk is not IHDR',
      (() => {
        const b = pngHeader(10, 10)
        b.set([0x49, 0x44, 0x41, 0x54], 12) // "IDAT"
        return b
      })(),
    ],
    ['a JPEG that reaches its scan with no frame header', new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])],
    ['a JPEG cut inside its frame header', jpegHeader(10, 10).subarray(0, 25)],
    ['a GIF with no trailer', gifOf(10, 10, 2).slice(0, -1)],
    ['a GIF with no frames', gifOf(10, 10, 0)],
    [
      'a GIF with an unknown block',
      (() => {
        const b = gifOf(10, 10, 1)
        b[13] = 0x99
        return b
      })(),
    ],
    ['an animated WebP cut inside a frame', webpExtended(10, 10, 3).slice(0, -5)],
    [
      'a WebP whose first chunk is unknown',
      (() => {
        const b = webpExtended(10, 10)
        b.set([0x41, 0x4c, 0x50, 0x48], 12) // "ALPH"
        return b
      })(),
    ],
    ['bytes that are not an image', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], // "%PDF-1"
    ['nothing', new Uint8Array([])],
  ])('%s', (_name, bytes) => {
    expect(readImageHeader(bytes)).toBeUndefined()
  })
})

describe('sniffMediaType', () => {
  it('names the four accepted types by their magic bytes, and nothing else', () => {
    expect(sniffMediaType(bytesOf(REAL.png))).toBe('image/png')
    expect(sniffMediaType(bytesOf(REAL.jpeg))).toBe('image/jpeg')
    expect(sniffMediaType(bytesOf(REAL.gif))).toBe('image/gif')
    expect(sniffMediaType(bytesOf(REAL.webpLossy))).toBe('image/webp')
    // HEIC: an ISO-BMFF "ftyp heic" box.
    expect(
      sniffMediaType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))
    ).toBeUndefined()
  })
})
