/**
 * "Your card" in a community (parity plan §9.3 #1, at VTC 0.12): the name on the member's card there, who sees each
 * field, and the way to put the name of the profile they joined with on it.
 *
 * Nothing is written without a yes. "Use … on your card" opens the consent sheet, which lists each value that would
 * go and who would see it, then says plainly that administrators see all of it, including the ID the member joined
 * with (§9.4). The card keeps the community's default for who sees each field: this screen changes no visibility.
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
import { useDirectoryService, useMyCommunityCard } from '../useDirectory'

type Step =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'saving' }
  | { kind: 'saved' }
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
  const opts = { community, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 20, gap: 16 },
    // The screen and a filled card are the same grey in Keyring's theme: the border is what shows the card.
    card: { borderRadius: 10, borderWidth: 1, borderColor: ColorPalette.grayscale.lightGrey, padding: 16, gap: 8 },
    name: { ...TextTheme.headingFour, fontSize: 22, color: ColorPalette.brand.text },
    field: { gap: 2, minHeight: 44, justifyContent: 'center' },
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
