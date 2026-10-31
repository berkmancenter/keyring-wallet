/**
 * A room's composer: the chat's slim composer, drawn to the same measures (a 40-point pill field that grows a line
 * at a time to five, then scrolls, and a 44-point Send) with the theme's colours. The chat's own composer leaves are
 * gifted-chat renderers and need its state, so a room, whose list is its own, uses this plain field instead.
 *
 * Above the field, who the member posts as: a room's audience differs from a one-to-one chat's, and the identity
 * differs per room, so it is in view at the moment of posting, not only in the header.
 *
 * "+" on the left picks one file to post (up to 25 MiB), shown above the field until it is sent or taken off; a
 * file too large is refused there and then, before anything is prepared.
 *
 * The text is kept as a draft by the screen (useRoomDraft): `onTextChange` hears every change, a send's emptied field
 * included, and `draft` is the kept text handed back, put in the field as it arrives.
 *
 * Where the member may not post, the composer is replaced by the reason, in the rooms screens' usual words
 * ("You can't post here", "Coming soon"), never by a field that would fail on Send.
 *
 * @module rooms/components/RoomComposer
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import {
  COMPOSER_FIELD,
  COMPOSER_LINE,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  TAP_TARGET,
} from '../../../components/chat/MessageInput'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { pickRoomFile } from '../pickRoomFile'
import type { RoomsAttachment } from '../types'
import { MAX_POST_LENGTH } from '../useRoomSend'

import { fileSizeText } from './fileWords'
import { initialsOf } from './RoomIdentitySheet'

export interface RoomComposerProps {
  /** Sends the text and the picked file, either or both; false when nothing was sent (the composer then keeps them). */
  onSend: (text: string, file?: RoomsAttachment) => boolean
  /** Offer "+" to post a file. */
  canAttach?: boolean
  /** Why the member can't post here; the composer shows this instead of a field. */
  unavailable?: string
  /** Who the member posts as, as the whole line ("Posting as Alberto L"). */
  postingAs?: string
  /** The name in that line, when there is one: drawn bold, beside its initial (header B). */
  postingAsName?: string
  /** Opens the member's own sheet: their name, where it comes from, and the identity the room sees. */
  onPressPostingAs?: () => void
  /** Opens the file picker each time it changes to a new number above 0 (the Files tab's "Add a file"). */
  attachRequest?: number
  /** The kept draft, once read: put in the field when it arrives. */
  draft?: string
  /** Told of every change to the field's text, including the empty field a send leaves. */
  onTextChange?: (text: string) => void
}

export const RoomComposer: React.FC<RoomComposerProps> = ({
  onSend,
  unavailable,
  postingAs,
  postingAsName,
  onPressPostingAs,
  canAttach,
  attachRequest = 0,
  draft,
  onTextChange,
}) => {
  const { t, i18n } = useTranslation()
  const { ColorPalette } = useTheme()
  const [text, setText] = useState(draft ?? '')
  const change = (next: string) => {
    setText(next)
    onTextChange?.(next)
  }
  useEffect(() => {
    if (draft !== undefined) setText(draft)
  }, [draft])
  const [file, setFile] = useState<RoomsAttachment>()
  const [refused, setRefused] = useState<'tooLarge' | 'unreadable'>()
  const canSend = text.trim().length > 0 || !!file
  const styles = StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 6,
      paddingTop: 6,
      paddingBottom: 8,
      gap: 2,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    field: {
      flex: 1,
      minHeight: COMPOSER_FIELD,
      borderRadius: COMPOSER_FIELD / 2,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.primaryBackground,
      paddingLeft: 14,
      paddingRight: 10,
      marginHorizontal: 2,
    },
    input: {
      minHeight: COMPOSER_MIN_HEIGHT,
      maxHeight: COMPOSER_MAX_HEIGHT,
      fontSize: 16,
      lineHeight: COMPOSER_LINE,
      paddingTop: 8,
      paddingBottom: 9,
      color: ColorPalette.brand.text,
    },
    sendDot: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: canSend ? ColorPalette.brand.primary : ColorPalette.grayscale.lightGrey,
    },
    unavailable: { padding: 16, color: ColorPalette.grayscale.mediumGrey, textAlign: 'center' },
    attached: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 12,
      marginTop: 6,
      paddingLeft: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    refused: { paddingHorizontal: 22, paddingTop: 6, fontSize: 12, color: ColorPalette.semantic.error },
    postingAsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 22,
      paddingTop: 6,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    postingAsMark: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: ColorPalette.brand.primary,
    },
    postingAsInitial: { fontSize: 12, fontWeight: '700', color: ColorPalette.grayscale.white },
    postingAsText: { flexShrink: 1, fontSize: 14, color: ColorPalette.grayscale.mediumGrey },
    postingAsName: { fontWeight: '700', color: ColorPalette.brand.primary },
  })

  const attach = async () => {
    setRefused(undefined)
    const picked = await pickRoomFile()
    if (!picked) return
    if (picked.ok) setFile(picked.file)
    else setRefused(picked.reason)
  }

  // Each new request opens the picker once, and only once: the first render's 0 is no request.
  const attachRef = useRef(attach)
  attachRef.current = attach
  const handled = useRef(attachRequest)
  useEffect(() => {
    if (attachRequest <= handled.current) return
    handled.current = attachRequest
    if (canAttach && !unavailable) void attachRef.current()
  }, [attachRequest, canAttach, unavailable])

  if (unavailable)
    return (
      <View style={{ backgroundColor: ColorPalette.brand.secondaryBackground }}>
        <ThemedText style={styles.unavailable} testID={testIdWithKey('RoomComposerUnavailable')}>
          {unavailable}
        </ThemedText>
      </View>
    )

  // Where the name sits in the line, in any language's word order; not found, the line is drawn as it is.
  const nameAt = postingAs && postingAsName ? postingAs.indexOf(postingAsName) : -1

  const send = () => {
    if (!onSend(text, file)) return
    change('')
    setFile(undefined)
  }

  return (
    <>
      {postingAs ? (
        <Pressable
          style={styles.postingAsRow}
          onPress={onPressPostingAs}
          disabled={!onPressPostingAs}
          accessibilityRole={onPressPostingAs ? 'button' : undefined}
          testID={testIdWithKey('RoomComposerPostingAsButton')}
        >
          {postingAsName ? (
            <View
              style={styles.postingAsMark}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <ThemedText style={styles.postingAsInitial}>{initialsOf(postingAsName).slice(0, 1)}</ThemedText>
            </View>
          ) : null}
          <ThemedText style={styles.postingAsText} numberOfLines={1} testID={testIdWithKey('RoomComposerPostingAs')}>
            {nameAt >= 0 && postingAsName ? (
              <>
                {postingAs.slice(0, nameAt)}
                <ThemedText style={[styles.postingAsText, styles.postingAsName]}>{postingAsName}</ThemedText>
                {postingAs.slice(nameAt + postingAsName.length)}
              </>
            ) : (
              postingAs
            )}
          </ThemedText>
          {onPressPostingAs ? <Icon name="chevron-right" size={16} color={ColorPalette.brand.primary} /> : null}
        </Pressable>
      ) : null}
      {file ? (
        <View style={styles.attached} testID={testIdWithKey('RoomComposerFile')}>
          <Icon name="paperclip" size={18} color={ColorPalette.brand.text} />
          <ThemedText style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="middle">
            {`${file.name} · ${fileSizeText(t, file.size, i18n.language)}`}
          </ThemedText>
          <Pressable
            onPress={() => setFile(undefined)}
            style={TAP_TARGET}
            accessibilityRole="button"
            accessibilityLabel={t('Rooms.FileRemove')}
            testID={testIdWithKey('RoomComposerFileRemove')}
          >
            <Icon name="close" size={20} color={ColorPalette.grayscale.mediumGrey} />
          </Pressable>
        </View>
      ) : null}
      {refused ? (
        <ThemedText
          style={styles.refused}
          accessibilityLiveRegion="polite"
          testID={testIdWithKey('RoomComposerFileRefused')}
        >
          {t(refused === 'tooLarge' ? 'Rooms.FileTooLarge' : 'Rooms.FileUnreadable')}
        </ThemedText>
      ) : null}
      <View style={styles.bar} testID={testIdWithKey('RoomComposer')}>
        {canAttach ? (
          <Pressable
            onPress={attach}
            style={TAP_TARGET}
            accessibilityRole="button"
            accessibilityLabel={t('Rooms.FileAttach')}
            testID={testIdWithKey('RoomComposerAttach')}
          >
            <Icon name="plus" size={26} color={ColorPalette.brand.text} />
          </Pressable>
        ) : null}
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={change}
            multiline
            maxLength={MAX_POST_LENGTH}
            maxFontSizeMultiplier={1.5}
            placeholder={t('Chat.MessagePlaceholder')}
            placeholderTextColor={ColorPalette.grayscale.mediumGrey}
            accessibilityLabel={t('Chat.MessagePlaceholder')}
            testID={testIdWithKey('RoomComposerInput')}
          />
        </View>
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={TAP_TARGET}
          accessibilityRole="button"
          accessibilityLabel={t('Rooms.Send')}
          accessibilityState={{ disabled: !canSend }}
          testID={testIdWithKey('RoomComposerSend')}
        >
          <View style={styles.sendDot}>
            <Icon name="arrow-up" size={22} color={ColorPalette.grayscale.white} />
          </View>
        </Pressable>
      </View>
    </>
  )
}

export default RoomComposer
