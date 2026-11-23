/**
 * What a community's card says while a card from it waits on its status list.
 *
 * A delivered card whose status list could not be read is not kept, and is
 * tried again (vtiCardStatusRetry). Before IN-258 nothing said so: an admitted
 * member read "not accepted" and a restart did not help. Now the card says it
 * in plain words, with Try again; the words never name proofs or status lists'
 * addresses (the log does that).
 *
 * @module trust-tasks/screens/cardStatusNotice
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import {
  pendingStatusCheck,
  retryStatusCheckNow,
  VTI_CARD_STATUS_PENDING_EVENT,
  type CardStatusPending,
} from '../module/vtiCardStatusRetry'

export const CardStatusNoticeIds = {
  notice: 'CardStatusNotice',
  text: 'CardStatusNoticeText',
  tryAgain: 'CardStatusNoticeTryAgain',
  still: 'CardStatusNoticeStill',
} as const

/** Whether a card from this community is held for its status, kept current. */
export function usePendingStatusCheck(communityDid: string | undefined): CardStatusPending | undefined {
  const [pending, setPending] = useState(() => (communityDid ? pendingStatusCheck(communityDid) : undefined))
  useEffect(() => {
    if (!communityDid) return setPending(undefined)
    setPending(pendingStatusCheck(communityDid))
    const sub = DeviceEventEmitter.addListener(VTI_CARD_STATUS_PENDING_EVENT, (e?: { communityDid?: string }) => {
      if (e?.communityDid === communityDid) setPending(pendingStatusCheck(communityDid))
    })
    return () => sub.remove()
  }, [communityDid])
  return pending
}

/** "Keyring couldn't check this card's status", with Try again; nothing when no card waits. */
export const CardStatusNotice: React.FC<{ communityDid: string; onKept?: () => void }> = ({ communityDid, onKept }) => {
  const { t } = useTranslation()
  const pending = usePendingStatusCheck(communityDid)
  const [trying, setTrying] = useState(false)
  const [still, setStill] = useState(false)

  const onTryAgain = useCallback(async () => {
    setTrying(true)
    setStill(false)
    try {
      const outcome = await retryStatusCheckNow(communityDid)
      if (outcome === 'kept') onKept?.()
      else setStill(outcome === 'stillUnreadable')
    } finally {
      setTrying(false)
    }
  }, [communityDid, onKept])

  if (!pending) return null
  return (
    <View style={{ gap: 8 }} testID={testIdWithKey(CardStatusNoticeIds.notice)}>
      <ThemedText testID={testIdWithKey(CardStatusNoticeIds.text)}>{t('Community.CardStatusUnchecked')}</ThemedText>
      {still ? (
        <ThemedText testID={testIdWithKey(CardStatusNoticeIds.still)}>
          {t('Community.CardStatusStillUnchecked')}
        </ThemedText>
      ) : null}
      <Button
        title={t('Community.CardStatusTryAgain')}
        buttonType={ButtonType.Secondary}
        onPress={onTryAgain}
        disabled={trying}
        testID={testIdWithKey(CardStatusNoticeIds.tryAgain)}
      />
    </View>
  )
}
