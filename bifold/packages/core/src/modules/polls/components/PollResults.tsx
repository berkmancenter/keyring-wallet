/**
 * A poll's certified result (Polls V2 mock, board 8): how many votes were counted, then each option's count and share
 * beside its bar, most votes first, so colour doesn't carry it; how many left a question unanswered; and when the
 * community certified it. Nothing marks the member's own choice, which the phone doesn't keep. Only the community's
 * certified result is shown, read from `vtc/elections/show`, never a live count. Shares are worked out here from the
 * counts, which are all the result carries.
 *
 * @module polls/components/PollResults
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { localDateTime } from '../../trust-tasks/screens/localTime'
import type { Certification, Manifest, Question } from '../pollTasks'

import { PollsIds } from './Polls.ids'

const optionText = (q: Question, key: string) =>
  (q.type === 'text' ? undefined : q.options.find((o) => o.key === key)?.text?.trim()) || key

/** A question's options by count, most first; ties keep the poll's own order. */
export function rankedCounts(q: Question, counts: Record<string, number>): [string, number][] {
  const order = q.type === 'text' ? [] : q.options.map((o) => o.key)
  const at = (key: string) => {
    const i = order.indexOf(key)
    return i < 0 ? order.length : i
  }
  return Object.entries(counts).sort(([a, x], [b, y]) => y - x || at(a) - at(b))
}

export const PollResults: React.FC<{ manifest: Manifest; certification: Certification; voted: boolean }> = ({
  manifest,
  certification,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { result } = certification
  const card = { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 14, padding: 16, gap: 14 }
  const muted = { color: ColorPalette.grayscale.mediumGrey }
  const single = manifest.questions.length === 1
  const firstAbstained = single ? (result.questions[0]?.abstained ?? 0) : 0
  return (
    <View style={card} testID={testIdWithKey(PollsIds.results)}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <ThemedText variant="bold" accessibilityRole="header" testID={testIdWithKey(PollsIds.votesCounted)}>
          {t('Polls.VotesCount', { count: result.ballotsCounted })}
        </ThemedText>
        {firstAbstained > 0 ? (
          <ThemedText style={[muted, { flexShrink: 1, textAlign: 'right' }]}>
            {t('Polls.Abstained', { count: firstAbstained })}
          </ThemedText>
        ) : null}
      </View>
      {result.questions.map((row) => {
        const q = manifest.questions.find((x) => x.key === row.question)
        if (!q) return null
        const counts = row.choice ? rankedCounts(q, row.choice) : []
        const total = counts.reduce((sum, [, n]) => sum + n, 0)
        const top = counts[0]?.[1] ?? 0
        return (
          <View key={row.question} style={{ gap: 12 }}>
            {single ? null : <ThemedText variant="bold">{q.text?.trim() || q.key}</ThemedText>}
            {counts.map(([key, n]) => {
              const percent = total > 0 ? Math.round((n / total) * 100) : 0
              const leads = n > 0 && n === top
              return (
                <View
                  key={key}
                  style={{ gap: 6 }}
                  accessible
                  accessibilityLabel={`${optionText(q, key)}, ${n}, ${percent}%`}
                  testID={testIdWithKey(PollsIds.resultOption)}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <ThemedText variant={leads ? 'bold' : 'normal'} style={{ flex: 1 }}>
                      {optionText(q, key)}
                    </ThemedText>
                    <ThemedText variant={leads ? 'bold' : 'normal'}>
                      {t('Polls.OptionCount', { count: n, percent })}
                    </ThemedText>
                  </View>
                  <View style={{ height: 12, borderRadius: 6, backgroundColor: ColorPalette.grayscale.veryLightGrey }}>
                    <View
                      style={{
                        height: 12,
                        borderRadius: 6,
                        width: `${percent}%`,
                        backgroundColor: leads ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey,
                      }}
                    />
                  </View>
                </View>
              )
            })}
            {q.type === 'text' ? (
              <ThemedText style={muted}>
                {row.withheld ? t('Polls.TextWithheld') : t('Polls.TextAnswers', { count: row.text?.length ?? 0 })}
              </ThemedText>
            ) : null}
            {!single && row.abstained > 0 ? (
              <ThemedText style={muted}>{t('Polls.Abstained', { count: row.abstained })}</ThemedText>
            ) : null}
          </View>
        )
      })}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          borderTopWidth: 1,
          borderTopColor: ColorPalette.grayscale.lightGrey,
          paddingTop: 12,
        }}
        testID={testIdWithKey(PollsIds.certifiedLine)}
      >
        <Icon name="shield-check-outline" size={22} color={ColorPalette.semantic.success} />
        <ThemedText style={{ flex: 1 }}>
          {t('Polls.CertifiedOn', {
            date: localDateTime(certification.certifiedAt),
            interpolation: { escapeValue: false },
          })}
        </ThemedText>
      </View>
    </View>
  )
}

export default PollResults
