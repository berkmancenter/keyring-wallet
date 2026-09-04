import {
  processRCardPhoto,
  RCardPhotoTooLargeError,
  RCARD_PHOTO_MAX_DIMENSION,
  RCARD_PHOTO_MAX_BASE64_BYTES,
  ManipulateAsyncFn,
} from '../../../../src/modules/vrc/utils/rcardPhoto'

/** Build a fake manipulateAsync that reports the requested resize dimensions
 *  back and returns a base64 payload of a controlled length for a given
 *  compression quality — standing in for real JPEG compression without a
 *  native runtime. */
function fakeManipulator(bytesByQuality: Record<number, number>): ManipulateAsyncFn {
  return jest.fn(async (_uri, actions, saveOptions) => {
    const resize = actions[0]?.resize
    const quality = saveOptions.compress ?? 1
    const bytes = bytesByQuality[quality] ?? 20 * 1024
    return {
      uri: 'file:///processed.jpg',
      width: resize?.width ?? 0,
      height: resize?.height ?? 0,
      base64: 'A'.repeat(bytes),
    }
  })
}

describe('processRCardPhoto', () => {
  test('resizes to the bounding box and returns a data URI when the first quality tier fits', async () => {
    const manipulateAsync = fakeManipulator({ 0.8: 8 * 1024 })

    const dataUri = await processRCardPhoto('file:///source.jpg', manipulateAsync)

    expect(manipulateAsync).toHaveBeenCalledWith(
      'file:///source.jpg',
      [{ resize: { width: RCARD_PHOTO_MAX_DIMENSION, height: RCARD_PHOTO_MAX_DIMENSION } }],
      { compress: 0.8, format: 'jpeg', base64: true }
    )
    expect(dataUri.startsWith('data:image/jpeg;base64,')).toBe(true)
    const base64 = dataUri.slice('data:image/jpeg;base64,'.length)
    expect(base64.length).toBeLessThanOrEqual(RCARD_PHOTO_MAX_BASE64_BYTES)
  })

  test('falls back to a lower compression quality when the first attempt exceeds the budget', async () => {
    const manipulateAsync = fakeManipulator({
      0.8: RCARD_PHOTO_MAX_BASE64_BYTES + 1024,
      0.6: RCARD_PHOTO_MAX_BASE64_BYTES + 512,
      0.4: 6 * 1024,
    })

    const dataUri = await processRCardPhoto('file:///source.jpg', manipulateAsync)

    expect(manipulateAsync).toHaveBeenCalledTimes(3)
    expect(manipulateAsync).toHaveBeenLastCalledWith(
      'file:///source.jpg',
      [{ resize: { width: RCARD_PHOTO_MAX_DIMENSION, height: RCARD_PHOTO_MAX_DIMENSION } }],
      { compress: 0.4, format: 'jpeg', base64: true }
    )
    const base64 = dataUri.slice('data:image/jpeg;base64,'.length)
    expect(base64).toHaveLength(6 * 1024)
  })

  test('throws RCardPhotoTooLargeError when no quality tier fits the budget', async () => {
    const manipulateAsync = fakeManipulator({
      0.8: 20 * 1024,
      0.6: 18 * 1024,
      0.4: 16 * 1024,
      0.25: 14 * 1024,
      0.15: RCARD_PHOTO_MAX_BASE64_BYTES + 100,
    })

    await expect(processRCardPhoto('file:///source.jpg', manipulateAsync)).rejects.toBeInstanceOf(
      RCardPhotoTooLargeError
    )
  })

  test('throws when the manipulator returns no base64 data', async () => {
    const manipulateAsync: ManipulateAsyncFn = jest.fn(async () => ({
      uri: 'file:///processed.jpg',
      width: RCARD_PHOTO_MAX_DIMENSION,
      height: RCARD_PHOTO_MAX_DIMENSION,
    }))

    await expect(processRCardPhoto('file:///source.jpg', manipulateAsync)).rejects.toThrow(
      'Image manipulation did not return base64 data'
    )
  })
})
