/**
 * What an image is and how big it claims to be, read from its first bytes in
 * JavaScript (rich-messaging-plan.md §5, "Safety"). Nothing here decodes
 * pixels: a received image is checked against these numbers before any native
 * decoder or `<Image>` sees it, so a header claiming an enormous canvas is
 * refused without ever being decoded.
 *
 * Every reader is bounded by the bytes it is given and returns undefined for
 * anything truncated or malformed, never a guess.
 *
 * @module chat/media/imageHeader
 */

/** The only image types chat accepts (§4.3): what senders produce. */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export interface ImageHeader {
  mediaType: ImageMediaType
  width: number
  height: number
  /** Frames in an animation (GIF, animated WebP); 1 for a still image. */
  frames: number
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0)
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))

/** The type the magic bytes name, or undefined for anything else. */
export function sniffMediaType(b: Uint8Array): ImageMediaType | undefined {
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    ascii(b, 1, 3) === 'PNG' &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'image/gif'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp'
  return undefined
}

/** The image's type, dimensions and frame count from its header, or undefined if it cannot be read. */
export function readImageHeader(b: Uint8Array): ImageHeader | undefined {
  switch (sniffMediaType(b)) {
    case 'image/png':
      return readPng(b)
    case 'image/jpeg':
      return readJpeg(b)
    case 'image/gif':
      return readGif(b)
    case 'image/webp':
      return readWebp(b)
    default:
      return undefined
  }
}

// The first chunk is IHDR (13 bytes): width and height as big-endian 32-bit. An animated PNG has the same signature,
// and its frames are compressed, so hundreds fit in the byte limit: one with an acTL chunk before its first IDAT is
// refused rather than counted. Senders produce still PNGs, so nothing a Keyring phone sends is lost.
// This assumes decoders honour acTL only before the first IDAT, as the APNG specification requires: a lenient decoder
// that animated a later acTL would animate an image read here as one frame.
function readPng(b: Uint8Array): ImageHeader | undefined {
  if (b.length < 24 || u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return undefined
  let i = 8
  while (i + 8 <= b.length) {
    const type = ascii(b, i + 4, 4)
    if (type === 'acTL') return undefined
    if (type === 'IDAT') return { mediaType: 'image/png', width: u32be(b, 16), height: u32be(b, 20), frames: 1 }
    // Length, type, data, CRC.
    i += 12 + u32be(b, i)
  }
  return undefined
}

// The first start-of-frame marker (C0–CF, except C4 DHT, C8 JPG and CC DAC) holds the height, then the width.
function readJpeg(b: Uint8Array): ImageHeader | undefined {
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return undefined
    const marker = b[i + 1]
    if (marker === 0xff) {
      i += 1 // fill byte
      continue
    }
    // Markers with no length: TEM and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    // Start of scan or end of image before any frame header: there is no size to read.
    if (marker === 0xda || marker === 0xd9) return undefined
    const length = u16be(b, i + 2)
    if (length < 2) return undefined
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      if (i + 9 > b.length) return undefined
      return { mediaType: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7), frames: 1 }
    }
    i += 2 + length
  }
  return undefined
}

// The logical screen descriptor holds the canvas; every image descriptor (0x2C) is a frame. The walk skips colour
// tables, extension blocks and image data sub-blocks, and fails on anything truncated rather than stopping early.
function readGif(b: Uint8Array): ImageHeader | undefined {
  if (b.length < 13) return undefined
  const width = u16le(b, 6)
  const height = u16le(b, 8)
  let i = 13
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1))
  let frames = 0
  const skipSubBlocks = (from: number): number | undefined => {
    let j = from
    while (j < b.length) {
      const size = b[j]
      if (size === 0) return j + 1
      j += 1 + size
    }
    return undefined
  }
  while (i < b.length) {
    const block = b[i]
    if (block === 0x3b) return frames > 0 ? { mediaType: 'image/gif', width, height, frames } : undefined
    if (block === 0x21) {
      if (i + 2 > b.length) return undefined
      const next = skipSubBlocks(i + 2)
      if (next === undefined) return undefined
      i = next
    } else if (block === 0x2c) {
      if (i + 10 > b.length) return undefined
      const flags = b[i + 9]
      let j = i + 10
      if (flags & 0x80) j += 3 * (1 << ((flags & 0x07) + 1))
      // The LZW minimum code size, then the image data's sub-blocks.
      const next = skipSubBlocks(j + 1)
      if (next === undefined) return undefined
      frames += 1
      i = next
    } else {
      return undefined
    }
  }
  return undefined
}

// RIFF chunks after "WEBP": VP8 (lossy), VP8L (lossless) or VP8X (extended, with the canvas size and, for an
// animation, one ANMF chunk per frame).
function readWebp(b: Uint8Array): ImageHeader | undefined {
  if (b.length < 30) return undefined
  const first = ascii(b, 12, 4)
  if (first === 'VP8 ') {
    // A key frame's start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined
    return { mediaType: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, frames: 1 }
  }
  if (first === 'VP8L') {
    if (b[20] !== 0x2f) return undefined
    const bits = u32le(b, 21)
    return { mediaType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, frames: 1 }
  }
  if (first === 'VP8X') {
    const width = u24le(b, 24) + 1
    const height = u24le(b, 27) + 1
    const animated = (b[20] & 0x02) !== 0
    if (!animated) return { mediaType: 'image/webp', width, height, frames: 1 }
    let frames = 0
    let i = 12
    while (i + 8 <= b.length) {
      const size = u32le(b, i + 4)
      if (ascii(b, i, 4) === 'ANMF') frames += 1
      // Chunks are padded to an even size.
      i += 8 + size + (size & 1)
    }
    if (i !== b.length && i !== b.length + 1) return undefined
    return frames > 0 ? { mediaType: 'image/webp', width, height, frames } : undefined
  }
  return undefined
}
