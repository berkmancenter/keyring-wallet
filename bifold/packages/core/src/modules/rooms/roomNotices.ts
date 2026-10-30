/**
 * What happens in the member's rooms, said in a notice wherever they are, in the same words and place as the
 * community's own ("You're now a member of …", joinedNotice): above the tab bar, for a few seconds, while the app is
 * open. Mounted once, from the tab navigator.
 *
 * - A new room offer: "You've been offered a room in …"; a tap opens it in Messages, with Messages below it
 *   (several at once open Messages, whose offers card lists them). Offers are
 *   pulled, not pushed, so this runs the offers poll (useRoomOffersCount) from here, which My Agent's badge reads.
 *   Each offer is said once: the offers already said are kept on this phone, as short hashes of their ids, so a
 *   lock, a relaunch or the next poll does not say them again.
 * - An admission: "You've been admitted to …", when an accept the member sent is answered (useRoomOffer).
 * - A post that failed while its room was not on screen: "Your post to … didn't send"; a tap sends it again, as the
 *   same event (useRoomSend). In the room, the post itself says so.
 * - Access ending: "Your access to … ends in 5 days", then "… ends tomorrow" (or today); a tap opens the room in
 *   Messages, with Messages below it (several at once open Messages).
 * - Access gone: "You no longer have access to …", or "Your access to … has ended" once its end has passed.
 *   Both are read from the rows poll's listing of the member's rooms (roomAccess.ts says which, once each).
 *
 * The sample rooms (no agent) say none of this: their offers are fixtures.
 *
 * It also runs the poll for the rooms' Messages rows (useRoomRows), the one place that knows the service and the link.
 *
 * @module rooms/roomNotices
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { useNavigation } from '@react-navigation/native'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../components/toast/BaseToast'
import { TOKENS, useServices } from '../../container-api'
import { Screens, Stacks, TabStacks } from '../../types/navigators'
import { vtaAgent } from '../trust-tasks/module/vtaAgent'
import { useToastAboveTabBar } from '../trust-tasks/screens/aboveTabBar'
import { communityLabelOf } from '../trust-tasks/screens/communityName'

import { type AccessNotice, nextAccessNotice } from './roomAccess'
import type { RoomOffer } from './types'
import { useRoomOffersCount } from './useRoomOffersCount'
import { onRoomsListed, useRoomRowsPoll } from './useRoomRows'
import { ROOM_ADMITTED_EVENT, type RoomAdmitted } from './useRoomOffer'
import { ROOM_POST_FAILED_EVENT, retryRoomPost, type RoomPostFailed } from './useRoomSend'
import { useRoomsService } from './useRoomsService'

/** Where the offers already said are kept. */
export const OFFERS_SAID_KEY = 'rooms.offerNoticesSaid'

/** The most kept: the oldest are let go first, long after their offers have been accepted or have lapsed. */
export const OFFERS_SAID_MAX = 200

const NOTICE_MS = 8000

// A room offer's id names its community and room: kept only as a short hash.
const said = (offerId: string) => bytesToHex(sha256(utf8ToBytes(offerId))).slice(0, 16)

let offersSaid: string[] | undefined
let reading: Promise<void> | undefined

const readSaid = () =>
  (reading ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(OFFERS_SAID_KEY)
      const kept: unknown = raw ? JSON.parse(raw) : []
      offersSaid = Array.isArray(kept) ? kept.filter((h): h is string => typeof h === 'string') : []
    } catch {
      offersSaid = []
    }
  })())

/** The offers not said before, now kept as said. */
export async function offersNotYetSaid(offers: RoomOffer[]): Promise<RoomOffer[]> {
  await readSaid()
  const known = new Set(offersSaid)
  const fresh = offers.filter((o) => !known.has(said(o.offerId)))
  if (fresh.length === 0) return []
  // Kept in memory before the write, so a second read arriving meanwhile does not say them again.
  offersSaid = [...(offersSaid ?? []), ...fresh.map((o) => said(o.offerId))].slice(-OFFERS_SAID_MAX)
  try {
    await AsyncStorage.setItem(OFFERS_SAID_KEY, JSON.stringify(offersSaid))
  } catch {
    // Kept in memory for this run; a relaunch may say them once more.
  }
  return fresh
}

/** For tests: read the kept list again. */
export function resetOffersSaid(): void {
  offersSaid = undefined
  reading = undefined
}

const offerCommunity = (offer: RoomOffer, t: TFunction) =>
  String(offer.communityName ?? '') || communityLabelOf(offer.communityDid, t)

/** The words for new offers: one names its community, several are counted. */
export function offeredWords(offers: RoomOffer[], t: TFunction): { text1: string; text2: string } {
  if (offers.length === 1)
    return {
      text1: t('Rooms.NoticeOffered', {
        community: offerCommunity(offers[0], t),
        interpolation: { escapeValue: false },
      }) as string,
      text2: t('Rooms.NoticeSeeOffer') as string,
    }
  return {
    text1: t('Rooms.NoticeOfferedMany', { number: offers.length }) as string,
    text2: t('Rooms.NoticeSeeOffers') as string,
  }
}

export function postFailedWords(roomName: string | undefined, t: TFunction): string {
  return roomName
    ? (t('Rooms.NoticePostFailed', { room: roomName, interpolation: { escapeValue: false } }) as string)
    : (t('Rooms.NoticePostFailedNoRoom') as string)
}

/** The words for an access notice: one room is named, several are counted. */
export function accessWords(notice: AccessNotice, t: TFunction): { text1: string; text2?: string } {
  const named = { interpolation: { escapeValue: false } }
  if (notice.kind === 'gone') {
    if (notice.rooms.length > 1) return { text1: t('Rooms.NoticeGoneMany', { number: notice.rooms.length }) as string }
    const { room, ended } = notice.rooms[0]
    return {
      text1: t(ended ? 'Rooms.NoticeAccessEnded' : 'Rooms.NoticeRemoved', { room: room.name, ...named }) as string,
    }
  }
  if (notice.rooms.length > 1)
    return {
      text1: t('Rooms.NoticeAccessEndingMany', { number: notice.rooms.length }) as string,
      text2: t('Rooms.NoticeSeeRooms') as string,
    }
  const { room, days } = notice.rooms[0]
  const text1 =
    days <= 0
      ? t('Rooms.NoticeAccessEndsToday', { room: room.name, ...named })
      : days === 1
        ? t('Rooms.NoticeAccessEndsTomorrow', { room: room.name, ...named })
        : // Only 2 to 7 days come here, so `NoticeAccessEndsIn_one` is never shown; it is there because i18next wants
          // every count-bearing key's forms.
          t('Rooms.NoticeAccessEndsIn', { room: room.name, count: days, ...named })
  return { text1: text1 as string, text2: t('Rooms.NoticeSeeRoom') as string }
}

export function useRoomNotices(): void {
  const { t } = useTranslation()
  const bottomOffset = useToastAboveTabBar()
  const navigation = useNavigation() as unknown as { navigate: (name: string, params?: object) => void }
  const service = useRoomsService()
  const linked = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.getState().link.kind === 'linked')
  const [logger] = useServices([TOKENS.UTIL_LOGGER])
  const logRows = useCallback((line: string) => logger.info(line), [logger])

  // Through the main stack, as an agent link does, so the screen comes to the top over whatever is open. Every room
  // notice opens in Messages, where the rooms are (R2), with Messages kept below what it opens.
  const openInMessages = useCallback(
    (screen: Screens, params?: object) =>
      navigation.navigate(Stacks.TabStack, {
        screen: TabStacks.MessageStack,
        params: screen === Screens.Messages ? { screen } : { screen, initial: false, ...(params ? { params } : {}) },
      }),
    [navigation]
  )

  const onOffers = useCallback(
    (offers: RoomOffer[]) => {
      if (!service || service.isSample || offers.length === 0) return
      void offersNotYetSaid(offers).then((fresh) => {
        if (fresh.length === 0) return
        Toast.show({
          type: ToastType.Info,
          ...offeredWords(fresh, t),
          visibilityTime: NOTICE_MS,
          position: 'bottom',
          bottomOffset,
          onPress: () => {
            Toast.hide()
            if (fresh.length === 1) openInMessages(Screens.RoomOffer, { offerRef: fresh[0].offerId })
            else openInMessages(Screens.Messages)
          },
        })
      })
    },
    [service, t, bottomOffset, openInMessages]
  )
  useRoomOffersCount(service, linked, onOffers)

  useEffect(
    () =>
      onRoomsListed((listedBy, rooms) => {
        if (listedBy.isSample) return
        void nextAccessNotice(rooms).then((notice) => {
          if (!notice) return
          const ending = notice.kind === 'ending'
          Toast.show({
            type: ending ? ToastType.Warn : ToastType.Info,
            ...accessWords(notice, t),
            visibilityTime: NOTICE_MS,
            position: 'bottom',
            bottomOffset,
            onPress: ending
              ? () => {
                  Toast.hide()
                  if (notice.rooms.length === 1) openInMessages(Screens.Room, { roomId: notice.rooms[0].room.roomId })
                  else openInMessages(Screens.Messages)
                }
              : undefined,
          })
        })
      }),
    [t, bottomOffset, openInMessages]
  )
  // The rooms as Messages rows, read by one poll for the app: Messages and the tab's badge both read it.
  useRoomRowsPoll(service, linked, logRows)

  useEffect(() => {
    const admitted = DeviceEventEmitter.addListener(ROOM_ADMITTED_EVENT, (e: RoomAdmitted) => {
      if (!e?.roomName) return
      Toast.show({
        type: ToastType.Success,
        text1: t('Rooms.NoticeAdmitted', { room: e.roomName, interpolation: { escapeValue: false } }) as string,
        visibilityTime: NOTICE_MS,
        position: 'bottom',
        bottomOffset,
      })
    })
    const failed = DeviceEventEmitter.addListener(ROOM_POST_FAILED_EVENT, (e: RoomPostFailed) => {
      if (!e?.service || !e.roomId) return
      Toast.show({
        type: ToastType.Error,
        text1: postFailedWords(e.roomName, t),
        text2: t('Rooms.NoticeTryAgain') as string,
        visibilityTime: NOTICE_MS,
        position: 'bottom',
        bottomOffset,
        onPress: () => {
          Toast.hide()
          retryRoomPost(e.service, e.roomId, e.localId)
        },
      })
    })
    return () => {
      admitted.remove()
      failed.remove()
    }
  }, [t, bottomOffset])
}
