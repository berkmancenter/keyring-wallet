/**
 * "Your card" in a community (parity plan §9.3 #1, at VTC 0.12): the name on the member's card there, who sees each
 * field, and the way to put the name of the profile they joined with on it; and, where the community takes pictures
 * (VTC 0.13), the profile's photo, with who sees it chosen on the consent sheet (all members, or administrators only,
 * at most what the community allows).
 *
 * Nothing is written without a yes. "Use … on your card" opens the consent sheet, which lists each value that would
 * go and who would see it, then says plainly that administrators see all of it, including the ID the member joined
 * with (§9.4). The name keeps the community's default for who sees it. The photo is the one change to who sees what
 * this screen makes, and its consent sheet says so before Send.
 * When the profile's name has changed since it went on the card, the screen asks whether to update it; it never does
 * so by itself.
 *
 * A save is made at the revision read. If the card changed elsewhere meanwhile (the portal, another phone), nothing
 * is written: the screen says so, reads the card again, and asks again.
 *
 * @module directory/screens/CommunityCard
 */
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { useMyName } from '../../rooms/useMyName'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { CardConsentSheet } from '../components/CardConsentSheet'
import { audienceText, directoryRetryable, directoryStatusText, saveFailureText } from '../components/directoryWords'
import { MemberPicture } from '../components/MemberPicture'
import { PhotoConsentSheet } from '../components/PhotoConsentSheet'
import { PhotoRemoveSheet } from '../components/PhotoRemoveSheet'
import { PICTURE_FIELD, type PhotoAudience } from '../types'
import { useDirectoryService, useMyCommunityCard } from '../useDirectory'

type Step =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; text: string }

type PhotoStep =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'removeAsking' }
  | { kind: 'removing' }
  | { kind: 'removed' }
  | { kind: 'failed'; text: string }

const CommunityCard: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const navigation = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const communityDid = (useRoute()?.params as { communityDid?: string } | undefined)?.communityDid ?? ''
  const community = communityLabelOf(communityDid, t)
  const service = useDirectoryService()
  const mine = useMyCommunityCard(service, communityDid)
  const me = useMyName(communityDid)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  // "Keep as is" on the changed-name prompt: asked once per visit, and kept means kept.
  const [kept, setKept] = useState(false)
  const [photoStep, setPhotoStep] = useState<PhotoStep>({ kind: 'idle' })
  const [chosen, setChosen] = useState<PhotoAudience>('members')
  const opts = { community, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 20, gap: 16 },
    // The screen and a filled card are the same grey in Keyring's theme: the border is what shows the card.
    card: { borderRadius: 10, borderWidth: 1, borderColor: ColorPalette.grayscale.lightGrey, padding: 16, gap: 8 },
    name: { ...TextTheme.headingFour, fontSize: 22, color: ColorPalette.brand.text },
    field: { gap: 2, minHeight: 44, justifyContent: 'center' },
    photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    error: { color: ColorPalette.semantic.error },
  })

  const { card, fields, proposal, nameAudience, status } = mine
  const cardName = card?.name ? String(card.name) : undefined

  const onSend = async () => {
    setStep({ kind: 'saving' })
    try {
      await mine.save()
      setStep({ kind: 'saved' })
    } catch (e) {
      const failure = saveFailureText(t, e, community)
      // The card changed elsewhere: read what it holds now before asking again.
      if (failure.reread) mine.reload()
      setStep({ kind: 'failed', text: failure.text })
    }
  }

  const askPhoto = () => {
    // Starts at administrators only: showing a face more widely is chosen, never accepted by default. Where the member
    // already chose who sees their photo (on this card or elsewhere, e.g. the portal), that choice is kept.
    const own = mine.card?.visibility[PICTURE_FIELD]
    setChosen(mine.photoChoices.find((a) => a === own) ?? 'admins')
    setPhotoStep({ kind: 'asking' })
  }

  const onSendPhoto = async () => {
    setPhotoStep({ kind: 'saving' })
    try {
      await mine.savePhoto(chosen)
      setPhotoStep({ kind: 'saved' })
    } catch (e) {
      const failure = saveFailureText(t, e, community, 'photo')
      if (failure.reread) mine.reload()
      setPhotoStep({ kind: 'failed', text: failure.text })
    }
  }

  const onRemovePhoto = async () => {
    setPhotoStep({ kind: 'removing' })
    try {
      await mine.removePhoto()
      setPhotoStep({ kind: 'removed' })
    } catch (e) {
      const failure = saveFailureText(t, e, community, 'photo')
      if (failure.reread) mine.reload()
      setPhotoStep({ kind: 'failed', text: failure.text })
    }
  }

  const body = () => {
    if (status)
      return (
        <View style={{ gap: 8 }}>
          <ThemedText testID={testIdWithKey('DirectoryCardStatus')}>
            {directoryStatusText(t, status, community)}
          </ThemedText>
          {directoryRetryable(status) ? (
            <Button
              title={t('Directory.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={mine.reload}
              testID={testIdWithKey('DirectoryCardReload')}
            />
          ) : null}
        </View>
      )
    if (!card || !fields)
      return <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('DirectoryCardLoading')} />

    const offer = proposal && nameAudience && proposal.name !== cardName && !kept

    // The photo: offered only where the community defines a picture field, and sent only after the consent sheet.
    const photoBox = () => {
      const { photo, photoChoices, photoAudience, photoDiffers } = mine
      if (!card.picture && photoChoices.length === 0) return null
      return (
        <View style={styles.card} testID={testIdWithKey('DirectoryCardPhoto')}>
          <ThemedText variant="caption" style={styles.muted}>
            {t('Directory.CardPhotoNow')}
          </ThemedText>
          <View style={styles.photoRow}>
            <MemberPicture
              service={service}
              communityDid={communityDid}
              entryId={card.entryId}
              picture={card.picture}
              name={cardName ?? me.name}
              size={56}
              initialsSize={20}
              testID="DirectoryCardPhoto"
            />
            <ThemedText style={{ flex: 1 }} testID={testIdWithKey('DirectoryCardPhotoSeen')}>
              {card.picture && photoAudience
                ? t('Directory.SeenBy', {
                    who: audienceText(t, photoAudience, community),
                    interpolation: { escapeValue: false },
                  })
                : t('Directory.CardPhotoNone')}
            </ThemedText>
          </View>
          {photoDiffers ? (
            <ThemedText testID={testIdWithKey('DirectoryCardPhotoDiffers')}>
              {t('Directory.CardPhotoDiffers', opts)}
            </ThemedText>
          ) : null}
          {photoStep.kind === 'saved' ? (
            <ThemedText testID={testIdWithKey('DirectoryCardPhotoSaved')}>
              {t('Directory.CardPhotoSaved', opts)}
            </ThemedText>
          ) : null}
          {photoStep.kind === 'removed' ? (
            <ThemedText testID={testIdWithKey('DirectoryCardPhotoRemoved')}>
              {t('Directory.CardPhotoRemoved', opts)}
            </ThemedText>
          ) : null}
          {photoStep.kind === 'failed' ? (
            <ThemedText style={styles.error} testID={testIdWithKey('DirectoryCardPhotoFailed')}>
              {photoStep.text}
            </ThemedText>
          ) : null}
          {photoChoices.length > 0 && photo && (!card.picture || photoDiffers) ? (
            <Button
              title={t(photoDiffers ? 'Directory.CardPhotoUpdate' : 'Directory.CardPhotoUse')}
              buttonType={ButtonType.Primary}
              onPress={askPhoto}
              testID={testIdWithKey('DirectoryCardPhotoUse')}
            />
          ) : null}
          {photoChoices.length > 0 && !photo && !card.picture ? (
            <>
              <ThemedText testID={testIdWithKey('DirectoryCardPhotoNoProfilePhoto')}>
                {t('Directory.CardPhotoNoProfilePhoto')}
              </ThemedText>
              <Button
                title={t('Directory.CardOpenProfile')}
                buttonType={ButtonType.Secondary}
                onPress={() => navigation.navigate(Screens.EditRCard, me.profileId ? { profileId: me.profileId } : {})}
                testID={testIdWithKey('DirectoryCardPhotoOpenProfile')}
              />
            </>
          ) : null}
          {card.picture ? (
            <Button
              title={t('Directory.CardPhotoRemove')}
              buttonType={ButtonType.Secondary}
              onPress={() => setPhotoStep({ kind: 'removeAsking' })}
              testID={testIdWithKey('DirectoryCardPhotoRemove')}
            />
          ) : null}
        </View>
      )
    }
    return (
      <>
        <View style={styles.card} testID={testIdWithKey('DirectoryCardName')}>
          <ThemedText variant="caption" style={styles.muted}>
            {t('Directory.CardNameNow', opts)}
          </ThemedText>
          {cardName ? (
            <ThemedText style={styles.name} testID={testIdWithKey('DirectoryCardNameValue')}>
              {cardName}
            </ThemedText>
          ) : (
            <ThemedText testID={testIdWithKey('DirectoryCardNoName')}>{t('Directory.CardNoName')}</ThemedText>
          )}
        </View>

        {/* The profile's name changed since it went on the card: ask, never sync. */}
        {mine.differs && proposal && !kept ? (
          <ThemedText testID={testIdWithKey('DirectoryCardDiffers')}>
            {t('Directory.CardDiffers', { ...opts, name: proposal.name })}
          </ThemedText>
        ) : null}

        {step.kind === 'saved' && cardName ? (
          <ThemedText testID={testIdWithKey('DirectoryCardSaved')}>
            {t('Directory.CardSaved', { ...opts, name: cardName })}
          </ThemedText>
        ) : null}
        {step.kind === 'failed' ? (
          <ThemedText style={styles.error} testID={testIdWithKey('DirectoryCardFailed')}>
            {step.text}
          </ThemedText>
        ) : null}

        {offer ? (
          <View style={{ gap: 8 }}>
            <Button
              title={t(cardName ? 'Directory.CardUpdateName' : 'Directory.CardUseName', {
                name: proposal.name,
                interpolation: { escapeValue: false },
              })}
              buttonType={ButtonType.Primary}
              onPress={() => setStep({ kind: 'asking' })}
              testID={testIdWithKey('DirectoryCardUseName')}
            />
            {mine.differs ? (
              <Button
                title={t('Directory.CardKeep')}
                buttonType={ButtonType.Secondary}
                onPress={() => setKept(true)}
                testID={testIdWithKey('DirectoryCardKeep')}
              />
            ) : null}
          </View>
        ) : !proposal ? (
          <View style={{ gap: 8 }}>
            <ThemedText testID={testIdWithKey('DirectoryCardProfileNoName')}>
              {t('Directory.CardProfileNoName')}
            </ThemedText>
            <Button
              title={t('Directory.CardOpenProfile')}
              buttonType={ButtonType.Secondary}
              onPress={() => navigation.navigate(Screens.EditRCard, me.profileId ? { profileId: me.profileId } : {})}
              testID={testIdWithKey('DirectoryCardOpenProfile')}
            />
          </View>
        ) : null}

        {photoBox()}

        <View style={styles.card} testID={testIdWithKey('DirectoryCardFields')}>
          <ThemedText variant="bold" accessibilityRole="header">
            {t('Directory.CardWhoSees')}
          </ThemedText>
          {fields.map((field) => (
            <View key={field.key} style={styles.field} testID={testIdWithKey(`DirectoryCardField_${field.key}`)}>
              <ThemedText>{String(field.label)}</ThemedText>
              <ThemedText variant="caption" style={styles.muted}>
                {t('Directory.SeenBy', {
                  who: audienceText(t, field.audience, community),
                  interpolation: { escapeValue: false },
                })}
              </ThemedText>
            </View>
          ))}
        </View>

        {mine.photo && mine.photoChoices.length > 0 ? (
          <PhotoConsentSheet
            visible={photoStep.kind === 'asking' || photoStep.kind === 'saving'}
            community={community}
            photo={mine.photo}
            choices={mine.photoChoices}
            chosen={chosen}
            current={mine.photoAudience}
            saving={photoStep.kind === 'saving'}
            onChoose={setChosen}
            onSend={() => void onSendPhoto()}
            onClose={() => setPhotoStep({ kind: 'idle' })}
          />
        ) : null}
        <PhotoRemoveSheet
          visible={photoStep.kind === 'removeAsking' || photoStep.kind === 'removing'}
          saving={photoStep.kind === 'removing'}
          onRemove={() => void onRemovePhoto()}
          onClose={() => setPhotoStep({ kind: 'idle' })}
        />

        {proposal && nameAudience ? (
          <CardConsentSheet
            visible={step.kind === 'asking' || step.kind === 'saving'}
            community={community}
            name={proposal.name}
            seenBy={audienceText(t, nameAudience, community)}
            saving={step.kind === 'saving'}
            onSend={() => void onSend()}
            onClose={() => setStep({ kind: 'idle' })}
          />
        ) : null}
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('DirectoryCard')}>
        {body()}
      </ScrollView>
    </SafeAreaView>
  )
}

export default CommunityCard
