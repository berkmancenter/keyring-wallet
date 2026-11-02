/**
 * Another member's card in a community: their name and role, then every other field they show to members, in the
 * community's order. Opened from the members list (by entry) or from a room author's sheet (by their DID, for an
 * author who shows their identity to members). Everything on it is what they wrote about themselves, or what a card
 * they hold says, and the screen says whose card it is. Nothing here is kept: it is read when the screen opens.
 *
 * A card the community does not show reads "There's no card to show"; a read that failed says so, with Try again, so
 * a lost answer never reads as "they have no card".
 *
 * @module directory/screens/CommunityMemberCard
 */
import { useRoute } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { initialsOf } from '../../../utils/initials'
import { testIdWithKey } from '../../../utils/testable'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { directoryRetryable, directoryStatusText, memberRoleText } from '../components/directoryWords'
import type { CardValue } from '../types'
import { useDirectoryService, useMemberCard } from '../useDirectory'

export interface CommunityMemberCardParams {
  communityDid: string
  /** From the members list. */
  entryId?: string
  /** From a room author's sheet. */
  memberDid?: string
  /** What the room calls them ("Member …saddle"), for the title when the card shows no name. */
  standIn?: string
}

const CommunityMemberCard: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const params = (useRoute()?.params ?? {}) as Partial<CommunityMemberCardParams>
  const communityDid = params.communityDid ?? ''
  const community = communityLabelOf(communityDid, t)
  const service = useDirectoryService()
  const view = useMemberCard(service, communityDid, { entryId: params.entryId, memberDid: params.memberDid })
  const opts = { community, interpolation: { escapeValue: false } }
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 20, gap: 16 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    disc: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    initials: { color: ColorPalette.grayscale.white, fontSize: 20 },
    title: { ...TextTheme.headingFour, fontSize: 22, color: ColorPalette.brand.text },
    sub: { color: ColorPalette.grayscale.mediumGrey, fontSize: 15 },
    // The screen and a filled card are the same grey in Keyring's theme: the border is what shows the card.
    card: { borderRadius: 10, borderWidth: 1, borderColor: ColorPalette.grayscale.lightGrey, padding: 16, gap: 12 },
    line: { gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })

  const valueText = (value: CardValue): string =>
    value.kind === 'list'
      ? value.items.join(', ')
      : value.kind === 'yesNo'
        ? (t(value.yes ? 'Directory.Yes' : 'Directory.No') as string)
        : String(value.text)

  const body = () => {
    if (view.status)
      return (
        <View style={{ gap: 8 }}>
          <ThemedText testID={testIdWithKey('MemberCardStatus')}>
            {directoryStatusText(t, view.status, community)}
          </ThemedText>
          {directoryRetryable(view.status) ? (
            <Button
              title={t('Directory.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={view.reload}
              testID={testIdWithKey('MemberCardReload')}
            />
          ) : null}
        </View>
      )
    if (view.none)
      return (
        <ThemedText testID={testIdWithKey('MemberCardNone')}>
          {t('Directory.NoCardToShow', {
            ...opts,
            member: params.standIn ?? (t('Directory.ThisMember') as string),
          })}
        </ThemedText>
      )
    if (!view.card)
      return <ActivityIndicator color={ColorPalette.brand.primary} testID={testIdWithKey('MemberCardLoading')} />

    const { card } = view
    const name = card.name ? String(card.name) : undefined
    const role = memberRoleText(t, card.role ? String(card.role) : undefined)
    return (
      <>
        <View style={styles.head}>
          <View style={styles.disc}>
            <ThemedText variant="bold" style={styles.initials}>
              {initialsOf(name)}
            </ThemedText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={styles.title} accessibilityRole="header" testID={testIdWithKey('MemberCardName')}>
              {name ?? params.standIn ?? t('Directory.MemberCardTitle')}
            </ThemedText>
            {role ? (
              <ThemedText style={styles.sub} testID={testIdWithKey('MemberCardRole')}>
                {role}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.sub} testID={testIdWithKey('MemberCardWhose')}>
              {t('Directory.TheirOwnCard', opts)}
            </ThemedText>
          </View>
        </View>
        {card.entries.length > 0 ? (
          <View style={styles.card} testID={testIdWithKey('MemberCardFields')}>
            {card.entries.map((entry) => (
              <View key={entry.key} style={styles.line} testID={testIdWithKey(`MemberCardField_${entry.key}`)}>
                <ThemedText variant="caption" style={styles.muted}>
                  {String(entry.label)}
                </ThemedText>
                <ThemedText selectable>{valueText(entry.value)}</ThemedText>
                {entry.value.kind === 'verified' ? (
                  <ThemedText variant="caption" style={styles.muted}>
                    {t('Directory.CheckedAgainstCard')}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <ThemedText style={styles.muted} testID={testIdWithKey('MemberCardNothingElse')}>
            {t('Directory.NothingElseShown')}
          </ThemedText>
        )}
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID={testIdWithKey('MemberCard')}>
        {body()}
      </ScrollView>
    </SafeAreaView>
  )
}

export default CommunityMemberCard
