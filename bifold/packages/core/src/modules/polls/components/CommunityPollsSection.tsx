/**
 * The Polls section on a community's screen, for a member (Community Polls mock, A): the community's polls beside its
 * Rooms and Directory, open ones first. It shows only when the community lists a poll, so a community that runs none,
 * or serves no polls at all, shows nothing here. A row opens the poll.
 *
 * A row never says what the member chose, or whether they hold a ticket: only whether the poll is open, and whether
 * they voted.
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
import { pollPhase, pollRowStatus, pollTitle } from '../pollWords'
import { useCommunityPolls } from '../usePolls'

import { PollsIds } from './Polls.ids'

export const CommunityPollsSection: React.FC<{ communityDid: string }> = ({ communityDid }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { polls } = useCommunityPolls(communityDid)
  const go = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  if (!polls?.length) return null
  const now = Date.now()
  return (
    <View style={{ gap: 6 }} testID={testIdWithKey(PollsIds.section)}>
      <CommunitySectionLabel title={t('Polls.Polls')} count={polls.length} />
      <CommunityGroup style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
        {polls.map(({ poll, record }, i) => {
          const title = pollTitle(t, poll.title)
          const status = pollRowStatus(t, poll, record, now)
          const phase = pollPhase(poll, record, now)
          return (
            <View key={poll.electionId}>
              {i > 0 ? <CommunityGroupDivider /> : null}
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${status}`}
                onPress={() => go.navigate(Screens.Poll, { communityDid, electionId: poll.electionId })}
                testID={testIdWithKey(PollsIds.row)}
              >
                <Icon
                  name={phase === 'voted' ? 'check-circle-outline' : 'vote-outline'}
                  size={24}
                  color={phase === 'voted' ? ColorPalette.semantic.success : ColorPalette.brand.primary}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText variant="bold">{title}</ThemedText>
                  <ThemedText
                    style={{ color: ColorPalette.grayscale.mediumGrey }}
                    testID={testIdWithKey(PollsIds.rowStatus)}
                  >
                    {status}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={24} color={ColorPalette.grayscale.mediumGrey} />
              </Pressable>
            </View>
          )
        })}
      </CommunityGroup>
    </View>
  )
}

export default CommunityPollsSection
