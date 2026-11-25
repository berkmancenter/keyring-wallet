/**
 * "How you know <name>": the relationship one entry per day (relationshipDays), newest first. A day says what the
 * records on this phone show for it: who witnessed it, whether in person, and how many times cards were exchanged,
 * with how many of those signed with secure hardware, said only once that evidence verifies. Tapping a day opens its
 * sheet: the witness's record (event, date, location check) and each exchange with its time.
 *
 * Before, a merged contact or a relationship signed again read the same line and date two or three times, and the
 * witness record sat in another block, in another date format.
 *
 * @module vrc/components/RelationshipLayers
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { absoluteDate, timeLabel, useDateWords, useUses24HourClock } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import { verifyVrcHardwareEvidence } from '../services/BiometricSignatureVerifier'
import { relationshipDays, type RelationshipDay } from '../utils/relationshipDays'
import type { RelationshipLayer } from '../utils/relationshipLayers'
import type { WitnessRecord } from '../utils/witnessCredentialUtils'

const readable = (at?: string): Date | undefined => {
  const time = at ? Date.parse(at) : NaN
  return Number.isFinite(time) ? new Date(time) : undefined
}

export const RelationshipLayers: React.FC<{ name: string; layers: RelationshipLayer[] }> = ({ name, layers }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const words = useDateWords()
  const use24h = useUses24HourClock()
  const [verified, setVerified] = useState<Record<number, boolean>>({})
  // The open day's key, not a copy of it: a hardware check that answers while the sheet is open still shows.
  const [openDay, setOpenDay] = useState<string>()

  useEffect(() => {
    let live = true
    layers.forEach((layer, index) => {
      if (layer.kind !== 'card' || !layer.hardwareEvidence) return
      verifyVrcHardwareEvidence(layer.raw as never)
        .then((result) => live && setVerified((v) => ({ ...v, [index]: result?.valid === true })))
        .catch(() => live && setVerified((v) => ({ ...v, [index]: false })))
    })
    return () => {
      live = false
    }
  }, [layers])

  const days = useMemo(() => relationshipDays(layers, verified), [layers, verified])
  const open = openDay === undefined ? undefined : days.find((day) => day.day === openDay)
  if (layers.length === 0) return null

  const raw = { interpolation: { escapeValue: false } }
  const dayDate = (day: RelationshipDay) => {
    const date = readable(day.at)
    return date ? absoluteDate(date, words) : t('Relationship.DayUndated')
  }
  const dayTitle = (day: RelationshipDay) =>
    day.inPerson ? `${dayDate(day)} · ${t('Relationship.DayInPerson')}` : dayDate(day)
  // What the day's records show, one sentence each: who witnessed it, then the exchanges. Hardware is said only once
  // every check of the day has answered; until then the exchanges are said plainly.
  const daySentences = (day: RelationshipDay): string[] => {
    const said: string[] = []
    if (day.witnesses.length > 0)
      said.push(t('Relationship.DayWitnessedBy', { witnesses: day.witnesses.join(', '), ...raw }))
    else if (day.unnamedWitness) said.push(t('Relationship.DayWitnessed'))
    if (day.cards > 0) {
      const known = day.hardwareChecking === 0
      if (known && day.hardwareVerified === day.cards)
        said.push(t('Relationship.DayCardsHardware', { count: day.cards }))
      else if (known && day.hardwareVerified > 0)
        said.push(t('Relationship.DayCardsSomeHardware', { count: day.cards, verified: day.hardwareVerified }))
      else said.push(t('Relationship.DayCards', { count: day.cards }))
    }
    return said
  }

  const styles = StyleSheet.create({
    section: { gap: 6, marginTop: 16 },
    title: { fontWeight: 'bold' },
    day: { minHeight: 44, paddingVertical: 8, gap: 2 },
    dayTitle: { fontWeight: 'bold' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      padding: 24,
      gap: 12,
      maxHeight: '85%',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    sheetBody: { gap: 12 },
    group: { gap: 6 },
    field: { gap: 0 },
    label: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey },
  })

  const location = (record: WitnessRecord): string | undefined => {
    const check = record.locality
    if (!check || check.outcome === 'not-offered') return undefined
    if (check.outcome === 'confirmed') {
      const venue = check.venue ? ` · ${check.venue}` : ''
      return `${t('Relationship.DayLocationConfirmed')}${venue}`
    }
    return t(check.reason === 'windowLost' ? 'Relationship.DayLocationInterrupted' : 'Relationship.DayLocationDeclined')
  }

  const field = (label: string, value: string) => (
    <View style={styles.field}>
      <ThemedText>{value}</ThemedText>
      <ThemedText style={styles.label}>{label}</ThemedText>
    </View>
  )

  return (
    <View style={styles.section} testID={testIdWithKey('RelationshipLayers')}>
      <ThemedText style={styles.title}>{t('Relationship.LayersTitle', { name, ...raw })}</ThemedText>
      {days.map((day) => (
        <Pressable
          key={day.day || 'undated'}
          style={styles.day}
          onPress={() => setOpenDay(day.day)}
          accessibilityRole="button"
          accessibilityHint={t('Relationship.DayOpenHint')}
          testID={testIdWithKey('RelationshipLayer')}
        >
          <ThemedText style={styles.dayTitle}>{dayTitle(day)}</ThemedText>
          <ThemedText style={styles.muted}>{daySentences(day).join(' ')}</ThemedText>
        </Pressable>
      ))}
      <SafeAreaModal
        visible={open !== undefined}
        transparent
        animationType="slide"
        onRequestClose={() => setOpenDay(undefined)}
      >
        <View style={styles.sheetBack}>
          {open ? (
            <View style={styles.sheet} testID={testIdWithKey('RelationshipDaySheet')}>
              <ThemedText variant="headingThree" accessibilityRole="header">
                {t('Relationship.DaySheetTitle', { date: dayDate(open), name, ...raw })}
              </ThemedText>
              <ScrollView contentContainerStyle={styles.sheetBody}>
                <ThemedText>{daySentences(open).join(' ')}</ThemedText>
                {open.inPerson ? <ThemedText>{t('Relationship.LayerInPerson')}</ThemedText> : null}
                {open.layers.map((layer, index) =>
                  layer.kind === 'witnessed' ? (
                    <View key={`w${index}`} style={styles.group} testID="WitnessRecord">
                      <ThemedText style={styles.title}>{t('Relationship.DayWitnessRecord')}</ThemedText>
                      {field(
                        t('Relationship.DayWitnessedByLabel'),
                        layer.witnessName ?? t('Relationship.DayWitnessUnnamed')
                      )}
                      {layer.record?.event ? field(t('Relationship.DayEvent'), layer.record.event) : null}
                      {readable(layer.at)
                        ? field(t('Relationship.DayDate'), absoluteDate(readable(layer.at) as Date, words))
                        : null}
                      {layer.record && location(layer.record)
                        ? field(t('Relationship.DayLocationCheck'), location(layer.record) as string)
                        : null}
                    </View>
                  ) : null
                )}
                {open.cards > 0 ? (
                  <View style={styles.group}>
                    <ThemedText style={styles.title}>{t('Relationship.DayExchanges')}</ThemedText>
                    {open.layers.map((layer) => {
                      if (layer.kind !== 'card') return null
                      const index = layers.indexOf(layer)
                      const at = readable(layer.at)
                      return (
                        <View key={`c${index}`} style={styles.field} testID={testIdWithKey('RelationshipDayExchange')}>
                          <ThemedText>
                            {t(
                              verified[index] === true ? 'Relationship.HardwareDone' : 'Relationship.DayExchangePlain'
                            )}
                          </ThemedText>
                          {at ? <ThemedText style={styles.label}>{timeLabel(at, words, use24h)}</ThemedText> : null}
                        </View>
                      )
                    })}
                  </View>
                ) : null}
                <ThemedText style={styles.label}>{t('Relationship.DayFootnote')}</ThemedText>
              </ScrollView>
              <Button
                title={t('Global.Close')}
                buttonType={ButtonType.Secondary}
                onPress={() => setOpenDay(undefined)}
                testID={testIdWithKey('RelationshipDaySheetClose')}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaModal>
    </View>
  )
}

export default RelationshipLayers
