/**
 * Making a picked photo or GIF fit one chat message (rich-messaging-plan.md
 * §4.4, "What fits").
 *
 * A photo is always re-encoded, however small: resized to 1600 px on its long
 * edge and saved as JPEG at quality 0.8, then 0.6, then 0.4, then smaller
 * still, until it fits 256 KiB. The re-encode is what strips EXIF, GPS
 * included (the manipulator writes the pixels, not the source's metadata), so
 * it is never skipped. A very large photo is first resized once on its own, so
 * the quality steps decode the small copy rather than the original again.
 *
 * A GIF is sent as it is, since re-encoding would lose its animation, and only
 * if it fits. It keeps whatever metadata it carries; the send sheet says so.
 *
 * The manipulator and the file reader are passed in, as processRCardPhoto
 * does, so this runs under Jest without the native modules. The result is
 * checked here by its own header, and again by the sender's descriptor check,
 * before anything is sent.
 *
 * @module chat/media/prepare
 */

import { Buffer } from 'buffer'

import type { ManipulateAction, ManipulateAsyncFn } from '../../vrc/utils/rcardPhoto'
import { MAX_IMAGE_BYTES, sizeFailure } from './checkAttachment'
import { readImageHeader } from './imageHeader'
import type { ImageMediaType } from './imageHeader'

/** Long edge a photo is resized to. */
export const PHOTO_MAX_SIDE = 1600

/** Quality steps tried at each size, most faithful first. */
export const PHOTO_QUALITIES = [0.8, 0.6, 0.4] as const

/** Each further size step, as a share of the one before. */
const SHRINK = 0.75

/** Smallest long edge tried before giving up. */
export const PHOTO_MIN_SIDE = 320

/** A photo this large (50 megapixels and up) is resized once before the quality steps. */
export const HUGE_PHOTO_PIXELS = 50_000_000

export interface PickedPhoto {
  uri: string
  width: number
  height: number
  /** As the picker reports it; a GIF is recognised by its bytes, not by this alone. */
  mimeType?: string
}

/** A photo ready to send: its bytes as base64 and what its header says. */
export interface PreparedPhoto {
  mediaType: ImageMediaType
  base64: string
  byteCount: number
  width: number
  height: number
}

export type ChatPhotoProblem = 'gif-too-large' | 'photo-too-large' | 'unreadable'

export class ChatPhotoError extends Error {
  constructor(public readonly problem: ChatPhotoProblem) {
    super(`chat photo: ${problem}`)
    this.name = 'ChatPhotoError'
  }
}

export interface PrepareTools {
  manipulate: ManipulateAsyncFn
  /** The file at `uri` as base64. */
  readBase64: (uri: string) => Promise<string>
}

const isGif = (photo: PickedPhoto) => photo.mimeType === 'image/gif' || /\.gif$/i.test(photo.uri)

function scaled(width: number, height: number, longSide: number): { width: number; height: number } {
  const factor = Math.min(1, longSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) }
}

// The header of what was made, and that it is what the sender meant to make.
function described(base64: string, mediaType: ImageMediaType): PreparedPhoto | undefined {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  const header = readImageHeader(bytes)
  if (!header || header.mediaType !== mediaType || sizeFailure(header.width, header.height, header.frames)) {
    return undefined
  }
  return { mediaType, base64, byteCount: bytes.length, width: header.width, height: header.height }
}

/** Fit a picked photo or GIF to one message, or throw a ChatPhotoError saying why it cannot. */
export async function prepareChatPhoto(photo: PickedPhoto, tools: PrepareTools): Promise<PreparedPhoto> {
  if (isGif(photo)) {
    const base64 = await tools.readBase64(photo.uri)
    const prepared = described(base64, 'image/gif')
    if (!prepared) throw new ChatPhotoError('unreadable')
    if (prepared.byteCount > MAX_IMAGE_BYTES) throw new ChatPhotoError('gif-too-large')
    return prepared
  }

  let source = photo.uri
  let size = scaled(photo.width, photo.height, PHOTO_MAX_SIDE)
  if (photo.width * photo.height >= HUGE_PHOTO_PIXELS) {
    const once = await tools.manipulate(source, [{ resize: size }], { compress: 1, format: 'jpeg' })
    source = once.uri
    size = { width: once.width, height: once.height }
  }

  // The photo's own size first, however small; then smaller steps, down to the smallest worth sending.
  const first = Math.max(size.width, size.height)
  const longSides = [first]
  for (let next = Math.floor(first * SHRINK); next >= PHOTO_MIN_SIDE; next = Math.floor(next * SHRINK))
    longSides.push(next)
  for (const longSide of longSides) {
    const actions: ManipulateAction[] = [{ resize: scaled(size.width, size.height, longSide) }]
    for (const compress of PHOTO_QUALITIES) {
      const result = await tools.manipulate(source, actions, { compress, format: 'jpeg', base64: true })
      if (!result.base64) throw new ChatPhotoError('unreadable')
      const prepared = described(result.base64, 'image/jpeg')
      if (!prepared) throw new ChatPhotoError('unreadable')
      if (prepared.byteCount <= MAX_IMAGE_BYTES) return prepared
    }
  }
  throw new ChatPhotoError('photo-too-large')
}
