/**
 * Sending a photo from the composer: pick it, fit it to one message, and send
 * it (rich-messaging-plan.md §4.4, §5). The screen shows what came of it; this
 * module never touches the screen.
 *
 * A GIF is sent as it is, so whatever it carries goes with it: the person is
 * asked first (`confirmGif`), and nothing is sent unless they agree. A photo is
 * always re-encoded, which is what strips its EXIF and GPS (prepare.ts).
 *
 * @module chat/media/compose
 */

import type { Agent } from '@credo-ts/core'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import type { Action as ExpoImageManipulatorAction } from 'expo-image-manipulator'
import RNFS from 'react-native-fs'

import type { ManipulateAsyncFn } from '../../vrc/utils/rcardPhoto'
import { sendChatPhoto } from '../send'
import { ChatPhotoPermissionError, pickChatPhoto } from './pick'
import type { PhotoSource } from './pick'
import { ChatPhotoError, prepareChatPhoto } from './prepare'
import type { PrepareTools } from './prepare'

export type PhotoSendOutcome =
  | 'sent'
  | 'cancelled'
  | 'no-permission'
  | 'gif-too-large'
  | 'photo-too-large'
  | 'unreadable'
  | 'not-sent'

/** expo-image-manipulator, in the injectable shape prepare.ts takes; always JPEG. */
const manipulate: ManipulateAsyncFn = (uri, actions, saveOptions) =>
  manipulateAsync(uri, actions as ExpoImageManipulatorAction[], {
    compress: saveOptions.compress,
    base64: saveOptions.base64,
    format: SaveFormat.JPEG,
  })

export const deviceTools: PrepareTools = {
  manipulate,
  readBase64: (uri) => RNFS.readFile(uri, 'base64'),
}

export interface PhotoSendOptions {
  /** "📷 Photo — update Keyring to see it", in this phone's language, for a contact without chat. */
  fallbackText: string
  /** Asked before a GIF goes, since it is sent as it is; resolves true to send it. */
  confirmGif: () => Promise<boolean>
  tools?: PrepareTools
}

/** Pick a photo from `source` and send it on `connectionId`; resolves to what came of it, never throws. */
export async function pickAndSendPhoto(
  agent: Agent,
  connectionId: string,
  source: PhotoSource,
  options: PhotoSendOptions
): Promise<PhotoSendOutcome> {
  let picked
  try {
    picked = await pickChatPhoto(source)
  } catch (error) {
    return error instanceof ChatPhotoPermissionError ? 'no-permission' : 'unreadable'
  }
  if (!picked) return 'cancelled'

  let prepared
  try {
    prepared = await prepareChatPhoto(picked, options.tools ?? deviceTools)
  } catch (error) {
    return error instanceof ChatPhotoError ? error.problem : 'unreadable'
  }
  if (prepared.mediaType === 'image/gif' && !(await options.confirmGif())) return 'cancelled'

  try {
    await sendChatPhoto(agent, connectionId, prepared, { fallbackText: options.fallbackText })
  } catch {
    return 'not-sent'
  }
  return 'sent'
}
