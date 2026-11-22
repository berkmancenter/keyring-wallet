/**
 * Picking a photo for a chat message, from the camera or the photo library
 * (rich-messaging-plan.md §5, "Composer"), with the expo-image-picker the
 * R-card photo already uses.
 *
 * The picked file is never sent as it is: media/prepare.ts re-encodes every
 * photo (which strips its location and other identifying EXIF) and checks a
 * GIF's size. The picker
 * is asked for quality 1, so it hands over the original rather than its own
 * re-encode, which on iOS would also flatten a GIF's animation.
 *
 * @module chat/media/pick
 */

import * as ImagePicker from 'expo-image-picker'
import { InteractionManager } from 'react-native'

import type { PickedPhoto } from './prepare'

export type PhotoSource = 'camera' | 'library'

export class ChatPhotoPermissionError extends Error {
  constructor(public readonly source: PhotoSource) {
    super(`chat photo: no permission to use the ${source}`)
    this.name = 'ChatPhotoPermissionError'
  }
}

/**
 * iOS is still dismissing its permission sheet when the request resolves, and a picker presented into that dismissal
 * closes with it (RCardForm.tsx, report #21). Waiting costs a few hundred milliseconds on the one attempt that asked.
 */
const afterPermissionSheetCloses = (): Promise<void> =>
  new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350))
  })

async function ensurePermission(source: PhotoSource): Promise<void> {
  const get = source === 'camera' ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync
  const request =
    source === 'camera' ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync
  if ((await get()).granted) return
  if (!(await request()).granted) throw new ChatPhotoPermissionError(source)
  await afterPermissionSheetCloses()
}

/** Take or choose one photo; undefined if the person cancels. Throws ChatPhotoPermissionError without permission. */
export async function pickChatPhoto(source: PhotoSource): Promise<PickedPhoto | undefined> {
  await ensurePermission(source)
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options)
  const asset = result.canceled ? undefined : result.assets?.[0]
  if (!asset?.uri) return undefined
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
  }
}
