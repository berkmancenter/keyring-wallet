/**
 * The directory on a community's screen, for a member: its Members, and "Your card", what the community's directory
 * shows about the member. Each opens its own screen; nothing is read until one is opened.
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
import { testIdWithKey } from '../../../utils/testable'

export const CommunityDirectorySection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 44,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
    },
    words: { flex: 1, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  const row = (key: string, screen: Screens, title: string, line: string, icon: string) => (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}`}
      onPress={() => go.navigate(screen, { communityDid })}
      testID={testIdWithKey(key)}
    >
      <Icon name={icon} size={24} color={ColorPalette.brand.primary} />
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
    <View style={{ gap: 8 }} testID={testIdWithKey('CommunityDirectory')}>
      <ThemedText variant="headingFour" accessibilityRole="header">
        {t('Directory.SectionTitle')}
      </ThemedText>
      {row(
        'CommunityDirectoryMembers',
        Screens.CommunityMembers,
        t('Directory.MembersRow'),
        t('Directory.MembersRowLine'),
        'account-group-outline'
      )}
      {row(
        'CommunityDirectoryCard',
        Screens.CommunityCard,
        t('Directory.CardRow'),
        t('Directory.CardRowLine'),
        'card-account-details-outline'
      )}
    </View>
  )
}

export default CommunityDirectorySection
