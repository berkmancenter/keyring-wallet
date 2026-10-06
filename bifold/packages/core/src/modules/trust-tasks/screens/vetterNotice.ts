/**
 * The community made this person a vetter: said the moment the grant is kept,
 * while the app is open, wherever the person is (vtiInbox
 * `VTI_VETTER_GRANTED_EVENT`) — as joining is (joinedNotice). The card on
 * "Your agent" still says so; this is how a person who is elsewhere in the
 * app learns it (Alberto, 10-06).
 *
 * @module trust-tasks/screens/vetterNotice
 */
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import { VTI_VETTER_GRANTED_EVENT } from '../module/vtiInbox'

import { useToastAboveTabBar } from './aboveTabBar'
import { communityLabelOf } from './communityName'

/** The words, naming the community as the rest of the app does. */
export function vetterGrantedWords(communityDid: string, t: TFunction): { title: string; hint: string } {
  return {
    title: t('VtaLink.YouCanVetToast', {
      // Mid-sentence: "a community", not "A community", when no name is known.
      community: communityLabelOf(communityDid, t),
      interpolation: { escapeValue: false },
    }) as string,
    hint: t('VtaLink.YouCanVetToastHint') as string,
  }
}

/** Show the words whenever a vetter grant makes this phone a vetter. */
export function useVtiVetterGrantedNotice(): void {
  const { t } = useTranslation()
  const bottomOffset = useToastAboveTabBar()
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(VTI_VETTER_GRANTED_EVENT, (e: { communityDid?: string }) => {
      if (!e?.communityDid) return
      const words = vetterGrantedWords(e.communityDid, t)
      Toast.show({
        type: ToastType.Success,
        text1: words.title,
        text2: words.hint,
        visibilityTime: 8000,
        position: 'bottom',
        // Clear of the tab bar, so the tabs stay in reach while it shows.
        bottomOffset,
      })
    })
    return () => sub.remove()
  }, [t, bottomOffset])
}
