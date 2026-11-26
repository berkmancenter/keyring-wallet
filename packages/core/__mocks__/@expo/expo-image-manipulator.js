// Manual mock for expo-image-manipulator (no native runtime in Jest). Tests
// that exercise the photo pipeline override this with mockResolvedValueOnce.
export const SaveFormat = {
  JPEG: 'jpeg',
  PNG: 'png',
  WEBP: 'webp',
}

export const manipulateAsync = jest.fn().mockResolvedValue({ // eslint-disable-line no-undef
  uri: 'file:///mock-processed.jpg',
  width: 256,
  height: 256,
  base64: 'mockBase64Data',
})
