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
 * Above "Posting as", what the next Send does when it isn't a plain post (frames 3 and 12): the words it answers, or
 * "Editing your message" with the words being replaced, each with its own cancel, drawn as one-to-one chat's reply
 * preview. An edit borrows the field: it holds the message's words, the draft is left alone, and the draft comes back
 * when the edit ends, sent or not. No "+" while either is open: a reply and an edit are words only.
 *
 * Where the member may not post, the composer is replaced by the reason, in the rooms screens' usual words
 * ("You can't post here", "Coming soon"), never by a field that would fail on Send.
 *
 * @module rooms/components/RoomComposer
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter, Pressable, StyleSheet, TextInput, View } from 'react-native'
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
import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { pickRoomFile } from '../pickRoomFile'
import { removeRoomFileCopy } from '../real/files/tempCopies'
import type { RoomsAttachment } from '../types'
import { MAX_POST_LENGTH } from '../useRoomSend'

import { fileSizeText } from './fileWords'
import { initialsOf } from './RoomIdentitySheet'

/** What the next Send does, when it isn't a plain post. */
export type ComposerContext =
  | { kind: 'reply'; name: string; text: string; onCancel: () => void }
  | { kind: 'edit'; text: string; onCancel: () => void }

export interface RoomComposerProps {
  /**
   * Sends the text and the picked file, either or both; false when nothing was sent (the composer then keeps them).
   * Waited for when it is a promise: Send is held meanwhile.
   */
  onSend: (text: string, file?: RoomsAttachment) => boolean | Promise<boolean>
  /** A reply or an edit under way. */
  context?: ComposerContext
  /** Offer "+" to post a file. */
  canAttach?: boolean
  /** The largest file this room takes, where that is less than the picker's own limit. */
  maxFileBytes?: number
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
  context,
  unavailable,
  postingAs,
  postingAsName,
  onPressPostingAs,
  canAttach,
  maxFileBytes,
  attachRequest = 0,
  draft,
  onTextChange,
}) => {
  const { t, i18n } = useTranslation()
  const { ColorPalette } = useTheme()
  const [text, setText] = useState(draft ?? '')
  const editing = context?.kind === 'edit'
  // The draft's words while an edit has the field, given back when it ends.
  const parked = useRef<string | undefined>(undefined)
  const change = (next: string) => {
    setText(next)
    if (!editing) onTextChange?.(next)
  }
  useEffect(() => {
    if (draft !== undefined && parked.current === undefined) setText(draft)
  }, [draft])
  const textNow = useRef(text)
  textNow.current = text
  const editWords = context?.kind === 'edit' ? context.text : undefined
  useEffect(() => {
    if (editWords !== undefined) {
      if (parked.current === undefined) parked.current = textNow.current
      setText(editWords)
    } else if (parked.current !== undefined) {
      const back = parked.current
      parked.current = undefined
      setText(back)
    }
  }, [editWords])
  const [sending, setSending] = useState(false)
  const [file, setFile] = useState<RoomsAttachment>()
  // The picked file's copy is the composer's until it is sent, so it goes when the file does, or the composer.
  const held = useRef<RoomsAttachment | undefined>(undefined)
  const holdFile = (next?: RoomsAttachment) => {
    void removeRoomFileCopy(held.current?.uri)
    held.current = next
    setFile(next)
  }
  useEffect(() => {
    // The lock removes every copy itself; a chip left here would name a file that is gone.
    const locked = DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, () => {
      held.current = undefined
      setFile(undefined)
    })
    return () => {
      locked.remove()
      void removeRoomFileCopy(held.current?.uri)
    }
  }, [])
  const [refused, setRefused] = useState<'tooLarge' | 'tooLargeHere' | 'unreadable'>()
  const canSend = (text.trim().length > 0 || !!file) && !sending
  const attachHere = canAttach && !context
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
    // One-to-one chat's reply preview (gifted-chat ReplyPreview), as the mocks measured it.
    context: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderRadius: 8,
      marginHorizontal: 10,
      marginTop: 8,
      backgroundColor: '#E9E9EB',
      overflow: 'hidden',
    },
    contextBar: { width: 4, backgroundColor: '#0084FF' },
    contextWords: { flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 10 },
    contextName: { fontSize: 13, lineHeight: 17, fontWeight: '600', marginBottom: 2, color: '#0084FF' },
    contextText: { fontSize: 14, lineHeight: 18, color: ColorPalette.brand.text },
    contextCancel: { width: 44, alignItems: 'center', justifyContent: 'center' },
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
    if (picked.ok && maxFileBytes !== undefined && picked.file.size > maxFileBytes) {
      await removeRoomFileCopy(picked.file.uri)
      setRefused('tooLargeHere')
    } else if (picked.ok) holdFile(picked.file)
    else setRefused(picked.reason)
  }

  // Each new request opens the picker once, and only once: the first render's 0 is no request.
  const attachRef = useRef(attach)
  attachRef.current = attach
  const handled = useRef(attachRequest)
  useEffect(() => {
    if (attachRequest <= handled.current) return
    handled.current = attachRequest
    if (attachHere && !unavailable) void attachRef.current()
  }, [attachRequest, attachHere, unavailable])

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

  const send = async () => {
    const sent = onSend(text, file)
    let ok: boolean
    if (typeof sent === 'boolean') ok = sent
    else {
      setSending(true)
      ok = await sent.catch(() => false)
      setSending(false)
    }
    if (!ok) return
    // An edit's field goes back to the draft when the edit ends; a post's is emptied.
    if (!editing) change('')
    // The outbox has the copy now, and removes it when the upload ends.
    held.current = undefined
    setFile(undefined)
  }

  return (
    <>
      {context ? (
        <View style={styles.context} testID={testIdWithKey(editing ? 'RoomComposerEditing' : 'RoomComposerReplying')}>
          <View style={styles.contextBar} />
          <View style={styles.contextWords}>
            <ThemedText style={styles.contextName} numberOfLines={1} testID={testIdWithKey('RoomComposerContextName')}>
              {context.kind === 'edit' ? t('Rooms.Editing') : context.name}
            </ThemedText>
            <ThemedText style={styles.contextText} numberOfLines={1} testID={testIdWithKey('RoomComposerContextText')}>
              {context.text}
            </ThemedText>
          </View>
          <Pressable
            onPress={context.onCancel}
            style={styles.contextCancel}
            accessibilityRole="button"
            accessibilityLabel={t(editing ? 'Rooms.EditCancel' : 'Rooms.ReplyCancel')}
            testID={testIdWithKey('RoomComposerContextCancel')}
          >
            <Icon name="close" size={18} color={ColorPalette.grayscale.mediumGrey} />
          </Pressable>
        </View>
      ) : null}
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
            onPress={() => holdFile(undefined)}
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
          {refused === 'tooLargeHere'
            ? t('Rooms.FileTooLargeHere', { megabytes: Math.floor((maxFileBytes ?? 0) / 1_000_000) })
            : t(refused === 'tooLarge' ? 'Rooms.FileTooLarge' : 'Rooms.FileUnreadable')}
        </ThemedText>
      ) : null}
      <View style={styles.bar} testID={testIdWithKey('RoomComposer')}>
        {attachHere ? (
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
