/**
 * A room as a Messages row (rooms in Messages, R1): the same row as a conversation's (Messages list L2: 72 pt, the
 * name, when, one line of the newest post, the unread count), with the room's letters on a lilac square where a person
 * has a round photo, and its community as a small tag after its name. The newest post says who wrote it ("Sam: …",
 * "You: …"), a note by its title and a file by its name.
 *
 * Who wrote it is said as the room says it: the member's own name for them, else the name they wrote on their
 * directory card when this phone already has it, else the community's words. The list never looks a name up itself.
 *
 * Behind it, Hide (R3): a swipe, a long press or the screen reader's action takes the room off Messages until someone
 * posts in it again, with Undo. Not Delete: a room's posts live with its community, not on this phone. No question
 * first, since Undo puts it back.
 *
 * @module rooms/components/RoomMessageRow
 */
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native'
import Toast from 'react-native-toast-message'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { rowTime } from '../../../components/listItems/messagesListRow'
import SwipeRow from '../../../components/listItems/SwipeRow'
import { UNDO_WINDOW_MS } from '../../chat/pendingChatDeletes'
import { useTheme } from '../../../contexts/theme'
import { useDateWords, useUses24HourClock } from '../../../utils/localDay'
import { testIdWithKey } from '../../../utils/testable'
import { useDirectoryNames, useDirectoryService } from '../../directory/useDirectory'
import { hideRoom, type RoomRow } from '../useRoomRows'
import { usePetnames } from '../usePetname'

import { ROOM_MARK_FILL } from './RoomHeader'
import { initialsOf } from './RoomIdentitySheet'
import { roomTitle } from './RoomRow'
import { memberText } from './roomWords'

const MARK_SIZE = 44
// The conversation rows' own values (ContactListItem), so the two kinds of row read as one list.
const NAME_COLOR = '#010B13'
const PREVIEW_COLOR = '#666666'
const DIVIDER = '#E3DEE3'
/** The community tag's border: the brand's colour, lighter, so the tag stays quieter than the name. */
const TAG_BORDER = '#B99BBA'
const NO_DIDS: readonly string[] = []
const asWritten = { interpolation: { escapeValue: false } }

export interface RoomMessageRowProps {
  row: RoomRow
  onOpen: (roomId: string) => void
}

const RoomMessageRow: React.FC<RoomMessageRowProps> = ({ row, onOpen }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const words = useDateWords()
  const use24h = useUses24HourClock()
  const petnames = usePetnames(row.communityDid)
  // Names already on this phone only: an empty list asks the directory nothing.
  const directoryNames = useDirectoryNames(useDirectoryService(), row.communityDid, NO_DIDS)

  const name = roomTitle(t, { name: row.roomName, nameFrom: row.nameFrom })
  const community = row.communityName ? String(row.communityName) : undefined
  const post = row.lastPost
  // Not read yet (the agent not ready on a cold launch): the app's spinner, as the rooms card shows (#775), never "No
  // posts yet" for a room that may have some. The words stay in the row's label, for a screen reader.
  const reading = !post && !!row.reading
  const what = !post
    ? (t(row.reading ? 'Rooms.Reading' : 'Rooms.RowNoPosts') as string)
    : post.kind === 'note'
      ? (t('Rooms.RowNote', { title: post.text, ...asWritten }) as string)
      : post.kind === 'file'
        ? (t('Rooms.RowFile', { name: post.text, ...asWritten }) as string)
        : post.text || (t('Rooms.RowPost') as string)
  const line = !post
    ? what
    : post.mine
      ? (t('MessagesList.You', { text: what, ...asWritten }) as string)
      : post.by
        ? (t('Rooms.RowBy', {
            who: memberText(t, post.by, petnames.get(post.by.did), directoryNames.get(post.by.did)),
            text: what,
            ...asWritten,
          }) as string)
        : what
  const when = row.lastActivityAt ? rowTime(row.lastActivityAt, words, use24h) : ''
  const unread = row.unread > 0

  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 72,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    mark: {
      width: MARK_SIZE,
      height: MARK_SIZE,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ROOM_MARK_FILL,
    },
    letters: { color: ColorPalette.brand.primary, fontSize: 16, fontWeight: '700' },
    middle: { flex: 1, minWidth: 0, gap: 2 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nameWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: unread ? '700' : '600', color: NAME_COLOR },
    tag: {
      flexShrink: 0,
      maxWidth: 140,
      paddingHorizontal: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: TAG_BORDER,
    },
    tagText: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: ColorPalette.brand.primary },
    when: {
      fontSize: 13,
      lineHeight: 18,
      color: unread ? ColorPalette.brand.primary : PREVIEW_COLOR,
      fontWeight: unread ? '600' : '400',
    },
    bottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    previewSlot: { flex: 1, minWidth: 0, justifyContent: 'center' },
    spinner: { position: 'absolute', left: 0 },
    preview: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      lineHeight: 20,
      color: unread ? NAME_COLOR : PREVIEW_COLOR,
      fontWeight: unread ? '600' : '400',
    },
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 10,
      backgroundColor: ColorPalette.brand.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: ColorPalette.grayscale.white, fontSize: 12, lineHeight: 16, fontWeight: '700' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: DIVIDER, marginLeft: 16 + MARK_SIZE + 12 },
  })

  const hide = useCallback(() => {
    const undo = hideRoom(row.roomId)
    if (!undo) return
    Toast.show({
      type: 'undo',
      text1: t('Rooms.Hidden', { room: name, ...asWritten }) as string,
      visibilityTime: UNDO_WINDOW_MS,
      props: { onUndo: undo },
    })
  }, [row.roomId, t, name])

  // One sentence for a screen reader: which room, where, what was said, when, and how many are unread.
  const label = [
    t(community ? 'Rooms.RowLabelIn' : 'Rooms.RowLabel', { room: name, community, preview: line, ...asWritten }),
    when,
    unread ? t('MessagesList.Unread', { count: row.unread }) : '',
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <SwipeRow
      action={{
        name: 'hide',
        label: t('Rooms.Hide'),
        icon: 'eye-off-outline',
        tone: 'neutral',
        width: 96,
        onPress: hide,
        testID: testIdWithKey('RoomMessageRowHide'),
      }}
    >
      {(touch) => (
        <TouchableOpacity
          onPress={() => onOpen(row.roomId)}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testIdWithKey('RoomMessageRow')}
          {...touch}
        >
          <View style={styles.row}>
            <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {row.nameFrom === 'roomId' ? (
                <Icon name="door" size={22} color={ColorPalette.brand.primary} />
              ) : (
                <ThemedText style={styles.letters}>{initialsOf(name)}</ThemedText>
              )}
            </View>
            <View style={styles.middle}>
              <View style={styles.top}>
                <View style={styles.nameWrap}>
                  <ThemedText style={styles.name} numberOfLines={1}>
                    {name}
                  </ThemedText>
                  {community ? (
                    <View style={styles.tag}>
                      <ThemedText style={styles.tagText} numberOfLines={1}>
                        {community}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                {when ? <ThemedText style={styles.when}>{when}</ThemedText> : null}
              </View>
              <View style={styles.bottom}>
                {reading ? (
                  // The preview's own empty line keeps the row's height at any text size; the spinner sits over it.
                  <View style={styles.previewSlot}>
                    <ThemedText style={styles.preview} numberOfLines={1} importantForAccessibility="no">
                      {' '}
                    </ThemedText>
                    <ActivityIndicator
                      size="small"
                      color={ColorPalette.brand.primary}
                      style={styles.spinner}
                      accessibilityLabel={line}
                    />
                  </View>
                ) : (
                  <ThemedText style={styles.preview} numberOfLines={1} ellipsizeMode="tail">
                    {line}
                  </ThemedText>
                )}
                {unread ? (
                  <View style={styles.badge} testID={testIdWithKey('MessagesListUnread')}>
                    <ThemedText style={styles.badgeText}>{row.unread > 99 ? '99+' : row.unread}</ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          <View style={styles.divider} />
        </TouchableOpacity>
      )}
    </SwipeRow>
  )
}

export default RoomMessageRow
