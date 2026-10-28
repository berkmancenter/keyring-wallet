/**
 * A room as a conversation (rooms member sprint, RoomView): its posts newest first, a day pill above each day's
 * posts, "Load older" at the end, and pull to refresh, since nothing pushes a post to a phone yet. Above the posts,
 * the room's name and tier and who the member posts as; and a warning when the member's agent found the host's
 * answer inconsistent (records dropped or replayed).
 *
 * A post's words are its chat message, or the record as it was written: inert either way, never followed. Below the
 * posts, the composer: a post shows at once as sending, and stays, marked, if it could not be sent. Where the member
 * may not post, the composer gives the reason instead. A post's files show as chips; a tap opens the attachment sheet
 * (download, then share). Sending a file comes in a later step. Reached only while the rooms flag is on.
 *
 * @module rooms/screens/Room
 */
import { useHeaderHeight } from '@react-navigation/elements'
import { useRoute } from '@react-navigation/native'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { DayPill } from '../../../components/chat/DayPill'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { localDayKey } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import { RoomComposer } from '../components/RoomComposer'
import { RoomFileSheet } from '../components/RoomFileSheet'
import { RoomPostBubble } from '../components/RoomPostBubble'
import { roomTitle } from '../components/RoomRow'
import { roomsStatusText } from '../components/roomsStatusText'
import { identityText } from '../components/roomWords'
import { SampleDataBanner } from '../components/SampleDataBanner'
import TierBadge from '../components/TierBadge'
import { toInertText } from '../inertText'
import type { RoomPost } from '../roomPosts'
import type { RoomFile } from '../types'
import { useRoom } from '../useRoom'
import { POSTS_PAGE, useRoomPosts } from '../useRoomPosts'
import { type PendingPost, useRoomSend } from '../useRoomSend'
import { useRoomsService } from '../useRoomsService'

type Item = { kind: 'day'; key: string; date: Date } | { kind: 'post'; key: string; post: RoomPost }

/** Posts newest first, each day's posts led by that day's pill. Posts with no time take no pill. */
export const withDayPills = (posts: RoomPost[]): Item[] => {
  const items: Item[] = []
  let day: string | undefined
  for (const post of posts) {
    const key = post.at ? localDayKey(post.at) : undefined
    if (post.at && key && key !== day) items.push({ kind: 'day', key: `day-${key}`, date: post.at })
    if (key) day = key
    items.push({ kind: 'post', key: `post-${post.key}-${post.version}`, post })
  }
  return items
}

/** A post on its way, drawn as the member's own until the room's list carries it. */
export const pendingAsPost = (pending: PendingPost, actingAs: RoomPost['author']): RoomPost => ({
  key: pending.localId,
  version: 0,
  author: actingAs,
  byAgent: false,
  mine: true,
  at: pending.at,
  text: toInertText(pending.text),
  isChatMessage: true,
  retracted: false,
  unread: false,
  delivery: pending.state === 'sent' ? undefined : pending.state,
  files: [],
})

const Room: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const roomId = (useRoute()?.params as { roomId?: string } | undefined)?.roomId ?? ''
  const service = useRoomsService()
  // The keyboard rises from the screen's bottom, under a navigation header: offset by the header, as the chat does.
  const headerHeight = useHeaderHeight()
  const state = useRoom(service, roomId)
  const { room, roomCapabilities } = state
  const canList = roomCapabilities?.listNotes.status === 'available'
  const feed = useRoomPosts(service, roomId, room?.actingAs, !!room && canList)
  const outbox = useRoomSend(service, roomId, feed.refresh)
  const [openedFile, setOpenedFile] = useState<RoomFile>()
  const canOpenFiles = roomCapabilities?.openFile.status === 'available'
  const { settle } = outbox
  // A sent post leaves the outbox once the room's own list shows it.
  useEffect(() => {
    if (feed.posts) settle(new Set(feed.posts.map((p) => p.key)))
  }, [feed.posts, settle])
  const pendingPosts = useMemo(
    () => outbox.pending.map((p) => pendingAsPost(p, room?.actingAs)),
    [outbox.pending, room?.actingAs]
  )
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    header: { paddingHorizontal: 16, paddingVertical: 10, gap: 4 },
    list: { paddingHorizontal: 12, paddingBottom: 16, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    centered: { padding: 16, gap: 8 },
    warn: {
      flexDirection: 'row',
      gap: 10,
      marginHorizontal: 16,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      backgroundColor: ColorPalette.notification.warn,
      borderColor: ColorPalette.notification.warnBorder,
    },
    warnText: { flex: 1, color: ColorPalette.notification.warnText },
    idName: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) },
  })

  if (!service)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
        <ThemedText style={styles.centered} testID={testIdWithKey('RoomsOff')}>
          {t('Rooms.Off')}
        </ThemedText>
      </SafeAreaView>
    )

  if (!room || !roomCapabilities)
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomScreen')}>
        <SampleDataBanner service={service} />
        {state.failed ? (
          <View style={styles.centered}>
            <ThemedText testID={testIdWithKey('RoomReadFailed')}>{t('Rooms.AgentUnknown')}</ThemedText>
            <Button
              title={t('Rooms.TryAgain')}
              buttonType={ButtonType.Secondary}
              onPress={state.reload}
              testID={testIdWithKey('RoomTryAgain')}
            />
          </View>
        ) : (
          <ActivityIndicator
            style={styles.centered}
            color={ColorPalette.brand.primary}
            testID={testIdWithKey('RoomReading')}
          />
        )}
      </SafeAreaView>
    )

  const unavailable = roomsStatusText(t, roomCapabilities.listNotes, 'listNotes')
  const cannotPost = roomsStatusText(t, roomCapabilities.write, 'write')
  const items = feed.posts || pendingPosts.length ? withDayPills([...pendingPosts, ...(feed.posts ?? [])]) : []

  const empty = unavailable ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomPostsUnavailable')}>
      {unavailable}
    </ThemedText>
  ) : feed.failed && !feed.posts ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomPostsFailed')}>
      {t('Rooms.PostsFailed')}
    </ThemedText>
  ) : feed.posts ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomPostsNone')}>
      {t('Rooms.PostsNone')}
    </ThemedText>
  ) : (
    <ActivityIndicator
      style={styles.centered}
      color={ColorPalette.brand.primary}
      testID={testIdWithKey('RoomPostsReading')}
    />
  )

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomScreen')}>
      <SampleDataBanner service={service} />
      <View style={styles.header} testID={testIdWithKey('RoomHeader')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ThemedText
            variant="headingFour"
            style={room.nameFrom === 'roomId' ? styles.idName : undefined}
            testID={testIdWithKey('RoomTitle')}
          >
            {roomTitle(t, room)}
          </ThemedText>
          <TierBadge tier={room.tier} />
        </View>
        <ThemedText style={styles.muted} testID={testIdWithKey('RoomActingAs')}>
          {[
            room.communityName,
            t('Rooms.ActingAs', { who: identityText(room.actingAs), interpolation: { escapeValue: false } }) as string,
          ]
            .filter(Boolean)
            .join(' · ')}
        </ThemedText>
      </View>
      {feed.check?.verdict === 'conflict' ? (
        <View style={styles.warn} accessibilityRole="alert" testID={testIdWithKey('RoomHostConflict')}>
          <Icon name="alert-outline" size={22} color={ColorPalette.notification.warnText} />
          <ThemedText style={styles.warnText}>{t('Rooms.HostConflict')}</ThemedText>
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          testID={testIdWithKey('RoomPosts')}
          data={unavailable ? [] : items}
          keyExtractor={(item) => item.key}
          // A page is small (POSTS_PAGE posts and their day pills): draw it whole, so "Load older" sits under it.
          initialNumToRender={POSTS_PAGE * 2}
          contentContainerStyle={styles.list}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <DayPill date={item.date} />
            ) : (
              <RoomPostBubble
                post={item.post}
                onRetry={item.post.delivery === 'failed' ? () => outbox.retry(item.post.key) : undefined}
                onOpenFile={canOpenFiles ? setOpenedFile : undefined}
              />
            )
          }
          ListEmptyComponent={empty}
          refreshControl={
            unavailable ? undefined : (
              <RefreshControl
                refreshing={feed.refreshing}
                onRefresh={feed.refresh}
                tintColor={ColorPalette.brand.primary}
              />
            )
          }
          ListFooterComponent={
            feed.hasOlder ? (
              <Button
                title={t('Rooms.LoadOlder')}
                buttonType={ButtonType.Secondary}
                onPress={feed.loadOlder}
                disabled={feed.loadingOlder}
                testID={testIdWithKey('RoomLoadOlder')}
              />
            ) : feed.incomplete ? (
              <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomPostsIncomplete')}>
                {t('Rooms.NotesIncomplete')}
              </ThemedText>
            ) : null
          }
        />
        {unavailable ? null : (
          <RoomComposer onSend={outbox.send} unavailable={cannotPost} postingAs={identityText(room.actingAs)} />
        )}
      </KeyboardAvoidingView>
      <RoomFileSheet service={service} roomId={roomId} file={openedFile} onClose={() => setOpenedFile(undefined)} />
    </SafeAreaView>
  )
}

export default Room
