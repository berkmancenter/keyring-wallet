import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { EmojiEntry, getEmojiSet } from './data'
import { EmojiPickerIds, emojiCodePoints } from './EmojiPicker.ids'
import { deviceMaxEmojiVersion } from './osSupport'
import { addRecent, loadRecent, saveRecent } from './recent'
import { offeredGroups, searchEmoji, toRows } from './search'

export interface EmojiPickerProps {
  /** Called with the fully-qualified emoji the person chose. */
  onSelect: (emoji: string) => void
  /** The newest emoji version to offer; defaults to what this device's OS can draw. */
  maxVersion?: number
  columns?: number
}

/**
 * Translation keys for the Unicode group names; a group without one shows its
 * English name. A Map, because the names come from the data file: indexing a
 * plain object would also find inherited keys such as "constructor".
 */
export const GROUP_LABEL_KEYS: ReadonlyMap<string, string> = new Map([
  ['Smileys & Emotion', 'Emoji.Group.SmileysEmotion'],
  ['People & Body', 'Emoji.Group.PeopleBody'],
  ['Animals & Nature', 'Emoji.Group.AnimalsNature'],
  ['Food & Drink', 'Emoji.Group.FoodDrink'],
  ['Travel & Places', 'Emoji.Group.TravelPlaces'],
  ['Activities', 'Emoji.Group.Activities'],
  ['Objects', 'Emoji.Group.Objects'],
  ['Symbols', 'Emoji.Group.Symbols'],
  ['Flags', 'Emoji.Group.Flags'],
])

/** The heading for a Unicode group: its translation if there is one, else its English name. */
export function groupLabel(group: string, translate: (key: string) => string): string {
  const key = GROUP_LABEL_KEYS.get(group)
  return key ? translate(key) : group
}

const CELL = 44

interface Section {
  key: string
  title: string
  testID?: string
  data: EmojiEntry[][]
}

/**
 * The chat's emoji picker: a recent row, the emoji grouped by Unicode
 * category, and English search over CLDR names and keywords. It offers base
 * emoji only, and only those the device can draw (plan §5, "Emoji picker").
 * Presentation (sheet or modal) is the caller's.
 */
const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, maxVersion, columns = 8 }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const limit = maxVersion ?? deviceMaxEmojiVersion()
  const set = getEmojiSet()

  useEffect(() => {
    let live = true
    loadRecent()
      .then((list) => live && setRecent(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const choose = useCallback(
    (emoji: string) => {
      setRecent((previous) => {
        const next = addRecent(previous, emoji)
        saveRecent(next).catch(() => undefined)
        return next
      })
      onSelect(emoji)
    },
    [onSelect]
  )

  const sections = useMemo<Section[]>(() => {
    const recentEntries = recent
      .map((e) => set.byEmoji.get(e))
      .filter((e): e is EmojiEntry => !!e && e.version <= limit)
    const groups = offeredGroups(set, limit).map((g) => ({
      key: g.group,
      title: groupLabel(g.group, t),
      data: toRows(g.entries, columns),
    }))
    return recentEntries.length > 0
      ? [
          {
            key: 'recent',
            title: t('Emoji.Recent'),
            testID: EmojiPickerIds.recent,
            data: toRows(recentEntries, columns),
          },
          ...groups,
        ]
      : groups
  }, [recent, set, limit, columns, t])

  const results = useMemo(() => toRows(searchEmoji(set, query, limit), columns), [set, query, limit, columns])

  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
    search: {
      ...TextTheme.normal,
      flex: 1,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.mediumGrey,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    clear: { paddingHorizontal: 8, paddingVertical: 8 },
    header: { ...TextTheme.labelSubtitle, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
    row: { flexDirection: 'row', paddingHorizontal: 8 },
    cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
    emoji: { fontSize: 28 },
    empty: { ...TextTheme.normal, padding: 24, textAlign: 'center' },
  })

  const renderRow = ({ item }: { item: EmojiEntry[] }) => (
    <View style={styles.row}>
      {item.map((e) => (
        <Pressable
          key={e.emoji}
          style={styles.cell}
          onPress={() => choose(e.emoji)}
          accessibilityRole="button"
          accessibilityLabel={e.name}
          testID={testIdWithKey(`EmojiPickerEmoji_${emojiCodePoints(e.emoji)}`)}
        >
          <Text style={styles.emoji} allowFontScaling={false}>
            {e.emoji}
          </Text>
        </Pressable>
      ))}
    </View>
  )

  const rowKey = (row: EmojiEntry[]) => row[0].emoji

  return (
    <View style={styles.root} testID={testIdWithKey(EmojiPickerIds.root)}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('Emoji.Search')}
          placeholderTextColor={ColorPalette.grayscale.mediumGrey}
          accessibilityLabel={t('Emoji.Search')}
          autoCorrect={false}
          autoCapitalize="none"
          testID={testIdWithKey(EmojiPickerIds.search)}
        />
        {query.length > 0 && (
          <Pressable
            style={styles.clear}
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel={t('Emoji.ClearSearch')}
            testID={testIdWithKey(EmojiPickerIds.clearSearch)}
          >
            <Text style={TextTheme.normal}>✕</Text>
          </Pressable>
        )}
      </View>
      {query.trim().length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={rowKey}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty} testID={testIdWithKey(EmojiPickerIds.noResults)}>
              {t('Emoji.NoResults')}
            </Text>
          }
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={rowKey}
          renderItem={renderRow}
          renderSectionHeader={({ section }) => (
            <Text
              style={styles.header}
              accessibilityRole="header"
              testID={section.testID ? testIdWithKey(section.testID) : undefined}
            >
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
        />
      )}
    </View>
  )
}

export default EmojiPicker
