/**
 * A room offer's consent screen (rooms member sprint, RoomOffer): which community offers which room, its tier and
 * who can read what is posted there, what the member could do and until when, and the identity they would join
 * as, named before they agree, never after. Accept asks for Face ID or the device passcode first; "Not now" hides
 * the offer on this phone only, since upstream has no decline and the community is not told.
 *
 * The offer comes in as an `offerRef` route param and nothing here assumes the offers list sent it, so a join
 * link or QR can open the same screen later. Reached only while the rooms flag is on.
 *
 * @module rooms/screens/RoomOffer
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation, useRoute } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { MyAgentStackParams, Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { localDate } from '../../trust-tasks/screens/localTime'
import { requestBiometricConfirmationWithUI } from '../../vrc/vrc-biometric'
import { roomsStatusText } from '../components/roomsStatusText'
import { accessText, identityText, tierHint } from '../components/roomWords'
import { SampleDataBanner } from '../components/SampleDataBanner'
import TierBadge from '../components/TierBadge'
import { offerCommunity, offerCommunityAlone, offerRoom } from '../offerCommunity'
import { type AcceptRefusal, useRoomOffer } from '../useRoomOffer'
import { useRoomsService } from '../useRoomsService'

/** The community's refusal codes this screen words; any other code, or none, is the plain "try again". */
const REFUSAL_KEY: Record<string, string> = {
  notFound: 'Rooms.OfferGone',
  offerExpired: 'Rooms.OfferGone',
  notAMember: 'Rooms.OfferNotAMember',
  alreadyAccepted: 'Rooms.OfferAlreadyAccepted',
  admissionPending: 'Rooms.OfferAdmissionPending',
  keyHolderRefused: 'Rooms.OfferKeyHolderRefused',
}

/**
 * What a failed accept says, and whether it is final for this offer (Join is then not offered again). A refusal the
 * service named is said in its words; a Keyring fault (a key package the community rejected) or a failure with no
 * answer is the plain "Couldn't join the room. Try again."
 */
export function acceptFailureText(t: TFunction, refusal?: AcceptRefusal): { text: string; final: boolean } {
  const generic = { text: t('Rooms.OfferAcceptFailed') as string, final: false }
  if (!refusal) return generic
  if ('reason' in refusal) {
    const text = roomsStatusText(t, { status: 'unavailable', reason: refusal.reason, detail: '' }, 'acceptOffer')
    return text ? { text, final: true } : generic
  }
  const key = REFUSAL_KEY[refusal.code]
  return key ? { text: t(key) as string, final: !refusal.retryable } : generic
}

const RoomOffer: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  const offerRef = (useRoute()?.params as { offerRef?: string } | undefined)?.offerRef ?? ''
  const service = useRoomsService()
  const state = useRoomOffer(service, offerRef)
  const { preview, step } = state
  const busy = step === 'accepting' || step === 'hiding'
  const final = state.actFailed === 'accept' && acceptFailureText(t, state.refusal).final
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, padding: 20, gap: 16 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    line: { flexDirection: 'row', gap: 10 },
    lineText: { flex: 1 },
    actions: { marginTop: 'auto', paddingTop: 4, gap: 12 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
    centered: { padding: 16, gap: 8 },
  })

  if (!service)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ThemedText style={styles.centered} testID={testIdWithKey('RoomsOff')}>
          {t('Rooms.Off')}
        </ThemedText>
      </SafeAreaView>
    )

  const unavailable = state.acceptStatus ? roomsStatusText(t, state.acceptStatus, 'acceptOffer') : undefined
  const canHide = state.hideStatus?.status === 'available'

  const onAccept = async () => {
    if (!preview) return
    // Standing alone in the prompt the person confirms with biometrics: an unnamed community says so.
    const community = offerCommunityAlone(preview.offer, t)
    if (agent) {
      const confirmed = await requestBiometricConfirmationWithUI(agent, community, 'room-offer', {
        title: t('Rooms.OfferConfirmTitle'),
        description: t('Rooms.OfferConfirmBody', {
          room: offerRoom(preview.offer, t),
          who: identityText(preview.actingAs),
          interpolation: { escapeValue: false },
        }),
      })
      if (!confirmed.success) return
    }
    const roomId = await state.accept()
    if (roomId) navigation.replace(Screens.Room, { roomId })
  }

  const onHide = async () => {
    if (await state.hide()) navigation.goBack()
  }

  const body = () => {
    if (unavailable)
      return (
        <ThemedText style={styles.muted} testID={testIdWithKey('RoomOfferUnavailable')}>
          {unavailable}
        </ThemedText>
      )
    if (state.readFailed)
      return (
        <View style={{ gap: 8 }}>
          <ThemedText testID={testIdWithKey('RoomOfferReadFailed')}>{t('Rooms.OfferReadFailed')}</ThemedText>
          <Button
            title={t('Rooms.TryAgain')}
            buttonType={ButtonType.Secondary}
            onPress={state.reload}
            testID={testIdWithKey('RoomOfferTryAgain')}
          />
        </View>
      )
    if (!preview)
      return <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('RoomOfferReading')} />
    const { offer, actingAs } = preview
    const hint = tierHint(t, offer.tier)
    return (
      <>
        <ThemedText variant="headingFour" accessibilityRole="header" testID={testIdWithKey('RoomOfferTitle')}>
          {t('Rooms.OfferFrom', { community: offerCommunity(offer, t), interpolation: { escapeValue: false } })}
        </ThemedText>
        <View style={styles.card} testID={testIdWithKey('RoomOfferRoom')}>
          <View style={styles.row}>
            <ThemedText variant="bold">{offerRoom(offer, t)}</ThemedText>
            <TierBadge tier={offer.tier} />
          </View>
          {hint ? <ThemedText style={styles.muted}>{hint}</ThemedText> : null}
          <ThemedText testID={testIdWithKey('RoomOfferAccess')}>
            {accessText(t, { verbs: offer.verbs, source: 'community' })}
          </ThemedText>
          {offer.validUntil ? (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomOfferUntil')}>
              {t('Rooms.Until', { date: localDate(offer.validUntil) })}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.card} testID={testIdWithKey('RoomOfferDisclosure')}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('Rooms.OfferWhatJoiningShares')}
          </ThemedText>
          <View style={styles.line}>
            <Icon name="account-outline" size={20} color={ColorPalette.brand.primary} />
            <ThemedText style={styles.lineText} testID={testIdWithKey('RoomOfferActingAs')}>
              {t('Rooms.OfferJoinAs', { who: identityText(actingAs), interpolation: { escapeValue: false } })}
            </ThemedText>
          </View>
          <View style={styles.line}>
            <Icon name="account-group-outline" size={20} color={ColorPalette.brand.primary} />
            <ThemedText style={styles.lineText}>
              {t('Rooms.OfferCommunitySees', {
                community: offerCommunity(offer, t),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
          </View>
        </View>
        {state.refreshed ? (
          <ThemedText accessibilityLiveRegion="polite" testID={testIdWithKey('RoomOfferRefreshed')}>
            {t('Rooms.OfferRefreshed')}
          </ThemedText>
        ) : null}
        {state.actFailed ? (
          <ThemedText style={styles.error} accessibilityLiveRegion="polite" testID={testIdWithKey('RoomOfferFailed')}>
            {state.actFailed === 'hide' ? t('Rooms.OfferHideFailed') : acceptFailureText(t, state.refusal).text}
          </ThemedText>
        ) : null}
        <View style={styles.actions}>
          <Button
            title={t('Rooms.OfferAccept')}
            buttonType={ButtonType.Primary}
            onPress={onAccept}
            disabled={busy || final}
            testID={testIdWithKey('RoomOfferAccept')}
          >
            {step === 'accepting' ? <ActivityIndicator color={ColorPalette.brand.text} /> : null}
          </Button>
          {canHide ? (
            <>
              <Button
                title={t('Rooms.OfferNotNow')}
                buttonType={ButtonType.Secondary}
                onPress={onHide}
                disabled={busy}
                testID={testIdWithKey('RoomOfferNotNow')}
              />
              <ThemedText variant="caption" style={styles.muted}>
                {t('Rooms.OfferNotNowHint')}
              </ThemedText>
            </>
          ) : null}
        </View>
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('RoomOfferScreen')}>
        <SampleDataBanner service={service} />
        {body()}
      </ScrollView>
    </SafeAreaView>
  )
}

export default RoomOffer
