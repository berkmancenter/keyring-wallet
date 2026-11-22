import { Buffer } from 'buffer'

import type { ManipulateAction, ManipulateSaveOptions } from '../../../vrc/utils/rcardPhoto'
import { MAX_IMAGE_BYTES } from '../checkAttachment'
import { ChatPhotoError, HUGE_PHOTO_PIXELS, PHOTO_MAX_SIDE, PHOTO_MIN_SIDE, prepareChatPhoto } from '../prepare'
import { REAL, gifOf, jpegHeader, paddedTo } from './fixtures/images'

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/**
 * A stand-in for expo-image-manipulator: it "encodes" a JPEG whose header says the size it was asked for and whose
 * length is `bytesFor(width, height, quality)`, and records every call.
 */
function fakeManipulator(
  bytesFor: (width: number, height: number, quality: number) => number,
  source = { width: 4000, height: 3000 }
) {
  const calls: { uri: string; actions: ManipulateAction[]; options: ManipulateSaveOptions }[] = []
  const manipulate = jest.fn(async (uri: string, actions: ManipulateAction[], options: ManipulateSaveOptions) => {
    calls.push({ uri, actions, options })
    const resize = actions.find((a) => a.resize)?.resize
    const width = resize?.width ?? source.width
    const height = resize?.height ?? source.height
    const bytes = paddedTo(jpegHeader(width, height), bytesFor(width, height, options.compress ?? 1))
    return {
      uri: `file:///cache/${calls.length}.jpg`,
      width,
      height,
      ...(options.base64 ? { base64: b64(bytes) } : {}),
    }
  })
  return { manipulate, calls }
}
const neverRead = jest.fn(async () => {
  throw new Error('a photo is never read as it is')
})

describe('prepareChatPhoto, a photo', () => {
  it('re-encodes even a small photo, never sending the picked file as it is (the re-encode strips EXIF and GPS)', async () => {
    const { manipulate } = fakeManipulator(() => 10_000)
    const photo = await prepareChatPhoto(
      { uri: 'file:///picked/small.jpg', width: 400, height: 300 },
      { manipulate, readBase64: neverRead }
    )
    expect(manipulate).toHaveBeenCalledTimes(1)
    expect(manipulate.mock.calls[0][2]).toMatchObject({ format: 'jpeg', base64: true })
    expect(photo).toMatchObject({ mediaType: 'image/jpeg', width: 400, height: 300, byteCount: 10_000 })
    expect(neverRead).not.toHaveBeenCalled()
  })

  it('resizes to 1600 px on the long edge and steps quality down until it fits', async () => {
    // Fits only at quality 0.4.
    const { manipulate, calls } = fakeManipulator((_w, _h, q) => (q > 0.4 ? MAX_IMAGE_BYTES + 1 : 150_000))
    const photo = await prepareChatPhoto(
      { uri: 'file:///p.jpg', width: 4000, height: 3000 },
      { manipulate, readBase64: neverRead }
    )
    expect(calls.map((c) => c.options.compress)).toEqual([0.8, 0.6, 0.4])
    expect(calls[0].actions).toEqual([{ resize: { width: PHOTO_MAX_SIDE, height: 1200 } }])
    expect(photo).toMatchObject({ width: 1600, height: 1200, byteCount: 150_000 })
  })

  it('makes it smaller still when the lowest quality does not fit, and keeps the aspect', async () => {
    const { calls, manipulate } = fakeManipulator((w, h) =>
      Math.max(w, h) > 1200 ? MAX_IMAGE_BYTES + 1 : MAX_IMAGE_BYTES
    )
    const photo = await prepareChatPhoto(
      { uri: 'file:///p.jpg', width: 3000, height: 4000 },
      { manipulate, readBase64: neverRead }
    )
    expect(calls).toHaveLength(4)
    expect(photo).toMatchObject({ width: 900, height: 1200, byteCount: MAX_IMAGE_BYTES })
  })

  it('accepts exactly the limit and goes on at one byte over', async () => {
    const exactly = fakeManipulator(() => MAX_IMAGE_BYTES)
    await expect(
      prepareChatPhoto({ uri: 'u', width: 100, height: 100 }, { manipulate: exactly.manipulate, readBase64: neverRead })
    ).resolves.toMatchObject({ byteCount: MAX_IMAGE_BYTES })
    expect(exactly.calls).toHaveLength(1)
    const over = fakeManipulator((_w, _h, q) => (q === 0.8 ? MAX_IMAGE_BYTES + 1 : 1000))
    await prepareChatPhoto(
      { uri: 'u', width: 100, height: 100 },
      { manipulate: over.manipulate, readBase64: neverRead }
    )
    expect(over.calls).toHaveLength(2)
  })

  it('gives up below the smallest size', async () => {
    const { manipulate, calls } = fakeManipulator(() => MAX_IMAGE_BYTES + 1)
    await expect(
      prepareChatPhoto({ uri: 'u', width: 4000, height: 3000 }, { manipulate, readBase64: neverRead })
    ).rejects.toEqual(new ChatPhotoError('photo-too-large'))
    const longSides = calls.map((c) => Math.max(c.actions[0].resize?.width ?? 0, c.actions[0].resize?.height ?? 0))
    expect(Math.min(...longSides)).toBeGreaterThanOrEqual(PHOTO_MIN_SIDE)
  })

  it('resizes a very large photo once on its own, then steps quality on the small copy', async () => {
    const { manipulate, calls } = fakeManipulator(() => 100_000, { width: 9000, height: 6000 })
    expect(9000 * 6000).toBeGreaterThanOrEqual(HUGE_PHOTO_PIXELS)
    await prepareChatPhoto(
      { uri: 'file:///huge.jpg', width: 9000, height: 6000 },
      { manipulate, readBase64: neverRead }
    )
    expect(calls[0]).toMatchObject({ uri: 'file:///huge.jpg', options: { compress: 1 } })
    expect(calls[0].options.base64).toBeUndefined()
    expect(calls[1].uri).toBe('file:///cache/1.jpg')
  })

  it('refuses what the manipulator made if its header does not read', async () => {
    const manipulate = jest.fn(async () => ({
      uri: 'x',
      width: 10,
      height: 10,
      base64: b64(new Uint8Array([1, 2, 3, 4])),
    }))
    await expect(
      prepareChatPhoto({ uri: 'u', width: 10, height: 10 }, { manipulate, readBase64: neverRead })
    ).rejects.toEqual(new ChatPhotoError('unreadable'))
  })
})

describe('prepareChatPhoto, a GIF', () => {
  const noManipulator = jest.fn(async () => {
    throw new Error('a GIF is never re-encoded')
  })

  it('is sent as it is when it fits, keeping its animation', async () => {
    const photo = await prepareChatPhoto(
      { uri: 'file:///picked/anim.gif', width: 6, height: 4, mimeType: 'image/gif' },
      { manipulate: noManipulator, readBase64: async () => REAL.gifAnimated }
    )
    expect(photo).toEqual({
      mediaType: 'image/gif',
      base64: REAL.gifAnimated,
      byteCount: Buffer.from(REAL.gifAnimated, 'base64').length,
      width: 6,
      height: 4,
    })
    expect(noManipulator).not.toHaveBeenCalled()
  })

  it('is refused when it is over the limit', async () => {
    const big = b64(paddedTo(gifOf(10, 10, 1), MAX_IMAGE_BYTES + 1))
    // gifOf ends at its trailer, so padding past it keeps a readable header.
    await expect(
      prepareChatPhoto(
        { uri: 'file:///big.GIF', width: 10, height: 10 },
        { manipulate: noManipulator, readBase64: async () => big }
      )
    ).rejects.toEqual(new ChatPhotoError('gif-too-large'))
  })

  it('is refused when its bytes are not a GIF', async () => {
    await expect(
      prepareChatPhoto(
        { uri: 'file:///fake.gif', width: 5, height: 3, mimeType: 'image/gif' },
        { manipulate: noManipulator, readBase64: async () => REAL.png }
      )
    ).rejects.toEqual(new ChatPhotoError('unreadable'))
  })
})
