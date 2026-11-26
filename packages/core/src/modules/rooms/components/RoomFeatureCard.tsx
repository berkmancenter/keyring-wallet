/**
 * A rooms feature that is on its way: the feature's icon, its name, one line on what it will do, and a "Coming soon"
 * badge shaped as the tier badge is. It shows only for a status that says the feature is coming (Keyring has not built
 * it, or nothing upstream serves it yet); for any other status it shows nothing, and the screen keeps its plain line
 * ("Your agent needs an update", "You can't post here"), since nothing is on its way there. When a feature ships,
 * its status turns available and the card stops showing: nothing to remove.
 *
 * One element to a screen reader ("Room files. Share documents…. Coming soon"), never a button. `strip` is the
 * composer's slot: the composer's own height, with the badge beside the name, so the chat does not jump when posting
 * arrives; the room's keyboard view handles the bottom inset.
 *
 * @module rooms/components/RoomFeatureCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { OperationStatus } from '../types'

/** The features a card can stand for, each with its icon and its words. */
const FEATURES = {
  write: { icon: 'message-text-clock-outline', title: 'Rooms.SoonWriteTitle', line: 'Rooms.SoonWriteLine' },
  files: { icon: 'folder-clock-outline', title: 'Rooms.SoonFilesTitle', line: 'Rooms.SoonFilesLine' },
  notes: { icon: 'note-text-outline', title: 'Rooms.SoonNotesTitle', line: 'Rooms.SoonNotesLine' },
  noteWrite: { icon: 'note-edit-outline', title: 'Rooms.SoonNoteWriteTitle', line: 'Rooms.SoonNoteWriteLine' },
  curate: { icon: 'pin-outline', title: 'Rooms.SoonCurateTitle', line: 'Rooms.SoonCurateLine' },
  agent: { icon: 'robot-outline', title: 'Rooms.SoonAgentTitle', line: 'Rooms.SoonAgentLine' },
  chat: { icon: 'forum-outline', title: 'Rooms.SoonChatTitle', line: 'Rooms.SoonChatLine' },
  members: { icon: 'account-group-outline', title: 'Rooms.SoonMembersTitle', line: 'Rooms.SoonMembersLine' },
} as const

export type RoomFeature = keyof typeof FEATURES

/**
 * The height of what the strip stands in for: the composer's "Posting as" line and its bar, 23 + 59 pt as measured
 * on an iOS simulator (10-29). The strip is at least this tall and, at the default text size, no taller, so the chat
 * keeps its height when posting arrives.
 */
export const COMPOSER_BLOCK_HEIGHT = 81

/** What a screen reader says for a card: each part a sentence, never "..": a line that ends its own sentence keeps it. */
export const cardWords = (title: string, line: string, soon: string): string =>
  [title, line, soon].map((part) => part.trim().replace(/[.。!?…]+$/u, '')).join('. ')

/** Whether a status says the feature is on its way: the one case a card stands in for. */
export const isComingSoon = (status: OperationStatus | undefined): boolean => status?.status === 'comingSoon'

export interface RoomFeatureCardProps {
  status: OperationStatus | undefined
  feature: RoomFeature
  /** The composer's slot rather than a tab's. */
  strip?: boolean
}

export const RoomFeatureCard: React.FC<RoomFeatureCardProps> = ({ status, feature, strip = false }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  if (!isComingSoon(status)) return null
  const words = FEATURES[feature]
  const title = t(words.title) as string
  const line = t(words.line) as string
  const soon = t('Rooms.ComingSoon') as string
  const styles = StyleSheet.create({
    card: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: strip ? 8 : 12,
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderColor: ColorPalette.grayscale.lightGrey,
      ...(strip
        ? { borderTopWidth: 1, minHeight: COMPOSER_BLOCK_HEIGHT, alignItems: 'center' as const }
        : // The lists it sits in already have their side padding.
          { alignItems: 'flex-start' as const, marginVertical: 12, borderWidth: 1, borderRadius: 10 }),
    },
    disc: {
      width: strip ? 32 : 36,
      height: strip ? 32 : 36,
      borderRadius: strip ? 16 : 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    words: { flex: 1, gap: strip ? 2 : 6 },
    // In the strip the badge sits beside the name, so the strip stays the composer's height.
    titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    line: { color: ColorPalette.grayscale.mediumGrey },
    // The tier badge's shape, so the room's header and the card speak the same badge.
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
  })
  const badge = (
    <View style={styles.badge}>
      <ThemedText variant="caption" maxFontSizeMultiplier={1.5}>
        {soon}
      </ThemedText>
    </View>
  )
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={cardWords(title, line, soon)}
      testID={testIdWithKey(`RoomFeatureCard_${feature}`)}
    >
      <View style={styles.disc}>
        <Icon name={words.icon} size={strip ? 18 : 20} color={ColorPalette.brand.primary} />
      </View>
      <View style={styles.words}>
        <View style={strip ? styles.titleRow : undefined}>
          <ThemedText variant="bold" maxFontSizeMultiplier={1.5}>
            {title}
          </ThemedText>
          {strip ? badge : null}
        </View>
        <ThemedText variant="caption" style={styles.line} maxFontSizeMultiplier={1.5}>
          {line}
        </ThemedText>
        {strip ? null : badge}
      </View>
    </View>
  )
}

export default RoomFeatureCard
