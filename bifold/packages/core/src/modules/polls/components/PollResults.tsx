/**
 * A poll's certified result (Community Polls mock, Results): numbers beside the bars, so colour doesn't carry it, and
 * nothing marks the member's own choice, which the phone doesn't keep. Only the community's certified result is shown,
 * read from `vtc/elections/show`, never a live count.
 *
 * @module polls/components/PollResults
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { localDateTime } from '../../trust-tasks/screens/localTime'
import type { Certification, Manifest, Question } from '../pollTasks'

import { PollsIds } from './Polls.ids'

const optionText = (q: Question, key: string) =>
  (q.type === 'text' ? undefined : q.options.find((o) => o.key === key)?.text?.trim()) || key

export const PollResults: React.FC<{ manifest: Manifest; certification: Certification; voted: boolean }> = ({
  manifest,
  certification,
  voted,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { result } = certification
  const card = { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 10 }
  const muted = { color: ColorPalette.grayscale.mediumGrey }
  return (
    <View style={card} testID={testIdWithKey(PollsIds.results)}>
      <ThemedText variant="bold" accessibilityRole="header">
        {t('Polls.Results')}
      </ThemedText>
      <ThemedText style={muted}>
        {`${t('Polls.ClosedOn', { date: localDateTime(manifest.votingClosesAt), interpolation: { escapeValue: false } })} · ${t('Polls.VotesCount', { count: result.ballotsCounted })}`}
      </ThemedText>
      {result.questions.map((row) => {
        const q = manifest.questions.find((x) => x.key === row.question)
        if (!q) return null
        const counts = row.choice ? Object.entries(row.choice) : []
        const total = counts.reduce((sum, [, n]) => sum + n, 0)
        return (
          <View key={row.question} style={{ gap: 8 }}>
            {manifest.questions.length > 1 ? <ThemedText variant="bold">{q.text?.trim() || q.key}</ThemedText> : null}
            {counts.map(([key, n]) => {
              const percent = total > 0 ? Math.round((n / total) * 100) : 0
              return (
                <View
                  key={key}
                  style={{ gap: 4 }}
                  accessible
                  accessibilityLabel={`${optionText(q, key)}, ${n}, ${percent}%`}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <ThemedText style={{ flex: 1 }}>{optionText(q, key)}</ThemedText>
                    <ThemedText>{t('Polls.OptionCount', { count: n, percent })}</ThemedText>
                  </View>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: ColorPalette.grayscale.lightGrey }}>
                    <View
                      style={{
                        height: 8,
                        borderRadius: 4,
                        width: `${percent}%`,
                        backgroundColor: ColorPalette.brand.primary,
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
            {row.abstained > 0 ? (
              <ThemedText style={muted}>{t('Polls.Abstained', { count: row.abstained })}</ThemedText>
            ) : null}
          </View>
        )
      })}
      <ThemedText style={muted}>{t('Polls.Certified')}</ThemedText>
      {voted ? <ThemedText>{t('Polls.CantShowYours')}</ThemedText> : null}
    </View>
  )
}

export default PollResults
