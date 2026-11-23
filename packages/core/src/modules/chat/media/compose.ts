/**
 * Sending a photo from the composer: pick it, fit it to one message, and send
 * it (rich-messaging-plan.md §4.4, §5). The screen shows what came of it; this
 * module never touches the screen.
 *
 * A GIF is sent as it is, so whatever it carries goes with it: the person is
 * asked first (`confirmGif`), and nothing is sent unless they agree. A photo is
 * always re-encoded, which strips its location and what identifies the camera
 * or the time (prepare.ts).
 *
 * A pick that ends in nothing is logged, since the screen shows nothing for a
 * cancel: an iOS picker refused access, or never presented, reports one too.
 *
 * `hooks` let the screen show the photo while it goes: as soon as it is picked,
 * then while it is sent, and, when it isn't sent, with a way to send the same
 * prepared photo again. Nothing is stored until a send succeeds (send.ts), so a
 * photo that failed lives only as long as the screen keeps it.
 *
 * @module chat/media/compose
 */

import type { Agent } from '@credo-ts/core'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import type { Action as ExpoImageManipulatorAction } from 'expo-image-manipulator'
import RNFS from 'react-native-fs'

import type { ManipulateAsyncFn } from '../../vrc/utils/rcardPhoto'
import { newEventId } from '../eventId'
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

/** What a screen hears while a photo goes (see the module notes). */
export interface PhotoSendHooks {
  /** Picked: what to show while it is prepared and sent. */
  picked?: (photo: { uri: string; width: number; height: number }) => void
  /** Asked once it is prepared, before anything is sent: false stops it (the person stopped it while it was prepared). */
  goOn?: () => boolean
  /** It is being sent: it can't be stopped from here on. */
  sending?: () => void
  /** It wasn't sent. `retry` sends the same prepared photo again and resolves to whether it went this time. */
  failed?: (retry: () => Promise<boolean>) => void
}

export interface PhotoSendOptions {
  /** "📷 Photo — update Keyring to see it", in this phone's language, for a contact without chat. */
  fallbackText: string
  /** Asked before a GIF goes, since it is sent as it is; resolves true to send it. */
  confirmGif: () => Promise<boolean>
  tools?: PrepareTools
  hooks?: PhotoSendHooks
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
    if (error instanceof ChatPhotoPermissionError) {
      agent.config?.logger?.info(`[Chat:photo] no permission to use the ${source}`)
      return 'no-permission'
    }
    agent.config?.logger?.warn(`[Chat:photo] the ${source} picker failed`, { error })
    return 'unreadable'
  }
  if (!picked) {
    agent.config?.logger?.info(`[Chat:photo] the ${source} picker closed without a photo`)
    return 'cancelled'
  }
  const hooks = options.hooks ?? {}
  hooks.picked?.({ uri: picked.uri, width: picked.width, height: picked.height })

  let prepared
  try {
    prepared = await prepareChatPhoto(picked, options.tools ?? deviceTools)
  } catch (error) {
    return error instanceof ChatPhotoError ? error.problem : 'unreadable'
  }
  if (hooks.goOn && !hooks.goOn()) return 'cancelled'
  if (prepared.mediaType === 'image/gif' && !(await options.confirmGif())) return 'cancelled'

  const ready = prepared
  // One event for every attempt: a send can fail after the photo arrived, and a retry naming the same event is dropped
  // by a receiver that already has it, rather than shown twice.
  const eventId = newEventId()
  const send = async () => {
    await sendChatPhoto(agent, connectionId, ready, { fallbackText: options.fallbackText, eventId })
  }
  hooks.sending?.()
  try {
    await send()
  } catch {
    hooks.failed?.(() =>
      send().then(
        () => true,
        () => false
      )
    )
    return 'not-sent'
  }
  return 'sent'
}
