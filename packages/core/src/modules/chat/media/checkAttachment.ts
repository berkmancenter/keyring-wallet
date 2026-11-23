/**
 * Checking a received inline image (rich-messaging-plan.md §4.3, §4.4, §5
 * "Safety") before anything is written to disk or rendered.
 *
 * The descriptor is never trusted alone: its `byteCount`, `mediaType`,
 * `width` and `height` must all agree with the bytes, read in JavaScript by
 * imageHeader.ts. The checks run cheapest first, and the size caps are applied
 * to what the descriptor claims before the base64 is decoded, and again to
 * what the header says after, so an oversized or mis-described image never
 * reaches a native decoder.
 *
 * @module chat/media/checkAttachment
 */

import { Buffer } from 'buffer'

import { IMAGE_MEDIA_TYPES, ImageHeader, ImageMediaType, readImageHeader, sniffMediaType } from './imageHeader'

/** Largest image in one message, in raw bytes (§4.4). */
export const MAX_IMAGE_BYTES = 256 * 1024

/** Longest side accepted (§5, "Safety"). */
export const MAX_IMAGE_SIDE = 4096

/** Largest canvas accepted: 16 megapixels (§5, "Safety"). */
export const MAX_IMAGE_PIXELS = 16_000_000

/**
 * Largest animation accepted, as frames × canvas area: about 160 megabytes of
 * decoded frames at 4 bytes a pixel, which a phone can page through but not
 * hold at once. A 480 × 270 GIF may have about 300 frames; a 4096 × 4096 one,
 * two.
 */
export const MAX_ANIMATION_PIXELS = 40_000_000

/** Longest `id` and `filename` kept from a descriptor; both are display or bookkeeping only. */
export const MAX_DESCRIPTOR_STRING = 256

/** An inline image as it arrives in a chat event's `attachments` (§4.3). */
export interface ImageAttachmentDescriptor {
  id: string
  mediaType: ImageMediaType
  /** Display only: never used as a file name on disk. */
  filename?: string
  byteCount: number
  width: number
  height: number
  data: { base64: string }
}

/** A received image that passed every check: the decoded bytes and what its header says. */
export interface CheckedImage {
  id: string
  filename?: string
  header: ImageHeader
  bytes: Uint8Array
}

export type ImageCheckFailure =
  | 'bad-descriptor'
  | 'unsupported-type'
  | 'too-large'
  | 'bad-base64'
  | 'byte-count-mismatch'
  | 'type-mismatch'
  | 'unreadable-header'
  | 'dimension-mismatch'
  | 'too-many-pixels'
  | 'animation-too-large'

export type ImageCheckResult = { ok: true; image: CheckedImage } | { ok: false; reason: ImageCheckFailure }

const fail = (reason: ImageCheckFailure): ImageCheckResult => ({ ok: false, reason })
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0
const isShortString = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= MAX_DESCRIPTOR_STRING
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Whether a canvas, and an animation's frames over it, are within the caps. */
export function sizeFailure(width: number, height: number, frames = 1): ImageCheckFailure | undefined {
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) return 'too-many-pixels'
  if (frames * width * height > MAX_ANIMATION_PIXELS) return 'animation-too-large'
  return undefined
}

/** Check one received attachment descriptor against its bytes. */
export function checkImageAttachment(raw: unknown): ImageCheckResult {
  if (typeof raw !== 'object' || raw === null) return fail('bad-descriptor')
  const d = raw as Record<string, unknown>
  const data = d.data as Record<string, unknown> | undefined
  if (
    !isShortString(d.id) ||
    (d.filename !== undefined && !isShortString(d.filename)) ||
    !isCount(d.byteCount) ||
    !isCount(d.width) ||
    !isCount(d.height) ||
    typeof data !== 'object' ||
    data === null ||
    typeof data.base64 !== 'string'
  ) {
    return fail('bad-descriptor')
  }
  if (typeof d.mediaType !== 'string' || !(IMAGE_MEDIA_TYPES as readonly string[]).includes(d.mediaType)) {
    return fail('unsupported-type')
  }

  // What the descriptor claims, before decoding anything.
  if (d.byteCount > MAX_IMAGE_BYTES) return fail('too-large')
  const claimed = sizeFailure(d.width, d.height)
  if (claimed) return fail(claimed)

  const base64 = data.base64
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return fail('too-large')
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) return fail('bad-base64')
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (bytes.length !== d.byteCount) return fail('byte-count-mismatch')

  // What the bytes say.
  if (sniffMediaType(bytes) !== d.mediaType) return fail('type-mismatch')
  const header = readImageHeader(bytes)
  if (!header) return fail('unreadable-header')
  if (header.width !== d.width || header.height !== d.height) return fail('dimension-mismatch')
  const actual = sizeFailure(header.width, header.height, header.frames)
  if (actual) return fail(actual)

  return { ok: true, image: { id: d.id, filename: d.filename as string | undefined, header, bytes } }
}
