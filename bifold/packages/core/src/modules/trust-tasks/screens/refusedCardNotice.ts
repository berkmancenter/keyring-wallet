/**
 * A card a community delivered that did not hold up, said in plain words.
 *
 * The inbox checks each delivered card before keeping it (vtiDeliveredCheck)
 * and announces one it did not keep (`VTI_CARD_REFUSED_EVENT`). Before, such a
 * card was kept anyway; now the person is told it was not, and why, in terms
 * of the card and the community, never of proofs or status lists.
 *
 * @module trust-tasks/screens/refusedCardNotice
 */
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import type { VtiCardCheckRefusal } from '../module/vtiDeliveredCheck'
import { VTI_CARD_REFUSED_EVENT } from '../module/vtiInbox'

import { useToastAboveTabBar } from './aboveTabBar'
import { communityLabelOf, communityLabelStartOf } from './communityName'

const KEYS: Record<VtiCardCheckRefusal, string> = {
  proof: 'Community.CardNotKeptProof',
  expired: 'Community.CardNotKeptExpired',
  notYetValid: 'Community.CardNotKeptNotYetValid',
  revoked: 'Community.CardNotKeptRevoked',
}

/** The sentence for a card that was not kept. */
export function refusedCardWords(refusal: VtiCardCheckRefusal, communityDid: string, t: TFunction): string {
  // The withdrawn sentence starts with the community ("A community has…").
  const community = refusal === 'revoked' ? communityLabelStartOf(communityDid, t) : communityLabelOf(communityDid, t)
  return t(KEYS[refusal] ?? KEYS.proof, {
    community,
    interpolation: { escapeValue: false },
  }) as string
}

/** Show the sentence whenever the inbox did not keep a delivered card. */
export function useVtiRefusedCardNotice(): void {
  const { t } = useTranslation()
  const bottomOffset = useToastAboveTabBar()
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      VTI_CARD_REFUSED_EVENT,
      (e: { communityDid?: string; refusal?: VtiCardCheckRefusal }) => {
        if (!e?.communityDid || !e.refusal) return
        Toast.show({
          type: ToastType.Warn,
          text1: refusedCardWords(e.refusal, e.communityDid, t),
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
