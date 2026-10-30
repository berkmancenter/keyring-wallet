/**
 * The note editor (rooms member features, chunk 2): a title and the note's words, then a check before posting that
 * names who the note posts as and who can read it, as the service's preview gives them, then Post. Editing one of
 * the member's own notes is the same sheet, filled in, and saves a new version of it.
 *
 * Its buttons sit at the top, where the keyboard never covers them. Words are kept through every failure, so
 * nothing typed is lost. If the note changed after it was opened, nothing is written: the sheet says so and offers
 * to read the room again.
 *
 * @module rooms/components/RoomNoteEditor
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomPost } from '../roomPosts'
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type RoomsService } from '../types'
import { useMyName } from '../useMyName'
import { useRoomNoteWrite } from '../useRoomNoteWrite'

import { identityText } from './roomWords'

/** A new note, or one of the member's own notes to edit. */
export type NoteEditorTarget = { kind: 'new' } | { kind: 'edit'; note: RoomPost }

export interface RoomNoteEditorProps {
  service: RoomsService | undefined
  roomId: string
  /** The room's community, whose profile names the member in the check; none names the active profile. */
  communityDid?: string
  /** What to write; none closes the editor. */
  target?: NoteEditorTarget
  onClose: () => void
  /** The note was written: read the room again. */
  onSaved: () => void
}

export const RoomNoteEditor: React.FC<RoomNoteEditorProps> = ({
  service,
  roomId,
  communityDid,
  target,
  onClose,
  onSaved,
}) => (
  // A modal is its own window, outside the app's safe-area provider: without one of its own the editor's SafeAreaView
  // reads no insets and its top bar sits under the status bar, out of reach.
  <SafeAreaModal visible={!!target} animationType="slide" onRequestClose={onClose}>
    {/* Mounted afresh for each note, so words and a new note's id never carry over to the next. */}
    {target ? (
      <EditorBody
        service={service}
        roomId={roomId}
        communityDid={communityDid}
        target={target}
        onClose={onClose}
        onSaved={onSaved}
      />
    ) : null}
  </SafeAreaModal>
)

const EditorBody: React.FC<Omit<RoomNoteEditorProps, 'target'> & { target: NoteEditorTarget }> = ({
  service,
  roomId,
  communityDid,
  target,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const editing = target.kind === 'edit' ? target.note : undefined
  const [title, setTitle] = useState(editing?.title ? String(editing.title) : '')
  const [body, setBody] = useState(editing ? String(editing.text) : '')
  const { state, review, save, edit } = useRoomNoteWrite(service, roomId, editing?.key)
  const me = useMyName(communityDid)

  // Once, when the note is written: read the room again and close.
  const done = useRef({ onSaved, onClose })
  done.current = { onSaved, onClose }
  useEffect(() => {
    if (state.step !== 'saved') return
    done.current.onSaved()
    done.current.onClose()
  }, [state.step])

  const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    barSpace: { minWidth: 72 },
    content: { padding: 16, gap: 12 },
    input: {
      fontSize: 16,
      color: ColorPalette.brand.text,
      borderWidth: 1,
      borderRadius: 8,
      borderColor: ColorPalette.grayscale.lightGrey,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bodyInput: { minHeight: 180, textAlignVertical: 'top' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    count: { color: ColorPalette.grayscale.mediumGrey, alignSelf: 'flex-end' },
    error: { color: ColorPalette.semantic.error },
    preview: {
      gap: 8,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ColorPalette.grayscale.lightGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
  })

  const checking = state.step === 'confirming' || state.step === 'saving'
  const preview = state.step === 'confirming' || state.step === 'saving' ? state.preview : undefined
  const ready = !!title.trim() && !!body.trim()
  const count = (used: number, max: number) => t('Rooms.NoteCharacters', { used, max }) as string

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']} testID={testIdWithKey('RoomNoteEditor')}>
      <View style={styles.bar}>
        <BarAction
          title={checking ? t('Global.Back') : t('Global.Cancel')}
          onPress={checking ? edit : onClose}
          disabled={state.step === 'saving'}
          testID={checking ? testIdWithKey('RoomNoteBack') : testIdWithKey('RoomNoteCancel')}
        />
        <ThemedText variant="bold" style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header">
          {checking ? t('Rooms.NoteCheck') : editing ? t('Rooms.NoteEditTitle') : t('Rooms.NoteNew')}
        </ThemedText>
        {checking ? (
          <View style={styles.barSpace} />
        ) : (
          <BarAction
            title={t('Rooms.NoteReview')}
            onPress={() => review(title, body)}
            disabled={!ready || state.step === 'preparing'}
            testID={testIdWithKey('RoomNoteReview')}
            end
          />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {preview ? (
          <>
            <ThemedText testID={testIdWithKey('RoomNotePostingAs')}>
              {t('Rooms.PostingAs', {
                who: me.name ?? identityText(preview.actingAs),
                interpolation: { escapeValue: false },
              })}
            </ThemedText>
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomNoteVisibleTo')}>
              {preview.visibleTo === 'membersAndHost' ? t('Rooms.TierOpenHint') : t('Rooms.NoteVisibleMembers')}
            </ThemedText>
            {editing ? <ThemedText style={styles.muted}>{t('Rooms.NoteNewVersion')}</ThemedText> : null}
            <View style={styles.preview} testID={testIdWithKey('RoomNotePreview')}>
              <ThemedText variant="bold">{preview.title}</ThemedText>
              <ThemedText selectable>{preview.body}</ThemedText>
            </View>
            <Button
              title={state.step === 'saving' ? t('Rooms.NoteSaving') : t('Rooms.NotePost')}
              buttonType={ButtonType.Primary}
              onPress={save}
              disabled={state.step === 'saving'}
              testID={testIdWithKey('RoomNotePost')}
            />
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              maxLength={NOTE_TITLE_MAX}
              maxFontSizeMultiplier={1.5}
              placeholder={t('Rooms.NoteTitleLabel')}
              placeholderTextColor={ColorPalette.grayscale.mediumGrey}
              accessibilityLabel={t('Rooms.NoteTitleLabel')}
              editable={state.step !== 'preparing'}
              testID={testIdWithKey('RoomNoteTitleInput')}
            />
            <ThemedText variant="caption" style={styles.count}>
              {count(title.length, NOTE_TITLE_MAX)}
            </ThemedText>
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={NOTE_BODY_MAX}
              maxFontSizeMultiplier={1.5}
              placeholder={t('Rooms.NoteBodyLabel')}
              placeholderTextColor={ColorPalette.grayscale.mediumGrey}
              accessibilityLabel={t('Rooms.NoteBodyLabel')}
              editable={state.step !== 'preparing'}
              testID={testIdWithKey('RoomNoteBodyInput')}
            />
            <ThemedText variant="caption" style={styles.count}>
              {count(body.length, NOTE_BODY_MAX)}
            </ThemedText>
          </>
        )}

        {state.step === 'failed' ? (
          <ThemedText style={styles.error} accessibilityLiveRegion="polite" testID={testIdWithKey('RoomNoteFailed')}>
            {state.during === 'prepare' ? t('Rooms.NotePrepareFailed') : t('Rooms.NoteSaveFailed')}
          </ThemedText>
        ) : null}
        {state.step === 'conflict' ? (
          <View style={{ gap: 12 }}>
            <ThemedText
              style={styles.error}
              accessibilityLiveRegion="polite"
              testID={testIdWithKey('RoomNoteConflict')}
            >
              {t('Rooms.NoteConflict')}
            </ThemedText>
            <Button
              title={t('Rooms.NoteReread')}
              buttonType={ButtonType.Secondary}
              onPress={() => {
                onSaved()
                onClose()
              }}
              testID={testIdWithKey('RoomNoteReread')}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

/** A text action in the editor's top bar, where the keyboard never covers it. */
const BarAction: React.FC<{
  title: string
  onPress: () => void
  disabled?: boolean
  testID: string
  end?: boolean
}> = ({ title, onPress, disabled, testID, end }) => {
  const { ColorPalette } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={{ minWidth: 72, alignItems: end ? 'flex-end' : 'flex-start', paddingVertical: 8 }}
      testID={testID}
    >
      <ThemedText
        variant="bold"
        style={{ color: disabled ? ColorPalette.grayscale.mediumGrey : ColorPalette.brand.primary }}
      >
        {title}
      </ThemedText>
    </Pressable>
  )
}

export default RoomNoteEditor
