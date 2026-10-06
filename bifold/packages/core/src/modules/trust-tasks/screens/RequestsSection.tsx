/**
 * Requests, on "Your agent" itself (Alberto, 10-06): what waits for this
 * person's decision on the current agent, always in view, never folded under
 * Agent settings. Each request is a row that opens Requests, where it is
 * decided; with nothing waiting the section says so, and offers "Ask me
 * before…" — requests arrive only for what the agent has a rule on.
 *
 * Test ids: `AgentRequestsRow` (the section's heading row, opening Requests)
 * with `AgentRequestsRowCount`; `AgentApprovalBanner` on the first waiting
 * request, the id the banner it replaces had; `AgentRequestsItem_<i>` per row;
 * `AgentAskMeRow` for "Ask me before…".
 *
 * @module trust-tasks/screens/RequestsSection
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { VtiApproval } from '../module/vtaAgent'

import { partyLabelStartOf } from './communityName'
import { shortTask } from './RequestCard'

/** How many waiting requests the section lists before "See all". */
export const REQUESTS_SHOWN = 3

export interface RequestsSectionProps {
  waiting: VtiApproval[]
  onOpen: () => void
  onAskMe: () => void
}

export const RequestsSection: React.FC<RequestsSectionProps> = ({ waiting, onOpen, onAskMe }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const styles = StyleSheet.create({
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 8, padding: 16, gap: 4 },
    attention: { borderLeftWidth: 4, borderLeftColor: ColorPalette.brand.primary },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    link: { color: ColorPalette.brand.link, textDecorationLine: 'underline' },
    badge: {
      minWidth: 24,
      height: 24,
      borderRadius: 12,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.semantic.error,
    },
    badgeText: { color: ColorPalette.grayscale.white, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  })
  const shown = waiting.slice(0, REQUESTS_SHOWN)
  return (
    <View
      style={[styles.card, waiting.length > 0 ? styles.attention : undefined]}
      testID={testIdWithKey('AgentRequests')}
    >
      <Pressable
        style={styles.row}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${t('Requests.Row')}, ${
          waiting.length > 0 ? t('Requests.RowWaiting', { count: waiting.length }) : t('Requests.RowNone')
        }`}
        testID={testIdWithKey('AgentRequestsRow')}
      >
        <Icon
          name={waiting.length > 0 ? 'bell-ring-outline' : 'bell-outline'}
          size={22}
          color={ColorPalette.brand.primary}
        />
        <View style={{ flex: 1 }}>
          <ThemedText variant="labelTitle" accessibilityRole="header">
            {t('Requests.Row')}
          </ThemedText>
          <ThemedText style={styles.muted} testID={testIdWithKey('AgentRequestsRowCount')}>
            {waiting.length > 0 ? t('Requests.RowWaiting', { count: waiting.length }) : t('Requests.RowNone')}
          </ThemedText>
        </View>
        {waiting.length > 0 ? (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText}>{waiting.length > 99 ? '99+' : String(waiting.length)}</ThemedText>
          </View>
        ) : null}
        <Icon name="chevron-right" size={22} color={ColorPalette.grayscale.mediumGrey} />
      </Pressable>
      {shown.map((approval, i) => (
        <Pressable
          key={approval.id}
          style={styles.row}
          onPress={onOpen}
          accessibilityRole="button"
          testID={testIdWithKey(i === 0 ? 'AgentApprovalBanner' : `AgentRequestsItem_${i}`)}
        >
          <View style={{ width: 22 }} />
          <ThemedText style={{ flex: 1, ...TextTheme.normal }} numberOfLines={2}>
            {t('MyAgent.ApprovalAsks', {
              requester: partyLabelStartOf(approval.requester, t),
              task: shortTask(approval.taskType),
              interpolation: { escapeValue: false },
            })}
          </ThemedText>
          <ThemedText style={{ color: ColorPalette.brand.link }}>{t('VtaLink.RequestDecide')}</ThemedText>
        </Pressable>
      ))}
      {waiting.length > REQUESTS_SHOWN ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="link"
          style={styles.row}
          testID={testIdWithKey('AgentRequestsAll')}
        >
          <View style={{ width: 22 }} />
          <ThemedText style={styles.link}>{t('VtaLink.RequestsSeeAll', { count: waiting.length })}</ThemedText>
        </Pressable>
      ) : null}
      {/* Requests arrive only for what the agent has a rule on. */}
      <Pressable onPress={onAskMe} accessibilityRole="link" style={styles.row} testID={testIdWithKey('AgentAskMeRow')}>
        <View style={{ width: 22 }} />
        <ThemedText style={styles.link}>{t('Requests.AskMeRow')}</ThemedText>
      </Pressable>
    </View>
  )
}

export default RequestsSection
