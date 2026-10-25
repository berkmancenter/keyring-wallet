/**
 * Image fixtures for the media checks. The `REAL` images were made by real
 * encoders (zlib for the PNG, macOS `sips` for the JPEG and GIF, `cwebp` and
 * `gif2webp` for the WebPs, ImageMagick for the animated GIF and the APNG), so the header
 * readers are proven against encoder output, not only against bytes written to
 * match them. The builders below make headers no encoder would: enormous
 * canvases, truncations, wrong chunks.
 */
import { Buffer } from 'buffer'

export const REAL = {
  // real.png: 5 × 3, 1 frame(s)
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAKUlEQVR4nBXHQQHAQAgDsMpBREUgJ3KQult+SWJiQ1wkNbWlru8M63d8N/cPPeP0ExcAAAAASUVORK5CYII=',
  // real.jpg: 5 × 3, 1 frame(s)
  jpeg: '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAABaADAAQAAAABAAAAAwAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAwAFAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A8f8Ah98OvBH9iD/iTwdux/xrvP8AhXXgj/oDwfkf8ar/AA+/5Ag/Cu8rXN81xX1mp+9lv/Mz7Hw9zrGf2JhP30vhX2n/AJn/2Q==',
  // real.gif: 5 × 3, 1 frame(s)
  gif: 'R0lGODdhBQADAMQAAAAAAAAAeCgAeFAAeHgAeKAAeAA8eCg8eFA8eHg8eKA8eAB4eCh4eFB4eHh4eKB4eP///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAQAAAAALAAAAAAFAAMAAAUNYCAMRGEcSKIsTOM8IQA7',
  // lossy.webp: 5 × 3, 1 frame(s)
  webpLossy:
    'UklGRlIAAABXRUJQVlA4IEYAAAAQAgCdASoFAAMAAUAmJaACdEyAAdWtw84AAP73354HWbze6RTc4uBuGeTZd1bfV//luriA+fGQ/mJWjBxua/+PW/PaMAAA',
  // lossless.webp: 5 × 3, 1 frame(s)
  webpLossless: 'UklGRj4AAABXRUJQVlA4TDIAAAAvBIAAAHcwPAKBZJz8acYZvPkPDQAwjDFmAADAVCQb7z38GlmUkkUlWQSL6H9U+07cJw==',
  // anim.gif: 6 × 4, 3 frame(s)
  gifAnimated:
    'R0lGODlhBgAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAABgAEAAACBISPqVcAIfkEAAAAAAAsAAAAAAYABACAAIAAAAAAAgSEj6lXACH5BAAAAAAALAAAAAAGAAQAgAAA/wAAAAIEhI+pVwA7',
  // anim.webp: 6 × 4, 3 frame(s)
  webpAnimated:
    'UklGRrQAAABXRUJQVlA4WAoAAAACAAAABQAAAwAAQU5JTQYAAAAAAP//AABBTk1GKAAAAAAAAAAAAAUAAAMAAGQAAAJWUDhMDwAAAC8FwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAUAAAMAAGQAAABWUDhMDwAAAC8FwAAAB1DAiP4HIqL/AQBBTk1GKAAAAAAAAAAAAAUAAAMAAGQAAABWUDhMDwAAAC8FwAAABxDR//4HIqL/AQA=',
  // anim-apng.png (ImageMagick APNG): 6 × 4, 3 frames, acTL before the first IDAT
  apng: 'iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAACGFjVEwAAAADAAAAAM7tusAAAAAaZmNUTAAAAAAAAAAGAAAABAAAAAAAAAAAAAEAGQAAPaYYOQAAABRJREFUeJxj/MvAyIAKWBgwAHFCAEzIAQxHVKsnAAAAGmZjVEwAAAABAAAABgAAAAQAAAAAAAAAAAABABkAAKbV8u0AAAAXZmRBVAAAAAJ4nGNkrGNAAyzoAsQKAQAnFwCNBGKJMwAAABpmY1RMAAAAAwAAAAYAAAAEAAAAAAAAAAAAAQAZAABLQyEEAAAAGGZkQVQAAAAEeJxjZGT4y4AKWBgwAHFCAErQAQyqJ1fWAAAAAElFTkSuQmCC',
} as const

export const bytesOf = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, 'base64'))

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff]
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff]
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff]
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const text = (s: string) => [...s].map((c) => c.charCodeAt(0))

/**
 * A PNG signature, an IHDR claiming `width` × `height`, and an empty IDAT; with `animated`, an acTL chunk (3 frames)
 * before the IDAT, as an APNG has. CRCs are zero: the readers do not check them.
 */
export const pngHeader = (width: number, height: number, { animated = false } = {}): Uint8Array =>
  new Uint8Array([
    0x89,
    ...text('PNG'),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...text('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...(animated ? [...be32(8), ...text('acTL'), ...be32(3), ...be32(0), 0, 0, 0, 0] : []),
    ...be32(0),
    ...text('IDAT'),
    0,
    0,
    0,
    0,
  ])

/** A JPEG: SOI, an APP0 segment, then a baseline SOF0 claiming `width` × `height`. */
export const jpegHeader = (width: number, height: number): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...be16(16),
    ...text('JFIF'),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    ...be16(11),
    8,
    ...be16(height),
    ...be16(width),
    1,
    1,
    0x11,
    0,
  ])

/** A GIF89a canvas of `width` × `height` with `frames` one-pixel image descriptors and no colour tables. */
export const gifOf = (width: number, height: number, frames: number): Uint8Array => {
  const frame = [0x2c, 0, 0, 0, 0, ...le16(1), ...le16(1), 0, 2, 2, 0x4c, 0x01, 0]
  return new Uint8Array([
    ...text('GIF89a'),
    ...le16(width),
    ...le16(height),
    0,
    0,
    0,
    ...Array(frames).fill(frame).flat(),
    0x3b,
  ])
}

/** An extended WebP (VP8X) canvas; animated with `frames` empty ANMF chunks when `frames` > 1. */
export const webpExtended = (width: number, height: number, frames = 1): Uint8Array => {
  const vp8x = [...text('VP8X'), ...le32(10), frames > 1 ? 0x02 : 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]
  const anmf =
    frames > 1
      ? Array(frames)
          .fill([...text('ANMF'), ...le32(16), ...Array(16).fill(0)])
          .flat()
      : []
  const body = [...text('WEBP'), ...vp8x, ...anmf]
  return new Uint8Array([...text('RIFF'), ...le32(body.length), ...body])
}

/** A descriptor for `bytes`, as a sender would write it; `overrides` replace any field. */
export const descriptorFor = (
  bytes: Uint8Array,
  meta: { mediaType: string; width: number; height: number },
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 'a1',
  mediaType: meta.mediaType,
  filename: 'IMG_0412.jpg',
  byteCount: bytes.length,
  width: meta.width,
  height: meta.height,
  data: { base64: Buffer.from(bytes).toString('base64') },
  ...overrides,
})
