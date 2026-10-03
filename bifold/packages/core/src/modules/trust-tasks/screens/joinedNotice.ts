/**
 * The community made this person a member: said in plain words the moment its
 * membership card is kept, while the app is open, wherever the person is
 * (vtiInbox `VTI_JOINED_EVENT`). The same pattern as a removal (removedNotice).
 *
 * @module trust-tasks/screens/joinedNotice
 */
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import { VTI_JOINED_EVENT } from '../module/vtiInbox'

import { communityLabelOf } from './communityName'

/** The words, naming the community as the rest of the app does. */
export function joinedWords(communityDid: string, t: TFunction): string {
  return t('Join.NowMember', {
    // Mid-sentence: "a community", not "A community", when no name is known.
    community: communityLabelOf(communityDid, t),
    interpolation: { escapeValue: false },
  }) as string
}

/** Show the words whenever a membership card makes this phone a member. */
export function useVtiJoinedNotice(): void {
  const { t } = useTranslation()
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(VTI_JOINED_EVENT, (e: { communityDid?: string }) => {
      if (!e?.communityDid) return
      Toast.show({
        type: ToastType.Success,
        text1: joinedWords(e.communityDid, t),
        visibilityTime: 8000,
        position: 'bottom',
      })
    })
    return () => sub.remove()
  }, [t])
}
