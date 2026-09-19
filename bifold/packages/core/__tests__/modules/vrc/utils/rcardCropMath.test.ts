import {
  centeredSquareCrop,
  clampTranslation,
  coverScale,
  cropRectFromTransform,
} from '../../../../src/modules/vrc/utils/rcardCropMath'

describe('centeredSquareCrop', () => {
  test('returns the largest centered square for a landscape source', () => {
    expect(centeredSquareCrop(1200, 800)).toEqual({ originX: 200, originY: 0, width: 800, height: 800 })
  })

  test('returns the largest centered square for a portrait source', () => {
    expect(centeredSquareCrop(800, 1200)).toEqual({ originX: 0, originY: 200, width: 800, height: 800 })
  })

  test('returns undefined for an already-square source', () => {
    expect(centeredSquareCrop(500, 500)).toBeUndefined()
  })

  test('returns undefined when either dimension is missing', () => {
    expect(centeredSquareCrop(undefined, 500)).toBeUndefined()
    expect(centeredSquareCrop(500, undefined)).toBeUndefined()
    expect(centeredSquareCrop()).toBeUndefined()
  })
})

describe('coverScale', () => {
  test('scales the smaller dimension up to exactly fill the viewport (landscape source)', () => {
    // 1200x800 -> smaller dimension (800) must map to a 300 viewport
    expect(coverScale(1200, 800, 300)).toBeCloseTo(300 / 800)
  })

  test('scales the smaller dimension up to exactly fill the viewport (portrait source)', () => {
    expect(coverScale(800, 1200, 300)).toBeCloseTo(300 / 800)
  })

  test('is 1 for a source already equal to the viewport size', () => {
    expect(coverScale(300, 300, 300)).toBe(1)
  })
})

describe('clampTranslation', () => {
  test('leaves translation unchanged when the image only just covers the viewport', () => {
    // At coverScale, displayWidth or displayHeight equals viewportSize exactly
    // on the constrained axis, so no translation is allowed on that axis.
    const scale = coverScale(1200, 800, 300)
    expect(clampTranslation(1200, 800, 300, scale, 0, 0)).toEqual({ x: expect.any(Number), y: 0 })
  })

  test('clamps panning past the image edge on the constrained axis', () => {
    const scale = coverScale(1200, 800, 300) // height is fully constrained (no vertical slack)
    const clamped = clampTranslation(1200, 800, 300, scale, 0, 999)
    expect(clamped.y).toBe(0)
  })

  test('allows panning within slack on the unconstrained axis, clamped at the edge', () => {
    const scale = coverScale(1200, 800, 300) // width has slack: displayWidth > 300
    const displayWidth = 1200 * scale
    const maxX = (displayWidth - 300) / 2

    expect(clampTranslation(1200, 800, 300, scale, maxX / 2, 0).x).toBeCloseTo(maxX / 2)
    expect(clampTranslation(1200, 800, 300, scale, 999999, 0).x).toBeCloseTo(maxX)
    expect(clampTranslation(1200, 800, 300, scale, -999999, 0).x).toBeCloseTo(-maxX)
  })

  test('has no slack on either axis once zoomed to exactly cover a square source', () => {
    expect(clampTranslation(500, 500, 300, coverScale(500, 500, 300), 500, 500)).toEqual({ x: 0, y: 0 })
  })
})

describe('cropRectFromTransform', () => {
  test('at the initial (untouched) transform, matches centeredSquareCrop exactly', () => {
    const scale = coverScale(1200, 800, 300)
    expect(cropRectFromTransform(1200, 800, 300, scale, 0, 0)).toEqual(centeredSquareCrop(1200, 800))
  })

  test('panning right (positive translateX) moves the visible source rect left', () => {
    const scale = coverScale(1200, 800, 300)
    const displayWidth = 1200 * scale
    const maxX = (displayWidth - 300) / 2

    const centered = cropRectFromTransform(1200, 800, 300, scale, 0, 0)
    const pannedRight = cropRectFromTransform(1200, 800, 300, scale, maxX, 0)

    expect(pannedRight.originX).toBeLessThan(centered.originX)
    expect(pannedRight.originX).toBeCloseTo(0) // panned fully to the image's left edge
  })

  test('panning left (negative translateX) moves the visible source rect right, to the far edge', () => {
    const scale = coverScale(1200, 800, 300)
    const displayWidth = 1200 * scale
    const maxX = (displayWidth - 300) / 2

    const pannedLeft = cropRectFromTransform(1200, 800, 300, scale, -maxX, 0)

    expect(pannedLeft.originX).toBeCloseTo(1200 - pannedLeft.width)
  })

  test('zooming in shrinks the visible source rect (crops tighter)', () => {
    const baseScale = coverScale(1200, 800, 300)
    const zoomed = cropRectFromTransform(1200, 800, 300, baseScale * 2, 0, 0)
    const notZoomed = cropRectFromTransform(1200, 800, 300, baseScale, 0, 0)

    expect(zoomed.width).toBeLessThan(notZoomed.width)
    expect(zoomed.width).toBeCloseTo(notZoomed.width / 2)
  })

  test('never returns a rect that exceeds the source image bounds', () => {
    const scale = coverScale(1200, 800, 300)
    const rect = cropRectFromTransform(1200, 800, 300, scale, 999999, 999999)

    expect(rect.originX).toBeGreaterThanOrEqual(0)
    expect(rect.originY).toBeGreaterThanOrEqual(0)
    expect(rect.originX + rect.width).toBeLessThanOrEqual(1200 + 0.001)
    expect(rect.originY + rect.height).toBeLessThanOrEqual(800 + 0.001)
  })
})
