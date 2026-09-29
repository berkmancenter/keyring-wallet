/**
 * A community removed this person, said in plain words when its signed notice
 * arrives (vtiCommunityNotices). The community screen then shows the same
 * standing, "… removed you. You can ask to join again."
 *
 * @module trust-tasks/screens/removedNotice
 */
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import { VTI_REMOVED_EVENT } from '../module/vtiCommunityNotices'

import { communityLabelStartOf } from './communityName'

/** The words, with the community's reason when it gave one. */
export function removedWords(communityDid: string, reason: string | undefined, t: TFunction): string {
  const said = t('Join.StandingRemoved', {
    community: communityLabelStartOf(communityDid, t),
    interpolation: { escapeValue: false },
  }) as string
  return reason
    ? `${said} ${t('Community.RemovedReason', { reason, interpolation: { escapeValue: false } }) as string}`
    : said
}

/** Show the words whenever a community's removal notice is applied. */
export function useVtiRemovedNotice(): void {
  const { t } = useTranslation()
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(VTI_REMOVED_EVENT, (e: { communityDid?: string; reason?: string }) => {
      if (!e?.communityDid) return
      Toast.show({
        type: ToastType.Warn,
        text1: removedWords(e.communityDid, e.reason, t),
        visibilityTime: 8000,
        position: 'bottom',
      })
    })
    return () => sub.remove()
  }, [t])
}
