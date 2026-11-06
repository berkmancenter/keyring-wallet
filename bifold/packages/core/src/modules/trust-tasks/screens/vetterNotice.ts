/**
 * The community made this person a vetter: said the moment the grant is kept,
 * while the app is open, wherever the person is (vtiInbox
 * `VTI_VETTER_GRANTED_EVENT`) — as joining is (joinedNotice). The card on
 * "Your agent" still says so; this is how a person who is elsewhere in the
 * app learns it (Alberto, 10-06).
 *
 * And when the community revokes it: a community sends no notice of a revoke,
 * so the phone learns it when it next reads the grant's status list (Your
 * agent, the vetting desk), and says so then — once, when the revoke is first
 * recorded (vtiCardStanding `VTI_CARD_STANDING_EVENT`), and only if no other
 * grant this phone holds there for that identity still stands.
 *
 * @module trust-tasks/screens/vetterNotice
 */
import { useAgent } from '@bifold/react-hooks'
import type { Agent } from '@credo-ts/core'
import type { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'
import Toast from 'react-native-toast-message'

import { ToastType } from '../../../components/toast/BaseToast'
import { GenericRecordsCommunityStore } from '../module/VtiCommunityStore'
import { VTI_CARD_STANDING_EVENT, cardStandingOf } from '../module/vtiCardStanding'
import { ownVetterGrantState } from '../module/vtiGrantState'
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

/** The words when a community ends this person's vetter role. */
export function vetterEndedWords(communityDid: string, t: TFunction): { title: string; hint: string } {
  return {
    title: t('VtaLink.VetterEndedToast', {
      community: communityLabelOf(communityDid, t),
      interpolation: { escapeValue: false },
    }) as string,
    hint: t('VtaLink.VetterEndedToastHint') as string,
  }
}

/**
 * The community whose vetter role a newly recorded revoke ended, if it did: the card is one of this phone's vetter
 * grants, it is now recorded as revoked, and no other grant held there for the same identity still stands. Read from
 * this phone alone, asking no one.
 */
export async function vetterRoleEndedBy(agent: Agent, credentialId: string): Promise<string | undefined> {
  if (!credentialId) return undefined
  const grants = await new GenericRecordsCommunityStore(agent).listHeldCredentials('vetter-grant')
  const revoked = grants.find((g) => g.credential.id === credentialId)
  if (!revoked || cardStandingOf(revoked.credential).state !== 'revoked') return undefined
  const own = grants.filter((g) => g.communityDid === revoked.communityDid && g.subjectDid === revoked.subjectDid)
  const standing = await ownVetterGrantState(agent, own, { local: true })
  return standing.state === 'active' ? undefined : revoked.communityDid
}

/** Show the words when a recorded revoke ends this phone's vetter role somewhere. */
export function useVtiVetterEndedNotice(): void {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const bottomOffset = useToastAboveTabBar()
  useEffect(() => {
    if (!agent) return
    const sub = DeviceEventEmitter.addListener(VTI_CARD_STANDING_EVENT, (e: { credentialId?: string }) => {
      void vetterRoleEndedBy(agent as Agent, e?.credentialId ?? '')
        .then((communityDid) => {
          if (!communityDid) return
          const words = vetterEndedWords(communityDid, t)
          Toast.show({
            type: ToastType.Info,
            text1: words.title,
            text2: words.hint,
            visibilityTime: 8000,
            position: 'bottom',
            bottomOffset,
          })
        })
        .catch(() => undefined)
    })
    return () => sub.remove()
  }, [agent, t, bottomOffset])
}
