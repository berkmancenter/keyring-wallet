/**
 * A community turned down this person's request: said in plain words, once,
 * the first time the app learns it (joinSubmission `VTI_TURNED_DOWN_EVENT`).
 * A community does not push a refusal, so this is when a status read finds
 * it — wherever the person is. The Join screen then shows the same standing,
 * "… turned down your request." The same pattern as a removal (removedNotice).
 *
 * @module trust-tasks/screens/turnedDownNotice
 */
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import { VTI_TURNED_DOWN_EVENT } from '../module/joinSubmission'

import { useToastAboveTabBar } from './aboveTabBar'
import { communityLabelStartOf } from './communityName'

/** The words, with the community's reason when it gave one. */
export function turnedDownWords(communityDid: string, reason: string | undefined, t: TFunction): string {
  const said = t('Join.StandingRejected', {
    community: communityLabelStartOf(communityDid, t),
    interpolation: { escapeValue: false },
  }) as string
  return reason
    ? `${said} ${t('Community.RemovedReason', { reason, interpolation: { escapeValue: false } }) as string}`
    : said
}

/** Show the words the first time a stored request reads as turned down. */
export function useVtiTurnedDownNotice(): void {
  const { t } = useTranslation()
  const bottomOffset = useToastAboveTabBar()
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      VTI_TURNED_DOWN_EVENT,
      (e: { communityDid?: string; reason?: string }) => {
        if (!e?.communityDid) return
        Toast.show({
          type: ToastType.Warn,
          text1: turnedDownWords(e.communityDid, e.reason, t),
          visibilityTime: 8000,
          position: 'bottom',
          // Clear of the tab bar, so the tabs stay in reach while it shows.
          bottomOffset,
        })
      }
    )
    return () => sub.remove()
  }, [t, bottomOffset])
}
