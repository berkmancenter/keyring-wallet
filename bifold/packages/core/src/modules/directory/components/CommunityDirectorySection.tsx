/**
 * The directory on a community's screen, for a member: its Members, and "Your card", what the community's directory
 * shows about the member. Each opens its own screen; nothing is read until one is opened.
 *
 * It reads as the screen's other sections do (276.10, option A): "DIRECTORY" over one grouped card. Your card names
 * the member by the profile they joined with, a read on this phone, never the card itself: reading the card at
 * VTC 0.12 (card/show) creates one, so it is read only on the Your card screen the member opens. Who sees what is
 * said in fixed words here (name and role go to all members by default); the card's own audiences are on that screen.
 *
 * @module directory/components/CommunityDirectorySection
 */
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { initialsOf } from '../../../utils/initials'
import { testIdWithKey } from '../../../utils/testable'
import { useMyName } from '../../rooms/useMyName'
import {
  CommunityGroup,
  CommunityGroupDivider,
  CommunitySectionLabel,
} from '../../trust-tasks/screens/CommunitySection'

export const CommunityDirectorySection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { name } = useMyName(communityDid)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    lead: { width: 32, alignItems: 'center' },
    initial: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: ColorPalette.brand.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    words: { flex: 1, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const row = (key: string, screen: Screens, title: string, line: string, lead: React.ReactNode) => (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}`}
      onPress={() => go.navigate(screen, { communityDid })}
      testID={testIdWithKey(key)}
    >
      <View style={styles.lead}>{lead}</View>
      <View style={styles.words}>
        <ThemedText>{title}</ThemedText>
        <ThemedText variant="caption" style={styles.muted}>
          {line}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
    </Pressable>
  )
  return (
    <View style={{ gap: 6 }} testID={testIdWithKey('CommunityDirectory')}>
      <CommunitySectionLabel title={t('Directory.SectionTitle')} />
      <CommunityGroup>
        {row(
          'CommunityDirectoryMembers',
          Screens.CommunityMembers,
          t('Directory.MembersRow'),
          t('Directory.MembersRowLine'),
          <Icon name="account-group-outline" size={24} color={ColorPalette.brand.primary} />
        )}
        <CommunityGroupDivider />
        {row(
          'CommunityDirectoryCard',
          Screens.CommunityCard,
          name ? t('Directory.CardRowNamed', { name, interpolation: { escapeValue: false } }) : t('Directory.CardRow'),
          t('Directory.CardRowSeen'),
          name ? (
            <View style={styles.initial}>
              <ThemedText variant="bold" style={{ color: ColorPalette.grayscale.white, fontSize: 13 }}>
                {initialsOf(name)}
              </ThemedText>
            </View>
          ) : (
            <Icon name="card-account-details-outline" size={24} color={ColorPalette.brand.primary} />
          )
        )}
      </CommunityGroup>
    </View>
  )
}

export default CommunityDirectorySection
