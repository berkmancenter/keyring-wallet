/**
 * A poll waiting for the member, as a card in Messages' Waiting for you stack (the Polls in Waiting for you mock): the
 * community and the closing date, Open, and Not now. Never the question, the title or which identity is the member's.
 * The look is the room offer card's (RoomOfferCardItem), so the two read as one stack. At large text the buttons go
 * under the words, so a long community name wraps rather than being cut.
 *
 * @module polls/components/PollWaitingCard
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { ROOM_MARK_FILL } from '../../rooms/components/RoomHeader'
import { communityLabelOf } from '../../trust-tasks/screens/communityName'
import { localDate } from '../../trust-tasks/screens/localTime'
import type { PollWaiting } from '../pollsWaiting'
import { isLargeText } from '../screens/Poll'

import { PollsIds } from './Polls.ids'

const CARD_BORDER = '#B99BBA'
const asWritten = { interpolation: { escapeValue: false } }

/** "Closes today", else "Closes <date>". */
export function closesText(
  t: (key: string, opts?: object) => string,
  votingClosesAt: string,
  now: number = Date.now()
): string {
  const close = new Date(votingClosesAt)
  const today = new Date(now)
  return close.toDateString() === today.toDateString()
    ? t('Polls.ClosesToday')
    : t('Polls.CardCloses', { date: localDate(votingClosesAt), ...asWritten })
}

export const PollWaitingCard: React.FC<{
  poll: PollWaiting
  onOpen: (poll: PollWaiting) => void
  onNotNow: (poll: PollWaiting) => void
}> = ({ poll, onOpen, onNotNow }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { fontScale } = useWindowDimensions()
  const large = isLargeText(fontScale)
  const community = communityLabelOf(poll.communityDid, t)
  const title = t('Polls.CardTitle', { community, ...asWritten }) as string
  const closes = closesText(t as never, poll.votingClosesAt)
  const styles = StyleSheet.create({
    card: {
      gap: large ? 10 : 6,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: large ? 10 : 6,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: CARD_BORDER,
      backgroundColor: ColorPalette.grayscale.white,
    },
    row: { flexDirection: 'row', alignItems: large ? 'flex-start' : 'center', gap: 12 },
    mark: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ROOM_MARK_FILL,
    },
    words: { flex: 1, minWidth: 0, gap: 1 },
    waiting: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: ColorPalette.brand.primary,
    },
    title: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: ColorPalette.brand.text },
    closes: { fontSize: 14, lineHeight: 19, color: ColorPalette.grayscale.mediumGrey },
    open: {
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    openText: { fontSize: 15, fontWeight: '700', color: ColorPalette.grayscale.white },
    notNow: { minHeight: 44, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
    notNowText: { fontSize: 14, fontWeight: '600', color: ColorPalette.brand.primary },
  })
  const open = (
    <TouchableOpacity
      style={styles.open}
      onPress={() => onOpen(poll)}
      accessibilityRole="button"
      accessibilityLabel={t('Polls.CardOpenLabel', { community, ...asWritten }) as string}
      testID={testIdWithKey(PollsIds.waitingCardOpen)}
    >
      <ThemedText style={styles.openText}>{t('Polls.CardOpen')}</ThemedText>
    </TouchableOpacity>
  )
  return (
    <View style={styles.card} testID={testIdWithKey(PollsIds.waitingCard)}>
      <View style={styles.row}>
        <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name="vote-outline" size={24} color={ColorPalette.brand.primary} />
        </View>
        <View style={styles.words}>
          <ThemedText style={styles.waiting}>{t('Polls.CardWaiting')}</ThemedText>
          <ThemedText
            style={styles.title}
            numberOfLines={large ? undefined : 1}
            testID={testIdWithKey(PollsIds.waitingCardTitle)}
          >
            {title}
          </ThemedText>
          <ThemedText style={styles.closes}>{closes}</ThemedText>
        </View>
        {large ? null : open}
      </View>
      {large ? open : null}
      <View style={{ alignItems: large ? 'center' : 'flex-end' }}>
        <Pressable
          style={styles.notNow}
          onPress={() => onNotNow(poll)}
          accessibilityRole="button"
          accessibilityLabel={t('Polls.CardNotNowLabel', { community, ...asWritten }) as string}
          testID={testIdWithKey(PollsIds.waitingCardNotNow)}
        >
          <ThemedText style={styles.notNowText}>{t('Global.NotNow')}</ThemedText>
        </Pressable>
      </View>
    </View>
  )
}

export default PollWaitingCard
