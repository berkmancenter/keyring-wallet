/**
 * Resize/compress pipeline for R-Card profile photos.
 *
 * See docs/plans/rcard-profile-picture-plan.md §3.3/§3.4: the photo is
 * center-cropped to a square, resized to a bounding box, JPEG-compressed at
 * successively lower quality until it fits the byte budget, and returned as
 * a data:image/jpeg;base64,... URI. The manipulator (expo-image-manipulator's
 * manipulateAsync) is injected rather than imported directly so this module
 * stays unit-testable without a native runtime — RCardForm.tsx supplies the
 * real implementation.
 *
 * The square crop happens here, in-app, rather than via the OS picker's own
 * `allowsEditing` crop UI — see docs/plans/rcard-profile-picture-plan/2026-09-18-bam.md:
 * that native crop step was found to sometimes hand back a stale/unrelated
 * previously-cropped image instead of the one just picked, a known
 * expo-image-picker/Android issue. Cropping the picker's own fresh source URI
 * ourselves removes that failure mode entirely.
 *
 * EXIF orientation and GPS/ICC metadata are handled by the manipulator: it
 * re-encodes the pixel buffer (after baking in orientation) rather than
 * copying source metadata, so a plain crop+resize+compress pass already
 * strips them without extra work here.
 */

/** Bounding-box side length in pixels, after this module's own center-square crop. */
export const RCARD_PHOTO_MAX_DIMENSION = 256

/** Budget for the base64 payload itself (excludes the `data:...;base64,` prefix). */
export const RCARD_PHOTO_MAX_BASE64_BYTES = 12 * 1024

/** Compression quality tiers tried in order, most-faithful first. */
const COMPRESSION_QUALITIES = [0.8, 0.6, 0.4, 0.25, 0.15]

export interface ManipulatedImageResult {
  uri: string
  width: number
  height: number
  base64?: string
}

export interface ManipulateAction {
  crop?: { originX: number; originY: number; width: number; height: number }
  resize?: { width?: number; height?: number }
}

export interface ManipulateSaveOptions {
  compress?: number
  format?: 'jpeg'
  base64?: boolean
}

/** Matches expo-image-manipulator's `manipulateAsync` signature. */
export type ManipulateAsyncFn = (
  uri: string,
  actions: ManipulateAction[],
  saveOptions: ManipulateSaveOptions
) => Promise<ManipulatedImageResult>

export class RCardPhotoTooLargeError extends Error {
  constructor(public readonly smallestAttemptBytes: number) {
    super(
      `RCard photo could not be compressed under ${RCARD_PHOTO_MAX_BASE64_BYTES} bytes ` +
        `(smallest attempt: ${smallestAttemptBytes} bytes)`
    )
    this.name = 'RCardPhotoTooLargeError'
  }
}

/**
 * The largest square centered in a `width`x`height` source image. Returns
 * undefined when the dimensions are unknown or already square — cropping a
 * square to itself is a no-op not worth the extra manipulator action.
 */
export const centeredSquareCrop = (
  width?: number,
  height?: number
): { originX: number; originY: number; width: number; height: number } | undefined => {
  if (!width || !height || width === height) {
    return undefined
  }

  const side = Math.min(width, height)
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  }
}

/**
 * Center-crop a captured/picked photo to a square, resize it to the R-Card
 * photo bounding box, and JPEG-compress it down to the byte budget, returning
 * a base64 data URI.
 *
 * `sourceWidth`/`sourceHeight` are the picked asset's own dimensions (from
 * the image picker result) — passing them lets this function crop to a
 * centered square itself rather than trusting the picker to have done so.
 *
 * Throws RCardPhotoTooLargeError if even the lowest compression quality
 * doesn't fit the budget (callers should surface this as a user-facing,
 * actionable error rather than silently truncating or failing).
 */
export async function processRCardPhoto(
  sourceUri: string,
  manipulateAsync: ManipulateAsyncFn,
  sourceWidth?: number,
  sourceHeight?: number
): Promise<string> {
  let smallestAttemptBytes = Infinity
  const crop = centeredSquareCrop(sourceWidth, sourceHeight)
  const actions: ManipulateAction[] = [
    ...(crop ? [{ crop }] : []),
    { resize: { width: RCARD_PHOTO_MAX_DIMENSION, height: RCARD_PHOTO_MAX_DIMENSION } },
  ]

  for (const quality of COMPRESSION_QUALITIES) {
    const result = await manipulateAsync(sourceUri, actions, { compress: quality, format: 'jpeg', base64: true })

    if (!result.base64) {
      throw new Error('Image manipulation did not return base64 data')
    }

    // Base64 is pure ASCII, so string length === byte length (no Buffer/Node
    // API needed — this file runs in the React Native runtime).
    const byteLength = result.base64.length
    smallestAttemptBytes = Math.min(smallestAttemptBytes, byteLength)

    if (byteLength <= RCARD_PHOTO_MAX_BASE64_BYTES) {
      return `data:image/jpeg;base64,${result.base64}`
    }
  }

  throw new RCardPhotoTooLargeError(smallestAttemptBytes)
}
