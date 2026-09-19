/**
 * Pure geometry for the R-Card photo crop modal (RCardPhotoCropModal.tsx):
 * a pinch/pan square-crop viewport over a picked photo. Kept separate from
 * any gesture/rendering code so it's unit-testable without a native runtime.
 *
 * The image is displayed "cover"-fit inside a square viewport — its smaller
 * source dimension maps exactly to the viewport size — then the user pans
 * and pinch-zooms it. All positions/transforms below are DISPLAY pixels,
 * centered on the viewport (i.e. (0,0) translation = image and viewport
 * concentric); `cropRectFromTransform` converts the current transform back
 * into a crop rectangle in the source image's own pixel coordinates.
 */

export interface CropRect {
  originX: number
  originY: number
  width: number
  height: number
}

/** The scale at which an `imageWidth`x`imageHeight` image exactly covers a
 *  `viewportSize` square — the smaller source dimension fills the viewport,
 *  matching resizeMode: 'cover'. This is the minimum zoom the crop modal
 *  allows: below it, part of the viewport would show empty space. */
export const coverScale = (imageWidth: number, imageHeight: number, viewportSize: number): number =>
  viewportSize / Math.min(imageWidth, imageHeight)

/** Clamps a center-anchored display-pixel translation so the `viewportSize`
 *  square viewport stays fully covered by the image at the given `scale` —
 *  i.e. the user can't pan the image's edge into view.
 *
 *  Marked as a worklet: RCardPhotoCropModal calls this directly from its
 *  pan/pinch gesture callbacks, which Reanimated runs on the UI thread —
 *  calling a plain (non-worklet) function from there throws at runtime. */
export const clampTranslation = (
  imageWidth: number,
  imageHeight: number,
  viewportSize: number,
  scale: number,
  translateX: number,
  translateY: number
): { x: number; y: number } => {
  'worklet'
  const displayWidth = imageWidth * scale
  const displayHeight = imageHeight * scale
  const maxX = Math.max(0, (displayWidth - viewportSize) / 2)
  const maxY = Math.max(0, (displayHeight - viewportSize) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, translateX)),
    y: Math.min(maxY, Math.max(-maxY, translateY)),
  }
}

/** The square region of the source image (in its own pixel coordinates)
 *  currently visible in a `viewportSize` square viewport, given the image is
 *  displayed at `scale` and center-anchored-offset by (translateX,
 *  translateY) display pixels. Inverse of the display transform: a positive
 *  translateX moves the image right on screen, so the viewport is now
 *  showing content from further left in the source image. */
export const cropRectFromTransform = (
  imageWidth: number,
  imageHeight: number,
  viewportSize: number,
  scale: number,
  translateX: number,
  translateY: number
): CropRect => {
  const sourceViewport = viewportSize / scale
  const centerX = imageWidth / 2 - translateX / scale
  const centerY = imageHeight / 2 - translateY / scale
  return {
    originX: clampOrigin(centerX - sourceViewport / 2, imageWidth, sourceViewport),
    originY: clampOrigin(centerY - sourceViewport / 2, imageHeight, sourceViewport),
    width: sourceViewport,
    height: sourceViewport,
  }
}

const clampOrigin = (origin: number, dimension: number, size: number): number =>
  Math.min(Math.max(origin, 0), Math.max(0, dimension - size))

/** The largest square centered in a `width`x`height` source image — the crop
 *  modal's starting position/zoom (translate (0,0), scale = coverScale)
 *  resolves to exactly this rect. Returns undefined when the dimensions are
 *  unknown or already square, since no caller needs a crop action then. */
export const centeredSquareCrop = (width?: number, height?: number): CropRect | undefined => {
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
