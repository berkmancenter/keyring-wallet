/**
 * A badge's details in the Wallet (docs/plans/member-badges-plan.md, Wallet): the picture, the badge's name and what it
 * is for, who gave it (the community), each time it was earned, how long it is valid, and the notes its givers wrote.
 * "All cards" returns to the Wallet.
 *
 * The notes travel in the credential's evidence and are the holder's alone (Rules, Notes stay private): this screen is
 * the only place they show, and it says so.
 *
 * Gated at render, not only where it is opened: with badges off it draws nothing, so a kill reaches a card already open.
 *
 * @module badges/wallet/BadgeCardDetails
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { BadgeCardView } from '../../trust-tasks/module/badgeCredentials'
import { isMemberBadgesOn } from '../badgesSwitch'

import { BadgePicture } from './BadgePicture'
import { badgeCardFace } from './badgeCardFace'

export interface BadgeCardDetailsProps {
  view: BadgeCardView
  /** The picture the card already has (useBadgePicture), so opening the details asks for nothing again. */
  picture?: string
  /** The name the community published to this phone, if any. */
  published?: string
  onClose: () => void
}

export const BadgeCardDetails: React.FC<BadgeCardDetailsProps> = ({ view, picture, published, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!isMemberBadgesOn()) return null
  const face = badgeCardFace(view, t, published)
  const notes = view.evidence.map((e) => e.note?.trim()).filter((n): n is string => Boolean(n))

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    page: { paddingHorizontal: 15, paddingTop: 8, paddingBottom: 24, gap: 14 },
    close: { height: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2 },
    closeText: { color: ColorPalette.brand.primary, fontWeight: '600' },
    head: { alignItems: 'center', gap: 8, paddingVertical: 8 },
    name: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
    description: { textAlign: 'center', color: ColorPalette.grayscale.mediumGrey },
    group: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, overflow: 'hidden' },
    row: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    rowLabel: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey },
    heading: { fontSize: 15, fontWeight: '600', marginHorizontal: 4 },
    note: { color: ColorPalette.grayscale.mediumGrey, marginHorizontal: 4 },
  })

  const row = (label: string, value: string, testID?: string) => (
    <View key={label} style={styles.row}>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      <ThemedText testID={testID}>{value}</ThemedText>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page} testID={testIdWithKey('BadgeCardDetails')}>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={styles.close}
          hitSlop={{ left: 8, right: 8 }}
          testID={testIdWithKey('BadgeCardClose')}
        >
          <Icon name="chevron-left" size={24} color={ColorPalette.brand.primary} />
          <ThemedText style={styles.closeText}>{t('BadgeCard.AllCards')}</ThemedText>
        </Pressable>
        <View style={styles.head}>
          <BadgePicture uri={picture} size={96} testID={testIdWithKey('BadgeCardDetailsPicture')} />
          <ThemedText style={styles.name} testID={testIdWithKey('BadgeCardDetailsName')}>
            {face.name}
          </ThemedText>
          {view.description ? (
            <ThemedText style={styles.description} testID={testIdWithKey('BadgeCardDescription')}>
              {view.description}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.group}>
          {row(t('BadgeCard.GivenBy'), face.community, testIdWithKey('BadgeCardGivenBy'))}
          {face.earnedDates.length
            ? row(t('BadgeCard.EarnedOn'), face.earnedDates.join('\n'), testIdWithKey('BadgeCardEarnedOn'))
            : null}
          {face.validUntil
            ? row(t('BadgeCard.ValidUntil'), face.validUntil, testIdWithKey('BadgeCardValidUntil'))
            : null}
        </View>
        {notes.length ? (
          <View style={{ gap: 6 }} testID={testIdWithKey('BadgeCardNotes')}>
            <ThemedText style={styles.heading}>{t('BadgeCard.Notes')}</ThemedText>
            <View style={styles.group}>
              {notes.map((note, i) => (
                <View key={i} style={styles.row}>
                  <ThemedText>{note}</ThemedText>
                </View>
              ))}
            </View>
            <ThemedText style={styles.note}>{t('BadgeCard.NotesPrivate')}</ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default BadgeCardDetails
