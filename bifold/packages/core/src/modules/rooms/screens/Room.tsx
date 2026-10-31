/**
 * A room as a conversation (rooms member sprint, RoomView), read as the person-to-person chat reads: newest at the
 * bottom, where it opens, a day pill above each day's posts, and "Load older" at the top. Nothing pushes a post to a
 * phone, so while the room is in view and the app in the foreground, new posts are asked for every few seconds
 * (`useRoomPosts`); one arrives at the bottom, in view only if the member is there already. Sending goes to the
 * bottom, as the person-to-person chat does. Pull to refresh is offered while there are no posts to show; with posts,
 * a poll that fails says "Couldn't refresh · Try again" at the bottom until one succeeds. Above the posts,
 * the room's name and tier and who the member posts as; and a warning when the member's agent found the host's
 * answer inconsistent (records dropped or replayed).
 *
 * A post's words are its chat message, or the record as it was written: inert either way, never followed. Below the
 * posts, the composer: a post shows at once as sending, and stays, marked, if it could not be sent. Where the member
 * may not post, the composer gives the reason instead. A post's files show as chips; a tap opens the attachment sheet
 * (download, then share), and "+" posts one.
 *
 * The screen is the chat alone (rooms in Messages, R2, chat B). The header opens the room's details (RoomInfo), and
 * from there its files, its notes (titled records and the markers of removed ones, which the chat leaves out) and its
 * members, each a screen of its own. The files' "Add a file" comes back here with `attach`, and the composer's "+"
 * opens. Reached only while the rooms flag is on.
 *
 * @module rooms/screens/Room
 */
import { useAgent } from '@bifold/react-hooks'
import { useHeaderHeight } from '@react-navigation/elements'
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Animated, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { DayPill } from '../../../components/chat/DayPill'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { useMeasuredKeyboardOffset } from '../../trust-tasks/screens/keyboardOffset'
import { localDayKey } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import { RoomComposer } from '../components/RoomComposer'
import { RoomFileSheet } from '../components/RoomFileSheet'
import { useFloatingDay } from '../components/useFloatingDay'
import { isComingSoon, RoomFeatureCard } from '../components/RoomFeatureCard'
import { RoomHeader } from '../components/RoomHeader'
import { RoomIdentitySheet } from '../components/RoomIdentitySheet'
import { useDirectoryNames, useDirectoryService } from '../../directory/useDirectory'
import { PetnamesProvider } from '../components/memberWords'
import { RoomPostBubble } from '../components/RoomPostBubble'
import { roomTitle } from '../components/RoomRow'
import { roomsStatusText } from '../components/roomsStatusText'
import { SampleDataBanner } from '../components/SampleDataBanner'
import { toInertText } from '../inertText'
import { isChatPost, type RoomPost } from '../roomPosts'
import { openInMyAgent } from '../roomLinks'
import type { Identity, RoomFile } from '../types'
import { useMyName } from '../useMyName'
import { usePetnames } from '../usePetname'
import { useInViewAndActive } from '../useInViewAndActive'
import { type RoomListing, useRoom } from '../useRoom'
import { POSTS_PAGE, ROOM_POLL_MS, useRoomPosts } from '../useRoomPosts'
import { markRoomSeen } from '../useRoomRows'
import { useRoomDraft } from '../useRoomDraft'
import { type PendingPost, useRoomSend } from '../useRoomSend'
import { useRoomsService } from '../useRoomsService'

const NO_LISTINGS: readonly RoomListing[] = []

type Item = { kind: 'day'; key: string; date: Date } | { kind: 'post'; key: string; post: RoomPost }

/**
 * Posts newest first, for a list drawn from the bottom up (`inverted`, as the person-to-person chat's): each day's
 * pill comes after that day's posts, so it shows above them. Posts with no time take no pill.
 */
export const withDayPills = (posts: RoomPost[]): Item[] => {
  const items: Item[] = []
  let day: { key: string; date: Date } | undefined
  const pill = (d: { key: string; date: Date }): Item => ({ kind: 'day', key: `day-${d.key}`, date: d.date })
  for (const post of posts) {
    const key = post.at ? localDayKey(post.at) : undefined
    if (post.at && key && key !== day?.key) {
      if (day) items.push(pill(day))
      day = { key, date: post.at }
    }
    items.push({ kind: 'post', key: `post-${post.key}-${post.version}`, post })
  }
  if (day) items.push(pill(day))
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
  pinned: false,
  unread: false,
  delivery: pending.state === 'sent' ? undefined : pending.state,
  files: pending.file
    ? [
        {
          fileId: pending.localId,
          name: toInertText(pending.file.name),
          mediaType: pending.file.mimeType,
          size: pending.file.size,
        },
      ]
    : [],
  progress:
    pending.state === 'sending' && pending.progress && pending.progress.total > 0
      ? Math.min(1, pending.progress.sent / pending.progress.total)
      : undefined,
})

const Room: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const params = useRoute()?.params as { roomId?: string; attach?: number } | undefined
  const roomId = params?.roomId ?? ''
  const navigation = useNavigation() as unknown as { navigate: (name: string, params: object) => void }
  const service = useRoomsService()
  // The composer rides above the keyboard. The view's offset is where its parent starts on screen, measured: on iOS 26
  // the header height a screen is told is the status bar alone, and the composer stayed under the keyboard.
  const headerHeight = useHeaderHeight()
  const keyboard = useMeasuredKeyboardOffset(headerHeight)
  // The chat lists no files or notes of its own: its posts are the feed's, and the other parts have their screens.
  const state = useRoom(service, roomId, NO_LISTINGS)
  const { room, roomCapabilities } = state
  const canList = roomCapabilities?.listNotes.status === 'available'
  const inView = useInViewAndActive()
  // The chat draws its posts and not the room's notes: a page is counted in chat posts.
  const feed = useRoomPosts(service, roomId, room?.actingAs, !!room && canList, inView, isChatPost)
  // On screen, a post that fails is marked in the list; away from it, a notice says so (useRoomNotices).
  const outbox = useRoomSend(service, roomId, feed.refresh, {
    onScreen: inView,
    roomName: room ? roomTitle(t, room) : undefined,
  })
  // The post being written is kept per room (useRoomDraft), so it comes back with the room after an inactivity lock.
  const { agent } = useAgent()
  const draft = useRoomDraft(agent, roomId)
  const [openedFile, setOpenedFile] = useState<RoomFile>()
  // Whose sheet is open: the member's own, from the composer, or another member's, from their name.
  const [sheetFor, setSheetFor] = useState<Identity>()
  const me = useMyName(room?.communityDid)
  // The member's own names for the community's members, read once for every label on this screen.
  const petnames = usePetnames(room?.communityDid)
  // The names other authors wrote on their own directory cards, where they show them to members.
  const directory = useDirectoryService()
  const authors = useMemo(
    () => (feed.posts ?? []).flatMap((p) => (!p.mine && p.author ? [p.author.did] : [])),
    [feed.posts]
  )
  const directoryNames = useDirectoryNames(directory, room?.communityDid, authors)
  const { reload } = state
  // A room that could not be read is read again while it is in view, at the posts' pace: nothing else reads it (the
  // posts poll waits for the room). useRoom reads it again the moment the agent's session opens; this is the fallback
  // for a read that failed with nothing to wait for (#772, 10-30). Once per failed read, never while one is out: the
  // agent's client sends one task at a time, and reads piled up behind a slow one would hold a post behind them.
  const readFailed = state.failed && !room
  useEffect(() => {
    if (!readFailed || !inView || state.reading) return
    const timer = setTimeout(reload, ROOM_POLL_MS)
    return () => clearTimeout(timer)
  }, [readFailed, inView, state.reading, reload])
  const canOpenFiles = roomCapabilities?.openFile.status === 'available'
  const { settle } = outbox
  // A sent post leaves the outbox once the room's own list shows it.
  useEffect(() => {
    if (feed.posts) settle(new Set(feed.posts.map((p) => p.key)))
  }, [feed.posts, settle])
  // What the member has on screen is seen: Messages counts only the posts after it (rooms in Messages, R1).
  useEffect(() => {
    if (inView && feed.posts?.length) markRoomSeen(service, roomId, Math.max(...feed.posts.map((p) => p.version)))
  }, [inView, feed.posts, service, roomId])
  const pendingPosts = useMemo(
    () => outbox.pending.map((p) => pendingAsPost(p, room?.actingAs)),
    [outbox.pending, room?.actingAs]
  )
  // The list is drawn from the bottom up, so offset 0 is the newest post: a post just sent shows there.
  const list = useRef<FlatList<Item>>(null)
  // The day of the posts at the top of the screen, floated while the member scrolls (as the person-to-person chat's).
  const floating = useFloatingDay()
  const { send: outboxSend } = outbox
  const send = useCallback(
    (text: string, file?: Parameters<typeof outboxSend>[1]) => {
      const sending = outboxSend(text, file)
      if (sending) list.current?.scrollToOffset({ offset: 0, animated: true })
      return sending
    },
    [outboxSend]
  )
  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    list: { paddingHorizontal: 12, paddingBottom: 16, gap: 2 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    centered: { padding: 16, gap: 8 },
    floatingDay: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
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
    pollFailed: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 6, paddingVertical: 8 },
    tryAgain: { color: ColorPalette.brand.primary, fontWeight: 'bold' },
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
        {state.unreachable ? (
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
  // A file is posted from the composer, so "Add a file" is offered only where the composer can attach one: where the
  // room's files are listed, and can be opened, since posting seals the file with the cipher that opens one (a room
  // whose files are only listed offers no "+": the service would refuse the post).
  const canAttach =
    roomCapabilities.listFiles.status === 'available' && roomCapabilities.openFile.status === 'available'
  // Titled records and removed ones are the room's notes, on their own screen; the chat shows the rest.
  const chatPosts = feed.posts?.filter(isChatPost)
  const items = chatPosts || pendingPosts.length ? withDayPills([...pendingPosts, ...(chatPosts ?? [])]) : []
  const shown = unavailable ? [] : items

  const empty = isComingSoon(roomCapabilities.listNotes) ? (
    <RoomFeatureCard status={roomCapabilities.listNotes} feature="notes" />
  ) : unavailable ? (
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
    <PetnamesProvider names={petnames} directoryNames={directoryNames}>
      <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']} testID={testIdWithKey('RoomScreen')}>
        <SampleDataBanner service={service} />
        <RoomHeader room={room} onPress={() => navigation.navigate(Screens.RoomInfo, { roomId })} />
        {feed.check?.verdict === 'conflict' ? (
          <View style={styles.warn} accessibilityRole="alert" testID={testIdWithKey('RoomHostConflict')}>
            <Icon name="alert-outline" size={22} color={ColorPalette.notification.warnText} />
            <ThemedText style={styles.warnText}>{t('Rooms.HostConflict')}</ThemedText>
          </View>
        ) : null}
        {/* keyboard-controller's view, which lifts on Android too: the app draws under the system bars there. */}
        <KeyboardAvoidingView
          ref={keyboard.ref}
          onLayout={keyboard.onLayout}
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={keyboard.offset}
        >
          <FlatList
            ref={list}
            testID={testIdWithKey('RoomPosts')}
            data={shown}
            keyExtractor={(item) => item.key}
            // Newest at the bottom, as the person-to-person chat (gifted-chat's list is inverted too). Only with posts:
            // an empty list's message reads from the top.
            inverted={shown.length > 0}
            // A page is small (POSTS_PAGE posts and their day pills): draw it whole, so "Load older" sits above it.
            initialNumToRender={POSTS_PAGE * 2}
            contentContainerStyle={styles.list}
            renderItem={({ item }) =>
              item.kind === 'day' ? (
                <DayPill date={item.date} />
              ) : (
                <RoomPostBubble
                  post={item.post}
                  onRetry={item.post.delivery === 'failed' ? () => outbox.retry(item.post.key) : undefined}
                  onCancel={item.post.files.length > 0 ? () => outbox.cancel(item.post.key) : undefined}
                  onOpenFile={canOpenFiles ? setOpenedFile : undefined}
                  onOpenAuthor={setSheetFor}
                />
              )
            }
            ListEmptyComponent={empty}
            // Only while there are no posts, where it is the way to try again. Drawn bottom up, a list would put the
            // control at the bottom; with posts, the room is read again every few seconds while it is in view.
            refreshControl={
              unavailable || shown.length > 0 ? undefined : (
                <RefreshControl
                  refreshing={feed.refreshing}
                  onRefresh={feed.refresh}
                  tintColor={ColorPalette.brand.primary}
                />
              )
            }
            // The header of a list drawn bottom up is at its bottom, under the newest post: where a failed poll is said.
            ListHeaderComponent={
              feed.pollFailed && shown.length > 0 ? (
                <View style={styles.pollFailed} testID={testIdWithKey('RoomPollFailed')}>
                  <ThemedText style={styles.muted}>{t('Rooms.RefreshFailed')}</ThemedText>
                  <ThemedText style={styles.muted}>·</ThemedText>
                  <Pressable
                    onPress={feed.pollNow}
                    accessibilityRole="button"
                    hitSlop={12}
                    testID={testIdWithKey('RoomPollTryAgain')}
                  >
                    <ThemedText style={styles.tryAgain}>{t('Rooms.TryAgain')}</ThemedText>
                  </Pressable>
                </View>
              ) : null
            }
            // Older posts load as the member scrolls up to them, as a chat's do: the end of a list drawn bottom up is
            // its top. No button.
            onEndReached={feed.hasOlder && !feed.loadingOlder ? feed.loadOlder : undefined}
            onEndReachedThreshold={0.25}
            onViewableItemsChanged={floating.onViewableItemsChanged}
            viewabilityConfig={floating.viewabilityConfig}
            onScrollBeginDrag={floating.onScrollStart}
            onMomentumScrollBegin={floating.onScrollStart}
            onScrollEndDrag={floating.onScrollStop}
            onMomentumScrollEnd={floating.onScrollStop}
            // The footer of a list drawn bottom up is at its top, above the oldest post shown: the app's spinner while
            // older posts are read.
            ListFooterComponent={
              feed.loadingOlder ? (
                <ActivityIndicator
                  style={styles.centered}
                  color={ColorPalette.brand.primary}
                  accessibilityLabel={t('Rooms.Reading')}
                  testID={testIdWithKey('RoomLoadingOlder')}
                />
              ) : feed.incomplete && !feed.hasOlder ? (
                <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomPostsIncomplete')}>
                  {t('Rooms.NotesIncomplete')}
                </ThemedText>
              ) : null
            }
          />
          {/* Over the top of the list, which is the top of this view: pinned there, never in the way of a tap. */}
          {floating.day && shown.length > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.floatingDay, { opacity: floating.opacity }]}
              testID={testIdWithKey('RoomFloatingDay')}
            >
              <DayPill date={floating.day} />
            </Animated.View>
          ) : null}
          {unavailable ? null : isComingSoon(roomCapabilities.write) ? (
            <RoomFeatureCard status={roomCapabilities.write} feature="write" strip />
          ) : (
            <RoomComposer
              // A screen reused for another room (navigating to a room already in the stack updates its params)
              // starts its field afresh: the last room's words never sit in this one's, or are saved as its draft.
              key={roomId}
              onSend={send}
              unavailable={cannotPost}
              postingAs={
                me.name
                  ? (t('Rooms.PostingAs', { who: me.name, interpolation: { escapeValue: false } }) as string)
                  : (t('Rooms.PostingAsAddName') as string)
              }
              postingAsName={me.name}
              onPressPostingAs={() => setSheetFor(room.actingAs)}
              canAttach={canAttach}
              attachRequest={params?.attach}
              draft={draft.saved}
              onTextChange={draft.onTextChange}
            />
          )}
        </KeyboardAvoidingView>
        <RoomFileSheet service={service} roomId={roomId} file={openedFile} onClose={() => setOpenedFile(undefined)} />
        <RoomIdentitySheet
          identity={sheetFor}
          communityDid={room.communityDid}
          mine={sheetFor?.did === room.actingAs.did}
          me={me}
          onClose={() => setSheetFor(undefined)}
          onOpenProfile={(profileId) => openInMyAgent(navigation, Screens.EditRCard, profileId ? { profileId } : {})}
          onViewCard={
            room.communityDid
              ? (memberDid, standIn) => {
                  setSheetFor(undefined)
                  openInMyAgent(navigation, Screens.CommunityMemberCard, {
                    communityDid: room.communityDid,
                    memberDid,
                    standIn,
                  })
                }
              : undefined
          }
        />
      </SafeAreaView>
    </PetnamesProvider>
  )
}

export default Room
