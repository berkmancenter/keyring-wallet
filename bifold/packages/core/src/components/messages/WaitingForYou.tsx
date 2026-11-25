/**
 * "Waiting for you" at the top of Messages: the room offers and the polls waiting for the member, as one stack
 * (community-polls-plan.md, "Where polls appear"; the Polls in Waiting for you mock). Soonest first, by each one's
 * date: a poll's close, an offer's room's end; offers with no date last, in the order they came. At most two cards,
 * then a row with how many more, which opens them all. All of them, or one community's under its chip; nothing at
 * all when none wait.
 *
 * Not now on a poll hides it on this phone (pollsWaiting.ts) and says so, with a tap to undo.
 *
 * @module components/messages/WaitingForYou
 */
import { useAgent } from '@bifold/react-hooks'
import type { Agent } from '@credo-ts/core'
import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../contexts/theme'
import { PollsIds } from '../../modules/polls/components/Polls.ids'
import { PollWaitingCard } from '../../modules/polls/components/PollWaitingCard'
import { dropVotedPolls, hidePollCard, usePollsWaiting, type PollWaiting } from '../../modules/polls/pollsWaiting'
import { usePollService } from '../../modules/polls/usePolls'
import { RoomOfferCardItem } from '../../modules/rooms/components/RoomOfferCard'
import type { RoomOffer } from '../../modules/rooms/types'
import { useRoomOffersWaiting } from '../../modules/rooms/useRoomOffersCount'
import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'
import { ToastType } from '../toast/BaseToast'

/** How many cards show before the rest fold into a count. */
export const WAITING_SHOWN = 2

export type WaitingItem = { kind: 'poll'; poll: PollWaiting } | { kind: 'offer'; offer: RoomOffer }

const dateOf = (item: WaitingItem): number | undefined => {
  const iso = item.kind === 'poll' ? item.poll.votingClosesAt : item.offer.validUntil
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : undefined
}

/** Soonest first by date; anything without one last, in the order it came. */
export function waitingOrder(items: readonly WaitingItem[]): WaitingItem[] {
  return items
    .map((item, i) => ({ item, i, at: dateOf(item) }))
    .sort((a, b) =>
      a.at !== undefined && b.at !== undefined
        ? a.at - b.at || a.i - b.i
        : a.at !== undefined
          ? -1
          : b.at !== undefined
            ? 1
            : a.i - b.i
    )
    .map(({ item }) => item)
}

export interface WaitingForYouProps {
  /** Only this community's (its chip); all when absent. */
  communityDid?: string
  onOpenOffer: (offerId: string) => void
  onOpenPoll: (poll: PollWaiting) => void
}

export const WaitingForYou: React.FC<WaitingForYouProps> = ({ communityDid, onOpenOffer, onOpenPoll }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const service = usePollService()
  const offers = useRoomOffersWaiting(communityDid)
  const polls = usePollsWaiting(communityDid)
  const [expanded, setExpanded] = useState(false)

  // A poll voted in since the last check leaves at once: from this phone's records, asking no one.
  useFocusEffect(
    useCallback(() => {
      if (service) void dropVotedPolls(service)
    }, [service])
  )

  const notNow = useCallback(
    async (poll: PollWaiting) => {
      if (!agent) return
      try {
        const { comesBack, undo } = await hidePollCard(agent as Agent, poll)
        Toast.show({
          type: ToastType.Info,
          text1: t(comesBack ? 'Polls.CardHidden' : 'Polls.CardHiddenUntilClose') as string,
          text2: t('Polls.CardTapToUndo') as string,
          onPress: () => {
            Toast.hide()
            void undo()
          },
        })
      } catch {
        Toast.show({ type: ToastType.Error, text1: t('Polls.CardHideFailed') as string })
      }
    },
    [agent, t]
  )

  const items = waitingOrder([
    ...polls.map((poll) => ({ kind: 'poll' as const, poll })),
    ...offers.map((offer) => ({ kind: 'offer' as const, offer })),
  ])
  if (items.length === 0) return null
  const more = items.length - WAITING_SHOWN
  const shown = expanded || more <= 0 ? items : items.slice(0, WAITING_SHOWN)
  const styles = StyleSheet.create({
    list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, gap: 8 },
    fold: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    foldText: { fontSize: 15, fontWeight: '700', color: ColorPalette.brand.primary },
  })
  return (
    <View style={styles.list} testID={testIdWithKey(PollsIds.waitingStack)}>
      {shown.map((item) =>
        item.kind === 'poll' ? (
          <PollWaitingCard
            key={`poll ${item.poll.communityDid} ${item.poll.electionId}`}
            poll={item.poll}
            onOpen={onOpenPoll}
            onNotNow={notNow}
          />
        ) : (
          <RoomOfferCardItem key={`offer ${item.offer.offerId}`} offer={item.offer} onOpen={onOpenOffer} />
        )
      )}
      {more > 0 ? (
        <Pressable
          style={styles.fold}
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          testID={testIdWithKey(PollsIds.waitingFold)}
        >
          <ThemedText style={styles.foldText}>
            {expanded ? t('Polls.WaitingShowFewer') : t('Polls.WaitingMore', { count: more })}
          </ThemedText>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={ColorPalette.brand.primary} />
        </Pressable>
      ) : null}
    </View>
  )
}

export default WaitingForYou
