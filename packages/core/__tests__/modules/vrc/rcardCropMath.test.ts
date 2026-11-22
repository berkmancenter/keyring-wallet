import {
  centeredSquareCrop,
  clampTranslation,
  coverScale,
  cropRectFromTransform,
} from '../../../src/modules/vrc/utils/rcardCropMath'

// The module says it is kept free of gesture and rendering code so it can be
// tested without a native runtime; these are that test. Both bugs this code
// was fixed for — a transform that wasn't a worklet, and a viewport that
// wasn't centred on an oversized image — were found by hand on a device, and
// the second is a property of these functions alone.

const VIEWPORT = 300

describe('coverScale', () => {
  it('maps the smaller source dimension onto the viewport', () => {
    // Landscape: height is the constraint.
    expect(coverScale(1200, 600, VIEWPORT)).toBe(0.5)
    // Portrait: width is.
    expect(coverScale(600, 1200, VIEWPORT)).toBe(0.5)
    // Square: either.
    expect(coverScale(600, 600, VIEWPORT)).toBe(0.5)
  })

  it('scales up an image smaller than the viewport', () => {
    expect(coverScale(150, 200, VIEWPORT)).toBe(2)
  })
})

describe('clampTranslation', () => {
  const scale = coverScale(1200, 600, VIEWPORT) // 0.5 → displayed 600x300

  it('allows panning along the overhanging axis only', () => {
    // 600 wide displayed against a 300 viewport leaves 150 either side.
    expect(clampTranslation(1200, 600, VIEWPORT, scale, 999, 0).x).toBe(150)
    expect(clampTranslation(1200, 600, VIEWPORT, scale, -999, 0).x).toBe(-150)
    // The short axis fits exactly, so there is nothing to pan into.
    // `toBeCloseTo` rather than `toBe`: clamping a negative translation to a
    // zero bound yields -0, which is the same position by every measure that
    // matters here and only distinguishable by Object.is.
    expect(clampTranslation(1200, 600, VIEWPORT, scale, 0, 999).y).toBeCloseTo(0, 10)
    expect(clampTranslation(1200, 600, VIEWPORT, scale, 0, -999).y).toBeCloseTo(0, 10)
  })

  it('leaves a translation inside the bounds alone', () => {
    expect(clampTranslation(1200, 600, VIEWPORT, scale, 40, 0)).toEqual({ x: 40, y: 0 })
  })

  it('never lets the image edge into the viewport, at any zoom', () => {
    // The invariant the clamp exists for: whatever the user pinches to, the
    // viewport stays fully covered. Checked across a range rather than at one
    // hand-picked zoom.
    for (const zoom of [1, 1.5, 2, 3.7, 8]) {
      const s = coverScale(1200, 600, VIEWPORT) * zoom
      const { x, y } = clampTranslation(1200, 600, VIEWPORT, s, 10_000, 10_000)
      const halfOverhangX = (1200 * s - VIEWPORT) / 2
      const halfOverhangY = (600 * s - VIEWPORT) / 2
      expect(Math.abs(x)).toBeLessThanOrEqual(halfOverhangX + 1e-9)
      expect(Math.abs(y)).toBeLessThanOrEqual(halfOverhangY + 1e-9)
    }
  })

  it('pins a too-small image to the centre rather than letting it drift', () => {
    // Below cover scale there is no overhang to pan into; the clamp must
    // collapse to zero instead of going negative.
    const tooSmall = coverScale(1200, 600, VIEWPORT) / 2
    expect(clampTranslation(1200, 600, VIEWPORT, tooSmall, 500, 500)).toEqual({ x: 0, y: 0 })
  })
})

describe('cropRectFromTransform', () => {
  it('starts on the centred square — the case that was wrong on device', () => {
    // The module documents this exactly: at translate (0,0) and cover scale,
    // the crop resolves to the largest centred square. An oversized image is
    // the shape that exposed the centring bug, so it is the one asserted.
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [1200, 600],
      [601, 1199],
    ]) {
      const scale = coverScale(w, h, VIEWPORT)
      const rect = cropRectFromTransform(w, h, VIEWPORT, scale, 0, 0)
      const centred = centeredSquareCrop(w, h)!
      expect(rect.width).toBeCloseTo(centred.width, 6)
      expect(rect.originX).toBeCloseTo(centred.originX, 0)
      expect(rect.originY).toBeCloseTo(centred.originY, 0)
    }
  })

  it('reads a square of source pixels that shrinks as the user zooms in', () => {
    const scale = coverScale(1200, 600, VIEWPORT)
    const wide = cropRectFromTransform(1200, 600, VIEWPORT, scale, 0, 0)
    const zoomed = cropRectFromTransform(1200, 600, VIEWPORT, scale * 2, 0, 0)
    expect(wide.width).toBe(600)
    expect(zoomed.width).toBe(300)
    expect(zoomed.height).toBe(zoomed.width)
  })

  it('moves the crop opposite to the pan, because the image moves under it', () => {
    const scale = coverScale(1200, 600, VIEWPORT)
    const centre = cropRectFromTransform(1200, 600, VIEWPORT, scale, 0, 0)
    // Dragging the image right shows content from further LEFT in the source.
    const draggedRight = cropRectFromTransform(1200, 600, VIEWPORT, scale, 100, 0)
    expect(draggedRight.originX).toBeLessThan(centre.originX)
  })

  it('never returns a rect that runs off the source image', () => {
    const scale = coverScale(1200, 600, VIEWPORT)
    for (const tx of [-10_000, -500, 0, 500, 10_000]) {
      const rect = cropRectFromTransform(1200, 600, VIEWPORT, scale, tx, 0)
      expect(rect.originX).toBeGreaterThanOrEqual(0)
      expect(rect.originX + rect.width).toBeLessThanOrEqual(1200 + 1e-9)
      expect(rect.originY).toBeGreaterThanOrEqual(0)
      expect(rect.originY + rect.height).toBeLessThanOrEqual(600 + 1e-9)
    }
  })
})

describe('centeredSquareCrop', () => {
  it('takes the largest centred square from a rectangle', () => {
    expect(centeredSquareCrop(1200, 600)).toEqual({ originX: 300, originY: 0, width: 600, height: 600 })
    expect(centeredSquareCrop(600, 1200)).toEqual({ originX: 0, originY: 300, width: 600, height: 600 })
  })

  it('declines to crop when there is nothing to crop', () => {
    // An already-square photo, or one whose dimensions are not known yet.
    expect(centeredSquareCrop(800, 800)).toBeUndefined()
    expect(centeredSquareCrop(undefined, 600)).toBeUndefined()
    expect(centeredSquareCrop(800, undefined)).toBeUndefined()
    expect(centeredSquareCrop(0, 0)).toBeUndefined()
  })

  it('keeps the offset a whole pixel', () => {
    // An odd difference would otherwise land on a half pixel, which an image
    // cropper cannot honour.
    const rect = centeredSquareCrop(601, 1199)!
    expect(Number.isInteger(rect.originX)).toBe(true)
    expect(Number.isInteger(rect.originY)).toBe(true)
  })
})
