/**
 * The Polls section on a community's screen, for a member (Polls V2 mock, board 1): the community's polls beside its
 * Rooms and Directory, open ones first. It shows only when the community lists a poll, so a community that runs none,
 * or serves no polls at all, shows nothing here. A row opens the poll.
 *
 * An open poll the member hasn't voted in is a card of its own: a chip (Open, or Ticket ready once they hold one), the
 * time left with a bar, and what to do next. The rest are rows with a chip and a line: You voted, Closed early,
 * Counting the votes, Results. A poll the community certifies shows Results on the next read, with nothing for the
 * member to do: the list is read whenever the community's screen opens or is returned to.
 *
 * A row never says what the member chose.
 *
 * @module polls/components/CommunityPollsSection
 */
import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import {
  CommunityGroup,
  CommunityGroupDivider,
  CommunitySectionLabel,
} from '../../trust-tasks/screens/CommunitySection'
import { pollRowLook, pollTitle, timeLeft, votingElapsed } from '../pollWords'
import { useCommunityPolls } from '../usePolls'

import { PollChip } from './PollParts'
import { PollsIds } from './Polls.ids'

export const CommunityPollsSection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { polls } = useCommunityPolls(communityDid)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  if (!polls?.length) return null
  const now = Date.now()
  const rows = polls.map((p) => ({ ...p, look: pollRowLook(t, p.poll, p.record, now) }))
  const featured = rows.filter((r) => r.look.featured)
  const rest = rows.filter((r) => !r.look.featured)
  const open = (electionId: string) => go.navigate(Screens.Poll, { communityDid, electionId })
  const muted = { color: ColorPalette.grayscale.mediumGrey }

  return (
    <View style={{ gap: 8 }} testID={testIdWithKey(PollsIds.section)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <CommunitySectionLabel title={t('Polls.Polls')} count={polls.length} />
        {featured.length ? (
          <ThemedText variant="labelSubtitle" style={muted} testID={testIdWithKey(PollsIds.waiting)}>
            {t('Polls.WaitingForYou', { count: featured.length })}
          </ThemedText>
        ) : null}
      </View>
      {featured.map(({ poll, look }) => {
        const title = pollTitle(t, poll.title)
        const left = timeLeft(t, poll, now)
        return (
          <Pressable
            key={poll.electionId}
            style={{
              gap: 10,
              padding: 16,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: ColorPalette.brand.primary,
              backgroundColor: ColorPalette.brand.secondaryBackground,
            }}
            accessibilityRole="button"
            accessibilityLabel={[look.chip?.label, title, left, look.status, look.action].filter(Boolean).join(', ')}
            onPress={() => open(poll.electionId)}
            testID={testIdWithKey(PollsIds.row)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {look.chip ? (
                <PollChip label={look.chip.label} tone={look.chip.tone} testID={testIdWithKey(PollsIds.rowChip)} />
              ) : null}
              <ThemedText style={muted}>{left}</ThemedText>
            </View>
            <ThemedText variant="bold">{title}</ThemedText>
            <View
              style={{ height: 6, borderRadius: 3, backgroundColor: ColorPalette.grayscale.lightGrey }}
              testID={testIdWithKey(PollsIds.rowTimeBar)}
            >
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  width: `${Math.round(votingElapsed(poll, now) * 100)}%`,
                  backgroundColor: ColorPalette.brand.primary,
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <ThemedText style={[muted, { flexShrink: 1 }]} testID={testIdWithKey(PollsIds.rowStatus)}>
                {look.status}
              </ThemedText>
              <ThemedText variant="bold" style={{ color: ColorPalette.brand.primary }}>
                {`${look.action} ›`}
              </ThemedText>
            </View>
          </Pressable>
        )
      })}
      {rest.length ? (
        <CommunityGroup style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
          {rest.map(({ poll, look }, i) => {
            const title = pollTitle(t, poll.title)
            return (
              <View key={poll.electionId}>
                {i > 0 ? <CommunityGroupDivider /> : null}
                <Pressable
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={[title, look.chip?.label, look.status].filter(Boolean).join(', ')}
                  onPress={() => open(poll.electionId)}
                  testID={testIdWithKey(PollsIds.row)}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText variant="bold">{title}</ThemedText>
                    {look.status ? (
                      <ThemedText style={muted} testID={testIdWithKey(PollsIds.rowStatus)}>
                        {look.status}
                      </ThemedText>
                    ) : null}
                  </View>
                  {look.chip ? (
                    <PollChip label={look.chip.label} tone={look.chip.tone} testID={testIdWithKey(PollsIds.rowChip)} />
                  ) : null}
                  <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
                </Pressable>
              </View>
            )
          })}
        </CommunityGroup>
      ) : null}
    </View>
  )
}

export default CommunityPollsSection
