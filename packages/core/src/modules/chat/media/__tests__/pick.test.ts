import * as ImagePicker from 'expo-image-picker'

import { ChatPhotoPermissionError, pickChatPhoto } from '../pick'

// expo-image-picker is the manual mock in __mocks__/@expo: granted, and cancelled unless a test says otherwise.
const picker = ImagePicker as unknown as Record<string, jest.Mock>
const asset = { uri: 'file:///cache/IMG.jpg', width: 4032, height: 3024, mimeType: 'image/jpeg' }

beforeEach(() => jest.clearAllMocks())

describe('pickChatPhoto', () => {
  it.each([
    ['library', 'launchImageLibraryAsync', 'launchCameraAsync'],
    ['camera', 'launchCameraAsync', 'launchImageLibraryAsync'],
  ] as const)(
    'from the %s: the original, at quality 1, never the picker’s own re-encode',
    async (source, used, unused) => {
      picker[used].mockResolvedValueOnce({ canceled: false, assets: [asset] })
      await expect(pickChatPhoto(source)).resolves.toEqual(asset)
      expect(picker[used]).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 1, exif: false })
      expect(picker[unused]).not.toHaveBeenCalled()
    }
  )

  it('keeps a GIF’s type, so it is sent as it is rather than re-encoded', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/a.gif', width: 6, height: 4, mimeType: 'image/gif' }],
    })
    await expect(pickChatPhoto('library')).resolves.toMatchObject({ mimeType: 'image/gif' })
  })

  it('is nothing when the person cancels', async () => {
    await expect(pickChatPhoto('library')).resolves.toBeUndefined()
  })

  it('asks for permission once when it is not yet given, and refuses when it is denied', async () => {
    picker.getCameraPermissionsAsync.mockResolvedValueOnce({ granted: false })
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false })
    await expect(pickChatPhoto('camera')).rejects.toEqual(new ChatPhotoPermissionError('camera'))
    expect(picker.launchCameraAsync).not.toHaveBeenCalled()
  })
})
