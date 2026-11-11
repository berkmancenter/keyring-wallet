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
 * A long press on a post offers Copy. Where sending is on and the room takes them (useRecordSending), it also offers a
 * reaction, a reply, and on the member's own message an edit or a withdrawal; where sending is on and the room takes
 * neither, the sheet says they aren't on in this room yet, or, in a room this phone saw take them, that they were on
 * and are off now (`RecordFeatures.wereOn`). A file or photo with no words has nothing to copy or edit:
 * its sheet offers a reaction and a reply where the room takes them, and otherwise says they aren't on here yet. A post
 * that carries a file is never edited (an edit writes new words alone, and would drop the file); the member's own may
 * be withdrawn, with words or without, as their message may. A reaction or a change shows at once, and the room's own
 * list takes over once it has stored it; one that fails is taken back, and the screen says why (pendingRecordWrites).
 *
 * The screen is the chat alone (rooms in Messages, R2, chat B). The header opens the room's details (RoomInfo), and
 * from there its files, its notes (titled records and the markers of removed ones, which the chat leaves out) and its
 * members, each a screen of its own. The files' "Add a file" comes back here with `attach`, and the composer's "+"
 * opens. Reached only while the rooms flag is on.
 *
 * @module rooms/screens/Room
 */
import { useAgent } from '@bifold/react-hooks'
import Clipboard from '@react-native-clipboard/clipboard'
import { useHeaderHeight } from '@react-navigation/elements'
import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Animated, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { DayPill } from '../../../components/chat/DayPill'
import MessageActions from '../../../components/chat/MessageActions'
import { ReactionChips, reactionChipsLabel } from '../../../components/chat/ReactionChips'
import { ToastType } from '../../../components/toast/BaseToast'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens } from '../../../types/navigators'
import { useMeasuredKeyboardOffset } from '../../trust-tasks/screens/keyboardOffset'
import { localDayKey } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import EmojiPickerSheet from '../../chat/emoji/EmojiPickerSheet'
import { type ComposerContext, RoomComposer } from '../components/RoomComposer'
import { RoomFileSheet } from '../components/RoomFileSheet'
import { useFloatingDay } from '../components/useFloatingDay'
import { isComingSoon, RoomFeatureCard } from '../components/RoomFeatureCard'
import { RoomHeader } from '../components/RoomHeader'
import { RoomNotJoined } from '../components/RoomNotJoined'
import { RoomIdentitySheet } from '../components/RoomIdentitySheet'
import { useDirectoryNames, useDirectoryService } from '../../directory/useDirectory'
import { PetnamesProvider } from '../components/memberWords'
import { RoomNoteMarker } from '../components/RoomNoteMarker'
import { RoomNotesWaiting } from '../components/RoomNotesWaiting'
import { RoomThreadPost, RoomThreadReactions } from '../components/RoomThreadPost'
import { RoomWithdrawSheet } from '../components/RoomWithdrawSheet'
import { memberText } from '../components/roomWords'
import { roomTitle } from '../components/RoomRow'
import { roomsStatusText } from '../components/roomsStatusText'
import { SampleDataBanner } from '../components/SampleDataBanner'
import { type InertText, toInertText } from '../inertText'
import { permanentRefusal, postRefusalWhy } from '../postRefusal'
import { isChatPost, isNoteMarker, reactionValueOfBody, type RoomPost } from '../roomPosts'
import { byArrival, drawnInChat, quotedWords, type RoomReactionTally } from '../roomThread'
import { openInMyAgent } from '../roomLinks'
import type { Identity, RecordFeatures, RoomFile } from '../types'
import { useMyName } from '../useMyName'
import { usePetnames } from '../usePetname'
import { useInViewAndActive } from '../useInViewAndActive'
import { type RoomListing, useRoom } from '../useRoom'
import { POSTS_PAGE, ROOM_POLL_MS, useRoomPosts } from '../useRoomPosts'
import { markRoomSeen } from '../useRoomRows'
import { useRoomDraft } from '../useRoomDraft'
import { type PendingPost, useRoomSend } from '../useRoomSend'
import { useRoomsService } from '../useRoomsService'
import { useRoomThread } from '../useRoomThread'
import { isPendingRecordKey, usePendingWrites, withPendingWrites } from '../pendingRecordWrites'
import { useRecordSending } from '../useRecordSending'

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
  ...(pending.inReplyTo ? { inReplyTo: pending.inReplyTo } : {}),
  retracted: false,
  pinned: false,
  unread: false,
  delivery: pending.state === 'sent' ? undefined : pending.state,
  ...(pending.state === 'failed' && pending.refused ? { refused: pending.refused } : {}),
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

/** Whether a post has words: what Copy copies, and what an edit changes. A file's name is not one. */
const hasWords = (post: RoomPost): boolean => !!String(post.text)

/** A post already in the room with words or a file to act on. A withdrawn message has neither. */
export const canActOn = (post: RoomPost): boolean =>
  !post.delivery && !post.retracted && !post.unread && (hasWords(post) || post.files.length > 0)

/** What a note's line says when the note has no title: the start of its text, cut by the line itself. */
const firstLineOf = (text: InertText): InertText | undefined =>
  (String(text)
    .split('\n')
    .find((line) => line.trim()) as InertText | undefined) ?? undefined

/** A note's reactions, under its line in the chat. */
const RoomMarkerChips: React.FC<{ tallies: readonly RoomReactionTally[]; onOpen: () => void }> = ({
  tallies,
  onOpen,
}) => {
  const { t } = useTranslation()
  const chips = tallies.map((tally) => ({ value: tally.shown, count: tally.count, mine: tally.mine }))
  return (
    <View style={{ marginLeft: 12, marginBottom: 4 }}>
      <ReactionChips
        chips={chips}
        isMe={false}
        label={reactionChipsLabel(t, chips)}
        onPress={onOpen}
        testID={testIdWithKey('RoomNoteReactions')}
      />
    </View>
  )
}

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
  const feed = useRoomPosts(
    service,
    roomId,
    room?.actingAs,
    !!room && canList && room.joined !== false,
    inView,
    isChatPost
  )
  // A reaction, edit or withdrawal the member just asked for, laid over the posts until the room's list carries it.
  const pendingWrites = usePendingWrites(feed.posts)
  const posts = useMemo(
    () => (feed.posts ? withPendingWrites(feed.posts, pendingWrites.writes) : undefined),
    [feed.posts, pendingWrites.writes]
  )
  // What the records say about each other: reactions, the quotes above replies, and who wrote a record first.
  const thread = useRoomThread(service, roomId, room?.actingAs, posts)
  // The post a long press is on, and the post whose chips were tapped.
  const [actionFor, setActionFor] = useState<RoomPost>()
  const [reactionsFor, setReactionsFor] = useState<readonly RoomReactionTally[]>()
  // What else the sheet may offer: replies, reactions, and changing the member's own message. Off in every build.
  const records = useRecordSending(service, state.room)
  // What the next Send answers, the message it rewrites, the one being withdrawn, and the one the full picker is for.
  const [replyTo, setReplyTo] = useState<RoomPost>()
  const [editing, setEditing] = useState<RoomPost>()
  const [withdrawing, setWithdrawing] = useState<RoomPost>()
  const [pickerFor, setPickerFor] = useState<RoomPost>()
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
  // How large a file this room's host takes, asked once posting a file is possible here.
  const uploadOn = roomCapabilities?.uploadFile.status === 'available'
  const [fileLimit, setFileLimit] = useState<number>()
  useEffect(() => {
    if (!uploadOn || !service?.fileLimit) return
    let live = true
    service
      .fileLimit(roomId)
      .then((limit) => live && setFileLimit(limit))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [uploadOn, service, roomId])
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
  const { send: sendRecord, learn, typedMessages } = records
  const { track } = pendingWrites
  const actingAs = room?.actingAs
  const { refresh } = feed
  // A write refused or failed: said in the words a post uses. A room that no longer takes it is read again.
  const notSent = useCallback(
    (e: unknown, words: string) => {
      if (e instanceof Error && e.name === 'RecordMembersNotPermitted') {
        // The refusal says what the room takes now (`RecordMembersNotPermitted.features`): the sheet follows it, and so
        // do the words, for a room this phone saw take them (`RecordFeatures.wereOn`).
        const told = (e as Error & { features?: RecordFeatures }).features
        learn(told)
        Toast.show({
          type: ToastType.Error,
          text1: t(told?.wereOn ? 'Rooms.RecordsTurnedOff' : 'Rooms.RecordsNotOn') as string,
        })
        return
      }
      const refusal = permanentRefusal(e)
      Toast.show({
        type: ToastType.Error,
        text1: t(words) as string,
        ...(refusal ? { text2: postRefusalWhy(t, refusal) } : {}),
      })
    },
    [learn, t]
  )
  const send = useCallback(
    (text: string, file?: Parameters<typeof outboxSend>[1]): boolean | Promise<boolean> => {
      if (editing) {
        const target = editing
        const body = text.trim()
        if (!body) return false
        return track({ type: 'edit', key: target.key, body, at: new Date().toISOString() }, () =>
          sendRecord({ type: 'edit', key: target.key, body })
        ).then(
          () => {
            setEditing(undefined)
            refresh()
            return true
          },
          (e: unknown) => {
            notSent(e, 'Rooms.EditNotSent')
            return false
          }
        )
      }
      const sending = outboxSend(text, file, {
        ...(replyTo && !file ? { inReplyTo: { key: replyTo.key, version: replyTo.version } } : {}),
        ...(typedMessages && !file ? { asRecord: true } : {}),
      })
      if (sending) {
        setReplyTo(undefined)
        list.current?.scrollToOffset({ offset: 0, animated: true })
      }
      return sending
    },
    [outboxSend, editing, replyTo, typedMessages, sendRecord, refresh, notSent, track]
  )
  /**
   * One reaction per person, as in chat: a new value rewrites the member's reaction to this post, the value they already
   * chose takes it back, and a first one is a new record. Another app may have left several: each holding the value
   * goes, and a new value rewrites the newest.
   */
  const react = useCallback(
    async (target: RoomPost, emoji: string) => {
      const value = reactionValueOfBody(emoji)
      if (!value) return
      const held = thread.mine.get(target.key) ?? []
      // One change at a time on a post: a reaction still on its way has no record to rewrite or take back yet.
      if (held.some((r) => isPendingRecordKey(r.key))) return
      const same = held.filter((r) => r.value === value)
      try {
        if (same.length > 0)
          await Promise.all(
            same.map((r) => track({ type: 'withdraw', key: r.key }, () => sendRecord({ type: 'withdraw', key: r.key })))
          )
        else if (held.length > 0)
          await track({ type: 'changeReaction', key: held[0].key, value: emoji }, () =>
            sendRecord({ type: 'changeReaction', key: held[0].key, value: emoji })
          )
        else {
          const write = {
            type: 'reaction',
            value: emoji,
            target: { key: target.key, version: target.version },
          } as const
          if (actingAs) await track({ ...write, author: actingAs }, () => sendRecord(write))
          else await sendRecord(write)
        }
        refresh()
      } catch (e) {
        notSent(e, 'Chat.ReactionNotSent')
      }
    },
    [thread.mine, sendRecord, refresh, notSent, track, actingAs]
  )
  const withdraw = useCallback(
    async (target: RoomPost) => {
      setWithdrawing(undefined)
      try {
        await track({ type: 'withdraw', key: target.key }, () => sendRecord({ type: 'withdraw', key: target.key }))
        refresh()
      } catch (e) {
        notSent(e, 'Rooms.WithdrawNotSent')
      }
    },
    [sendRecord, refresh, notSent, track]
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

  // The member's value on the post the sheet is for, in the form the quick reactions are written in.
  const myValue = actionFor ? thread.mine.get(actionFor.key)?.[0]?.value : undefined
  const selectedReaction = myValue
    ? (thread.reactions.get(actionFor?.key ?? '')?.find((tally) => tally.value === myValue)?.shown ?? myValue)
    : undefined
  const composerContext: ComposerContext | undefined = editing
    ? { kind: 'edit', text: String(editing.text), onCancel: () => setEditing(undefined) }
    : replyTo
      ? {
          kind: 'reply',
          name: replyTo.mine
            ? (t('Rooms.You') as string)
            : replyTo.author
              ? memberText(t, replyTo.author, petnames.get(replyTo.author.did), directoryNames.get(replyTo.author.did))
              : (t('Rooms.QuoteNoAuthor') as string),
          text: quotedWords(replyTo),
          onCancel: () => setReplyTo(undefined),
        }
      : undefined
  // The member's own message, words or a file: a withdrawal takes the post back whole, so a file with no words may go
  // too (posting the wrong file is the likelier slip). A post with neither is already withdrawn and opens no sheet.
  const changing = actionFor && records.canChange(actionFor) ? actionFor : undefined
  // An edit writes new words alone, so on a post that carries a file it would drop the file: withdrawn, never edited.
  const editable = changing && changing.files.length === 0 ? changing : undefined
  // A file with no words: with no reply or reaction to offer, the sheet would be empty, so it says why instead.
  const nothingToOffer = !!actionFor && !hasWords(actionFor) && !records.replies && !records.reactions
  const unavailable = roomsStatusText(t, roomCapabilities.listNotes, 'listNotes')
  const cannotPost = roomsStatusText(t, roomCapabilities.write, 'write')
  // A file is posted from the composer, so "Add a file" is offered only where the room takes one (`uploadFile`) and
  // its files can be listed, so a posted file is seen.
  const canAttach =
    roomCapabilities.uploadFile.status === 'available' && roomCapabilities.listFiles.status === 'available'
  // Titled records and removed ones are the room's notes, on their own screen; the chat shows the rest.
  const chatPosts = posts?.filter(isChatPost)
  // The notes the chat leaves out, said under an empty chat: a note from the web page read as an empty room (IN-434).
  const notesHere = posts?.filter(isNoteMarker) ?? []
  // In a chat with messages, a note is one line at its time (RoomNoteMarker). In a chat with none, the card below says it.
  const hasMessages = !!chatPosts?.length || pendingPosts.length > 0
  const items = hasMessages
    ? withDayPills([
        ...pendingPosts,
        ...byArrival(thread.posts.filter((post) => drawnInChat(post, thread, thread.held.get(post.key)))),
      ])
    : []
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
    <View style={styles.centered}>
      <ThemedText style={styles.muted} testID={testIdWithKey('RoomPostsNone')}>
        {t('Rooms.PostsNone')}
      </ThemedText>
      {notesHere.length > 0 ? (
        <RoomNotesWaiting
          count={notesHere.length}
          newest={notesHere[0].title ?? firstLineOf(notesHere[0].text)}
          onOpen={() => navigation.navigate(Screens.RoomPart, { roomId, part: 'notes' })}
        />
      ) : null}
    </View>
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
        {/* Not joined yet: nothing here can be read or sent, and trying again cannot help. Said in place of all of it. */}
        {room.joined === false ? (
          <RoomNotJoined room={room} />
        ) : (
          /* keyboard-controller's view, which lifts on Android too: the app draws under the system bars there. */
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
                ) : isNoteMarker(item.post) ? (
                  <View>
                    <RoomNoteMarker
                      title={item.post.title ?? firstLineOf(item.post.text)}
                      onOpen={() => navigation.navigate(Screens.RoomPart, { roomId, part: 'notes' })}
                    />
                    {thread.reactions.get(item.post.key) ? (
                      <RoomMarkerChips
                        tallies={thread.reactions.get(item.post.key) ?? []}
                        onOpen={() => setReactionsFor(thread.reactions.get(item.post.key))}
                      />
                    ) : null}
                  </View>
                ) : (
                  <RoomThreadPost
                    thread={thread}
                    post={item.post}
                    onLongPress={canActOn(item.post) ? () => setActionFor(item.post) : undefined}
                    onOpenReactions={() => setReactionsFor(thread.reactions.get(item.post.key))}
                    onRetry={
                      item.post.delivery === 'failed'
                        ? () => (item.post.files.length > 0 ? outbox.cancel : outbox.retry)(item.post.key)
                        : undefined
                    }
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
                context={composerContext}
                unavailable={cannotPost}
                postingAs={
                  me.name
                    ? (t('Rooms.PostingAs', { who: me.name, interpolation: { escapeValue: false } }) as string)
                    : (t('Rooms.PostingAsAddName') as string)
                }
                postingAsName={me.name}
                onPressPostingAs={() => setSheetFor(room.actingAs)}
                canAttach={canAttach}
                maxFileBytes={fileLimit}
                attachRequest={params?.attach}
                draft={draft.saved}
                onTextChange={draft.onTextChange}
              />
            )}
          </KeyboardAvoidingView>
        )}
        <RoomFileSheet service={service} roomId={roomId} file={openedFile} onClose={() => setOpenedFile(undefined)} />
        {/* Copy only, until sending is on and the room takes replies and reactions (useRecordSending); a file with no
            words, the notice alone. */}
        <MessageActions
          visible={!!actionFor}
          onClose={() => setActionFor(undefined)}
          onReact={
            actionFor && records.reactions
              ? (emoji) => {
                  setActionFor(undefined)
                  void react(actionFor, emoji)
                }
              : undefined
          }
          selectedReaction={selectedReaction}
          onMoreReactions={
            actionFor && records.reactions
              ? () => {
                  setActionFor(undefined)
                  setPickerFor(actionFor)
                }
              : undefined
          }
          onReply={
            actionFor && records.replies
              ? () => {
                  setActionFor(undefined)
                  setEditing(undefined)
                  setReplyTo(actionFor)
                }
              : undefined
          }
          onCopy={
            actionFor && hasWords(actionFor)
              ? () => {
                  Clipboard.setString(String(actionFor.text))
                  setActionFor(undefined)
                  Toast.show({ type: ToastType.Success, text1: t('Chat.Copied') as string })
                }
              : undefined
          }
          onEdit={
            editable
              ? () => {
                  setActionFor(undefined)
                  setReplyTo(undefined)
                  setEditing(editable)
                }
              : undefined
          }
          onWithdraw={
            changing
              ? () => {
                  setActionFor(undefined)
                  setWithdrawing(changing)
                }
              : undefined
          }
          notice={
            records.wereOn
              ? (t('Rooms.RecordsTurnedOff') as string)
              : records.notOn || nothingToOffer
                ? (t('Rooms.RecordsNotOn') as string)
                : undefined
          }
        />
        <EmojiPickerSheet
          visible={!!pickerFor}
          onSelect={(emoji) => {
            const target = pickerFor
            setPickerFor(undefined)
            if (target) void react(target, emoji)
          }}
          onClose={() => setPickerFor(undefined)}
        />
        <RoomWithdrawSheet
          visible={!!withdrawing}
          onWithdraw={() => withdrawing && void withdraw(withdrawing)}
          onKeep={() => setWithdrawing(undefined)}
        />
        <RoomThreadReactions tallies={reactionsFor} onClose={() => setReactionsFor(undefined)} />
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
