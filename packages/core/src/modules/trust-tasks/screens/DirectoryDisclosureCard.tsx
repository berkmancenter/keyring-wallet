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
 * Fields that read alike are said once: who writes them and the most they can
 * reach head a group, and each new-card audience is one line under the fields
 * it applies to. Every field and every value of the statement is still on the
 * card (`groupFields` drops nothing), since the request names this statement
 * as shown.
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
import type { DirectoryAudience, DirectoryDisclosure, DisclosedField, FieldSource } from '../module/directoryDisclosure'

/** Fields with one new-card audience and the same search, each with its place in the statement. */
export interface FieldRule {
  defaultVisibility: DirectoryAudience
  searchable: boolean
  fields: { field: DisclosedField; index: number }[]
}

/** Fields with one writer and one most, as the rules under them. */
export interface FieldGroup {
  source: FieldSource
  ceiling: DirectoryAudience
  rules: FieldRule[]
}

/**
 * The statement's fields grouped by writer and most, then by new-card
 * audience and search, each in the order its first field comes. Every field
 * is in exactly one rule, with its index in the statement.
 */
export function groupFields(fields: DisclosedField[]): FieldGroup[] {
  const groups: FieldGroup[] = []
  fields.forEach((field, index) => {
    let group = groups.find((g) => g.source === field.source && g.ceiling === field.ceiling)
    if (!group) {
      group = { source: field.source, ceiling: field.ceiling, rules: [] }
      groups.push(group)
    }
    let rule = group.rules.find(
      (r) => r.defaultVisibility === field.defaultVisibility && r.searchable === field.searchable
    )
    if (!rule) {
      rule = { defaultVisibility: field.defaultVisibility, searchable: field.searchable, fields: [] }
      group.rules.push(rule)
    }
    rule.fields.push({ field, index })
  })
  return groups
}

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
    group: {
      gap: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: ColorPalette.grayscale.lightGrey,
    },
    rule: { gap: 2 },
    names: { flexDirection: 'row', flexWrap: 'wrap' },
    field: { gap: 2 },
  })
  const say = (key: string, values: Record<string, unknown> = {}) =>
    t(key, { community, ...values, interpolation: { escapeValue: false } }) as string
  const { newCard } = disclosure
  // A rule's fields named on one line, unless one carries the community's description, which needs its own lines.
  const fieldsOf = ({ fields }: FieldRule) =>
    fields.some(({ field }) => field.description) ? (
      fields.map(({ field, index }) => (
        <View key={field.key} style={styles.field} testID={testIdWithKey(`DirectoryDisclosureField_${index}`)}>
          {/* The community's own words: plain text, never markup. */}
          <ThemedText variant="bold">{field.label}</ThemedText>
          {field.description ? <ThemedText style={styles.muted}>{field.description}</ThemedText> : null}
        </View>
      ))
    ) : (
      <View style={styles.names}>
        {fields.map(({ field, index }, i) => (
          <ThemedText key={field.key} variant="bold" testID={testIdWithKey(`DirectoryDisclosureField_${index}`)}>
            {i < fields.length - 1 ? `${field.label}, ` : field.label}
          </ThemedText>
        ))}
      </View>
    )
  return (
    <View style={styles.card} testID={testIdWithKey('DirectoryDisclosure')}>
      <ThemedText variant="bold" accessibilityRole="header">
        {say('Directory.Title')}
      </ThemedText>
      <ThemedText style={styles.muted}>{say('Directory.AtMost')}</ThemedText>
      {groupFields(disclosure.fields).map((group) => (
        <View key={`${group.source}-${group.ceiling}`} style={styles.group}>
          <ThemedText variant="caption" style={styles.muted}>
            {say('Directory.GroupHeading', {
              who: sourceWords(group.source, t),
              most: audienceWords(group.ceiling, community, t),
            })}
          </ThemedText>
          {group.rules.map((rule) => (
            <View key={`${rule.defaultVisibility}-${rule.searchable}`} style={styles.rule}>
              {fieldsOf(rule)}
              <ThemedText>
                {say('Directory.RuleShows', {
                  count: rule.fields.length,
                  shown: audienceWords(rule.defaultVisibility, community, t),
                })}
                {rule.searchable
                  ? ` ${say(rule.fields.length > 1 ? 'Directory.SearchableMany' : 'Directory.Searchable')}`
                  : ''}
              </ThemedText>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.group}>
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
    </View>
  )
}

export default DirectoryDisclosureCard
