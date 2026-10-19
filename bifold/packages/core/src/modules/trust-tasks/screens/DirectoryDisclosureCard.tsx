/**
 * What a community's member directory would show about the person, and to
 * whom, in words (join manifest/0.4, tf#823), shown before they send a
 * request: on Join, on an invitation, at the vetting's last step, and on a
 * community they are not a member of yet.
 *
 * Every audience is a maximum: the person can always show less after
 * joining, so each line says "at most". The community's labels and
 * descriptions are its own words, shown as plain text and never followed or
 * rendered as markup. A community with no statement gets no card at all,
 * never a line saying it has no directory.
 *
 * Test ids: `DirectoryDisclosure` on the card, `DirectoryDisclosureField_<i>`
 * per field, `DirectoryDisclosureNewCard`, `DirectoryDisclosureDid`,
 * `DirectoryDisclosureNotes`, `DirectoryDisclosureGroups`,
 * `DirectoryDisclosureExternal`.
 *
 * @module trust-tasks/screens/DirectoryDisclosureCard
 */
import type { TFunction } from 'i18next'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { DirectoryAudience, DirectoryDisclosure, FieldSource } from '../module/directoryDisclosure'

/** An audience in words, read as the widest a value can reach. */
export const audienceWords = (audience: DirectoryAudience, community: string, t: TFunction): string =>
  t(`Directory.Audience.${audience}`, { community, interpolation: { escapeValue: false } }) as string

const sourceWords = (source: FieldSource, t: TFunction): string => t(`Directory.Source.${source}`) as string

/**
 * An ISO 8601 duration in weeks, days, hours, minutes and seconds (the only
 * form the statement allows), in words; anything else is shown as given.
 */
export function durationWords(duration: string, t: TFunction): string {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration)
  if (!m || m.slice(1).every((part) => part === undefined)) return duration
  const units = ['weeks', 'days', 'hours', 'minutes', 'seconds'] as const
  return units
    .map((unit, i) => (m[i + 1] ? (t(`Directory.Duration.${unit}`, { count: Number(m[i + 1]) }) as string) : undefined))
    .filter(Boolean)
    .join(', ')
}

export const DirectoryDisclosureCard: React.FC<{ disclosure: DirectoryDisclosure; community: string }> = ({
  disclosure,
  community,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 10 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    field: { gap: 2 },
  })
  const say = (key: string, values: Record<string, unknown> = {}) =>
    t(key, { community, ...values, interpolation: { escapeValue: false } }) as string
  const { newCard } = disclosure
  return (
    <View style={styles.card} testID={testIdWithKey('DirectoryDisclosure')}>
      <ThemedText variant="bold" accessibilityRole="header">
        {say('Directory.Title')}
      </ThemedText>
      <ThemedText style={styles.muted}>{say('Directory.AtMost')}</ThemedText>
      {disclosure.fields.map((field, i) => (
        <View key={field.key} style={styles.field} testID={testIdWithKey(`DirectoryDisclosureField_${i}`)}>
          {/* The community's own words: plain text, never markup. */}
          <ThemedText variant="bold">{field.label}</ThemedText>
          {field.description ? <ThemedText style={styles.muted}>{field.description}</ThemedText> : null}
          <ThemedText>
            {say('Directory.Field', {
              who: sourceWords(field.source, t),
              shown: audienceWords(field.defaultVisibility, community, t),
              most: audienceWords(field.ceiling, community, t),
            })}
            {field.searchable ? ` ${say('Directory.Searchable')}` : ''}
          </ThemedText>
        </View>
      ))}
      <ThemedText testID={testIdWithKey('DirectoryDisclosureNewCard')}>
        {say('Directory.NewCard', {
          listing: t(`Directory.Listing.${newCard.listing}`),
          search: t(`Directory.Search.${newCard.search}`),
        })}
        {newCard.introductions
          ? ` ${say('Directory.Introductions', { from: t(`Directory.IntroductionsFrom.${newCard.introductions}`) })}`
          : ''}
      </ThemedText>
      <ThemedText testID={testIdWithKey('DirectoryDisclosureDid')}>
        {say('Directory.Identifier', { most: audienceWords(disclosure.membershipIdentifiers, community, t) })}
      </ThemedText>
      <ThemedText testID={testIdWithKey('DirectoryDisclosureNotes')}>
        {say(disclosure.adminNotes ? 'Directory.NotesKept' : 'Directory.NotesNone')}
      </ThemedText>
      {disclosure.groups ? (
        <ThemedText testID={testIdWithKey('DirectoryDisclosureGroups')}>
          {say('Directory.Groups', { validity: durationWords(disclosure.groups.credentialValidity, t) })}
        </ThemedText>
      ) : null}
      <ThemedText testID={testIdWithKey('DirectoryDisclosureExternal')}>
        {say(disclosure.externalCards ? 'Directory.ExternalAllowed' : 'Directory.ExternalNone')}
      </ThemedText>
    </View>
  )
}

export default DirectoryDisclosureCard
