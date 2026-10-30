/**
 * The attachment sheet (rooms member sprint): a tapped file's name, the type and size the sharer gave it, who
 * shared it and when, then Download, with progress and Cancel, then Share. The type is only what the post claims;
 * the sheet says so, and that Keyring can't check what a file holds.
 *
 * The downloaded copy is the service's protected local copy, released when the sheet closes. Share hands it to the
 * system share sheet (expo-sharing, which the app already carries for problem reports), on iOS and Android alike;
 * on a device that can't share files, the sheet says so instead of offering a button that would fail.
 *
 * @module rooms/components/RoomFileSheet
 */
import * as Sharing from 'expo-sharing'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { localDate } from '../../trust-tasks/screens/localTime'
import type { RoomFile, RoomsService } from '../types'
import { useRoomFile } from '../useRoomFile'

import { fileSizeText, fileTypeText } from './fileWords'
import { useMemberWords } from './memberWords'

export interface RoomFileSheetProps {
  service: RoomsService | undefined
  roomId: string
  /** The file to show; none closes the sheet. */
  file?: RoomFile
  onClose: () => void
}

export const RoomFileSheet: React.FC<RoomFileSheetProps> = ({ service, roomId, file, onClose }) => (
  <Modal visible={!!file} transparent animationType="slide" onRequestClose={onClose}>
    {/* Mounted afresh for each file, so a download never carries over to the next. */}
    {file ? <SheetBody service={service} roomId={roomId} file={file} onClose={onClose} /> : null}
  </Modal>
)

const SheetBody: React.FC<
  Required<Pick<RoomFileSheetProps, 'roomId' | 'onClose'>> & {
    service: RoomsService | undefined
    file: RoomFile
  }
> = ({ service, roomId, file, onClose }) => {
  const { t, i18n } = useTranslation()
  const memberWords = useMemberWords()
  const { ColorPalette } = useTheme()
  const { state, download, cancel } = useRoomFile(service, roomId, file)
  // Unknown until asked; asked once per sheet.
  const [canShare, setCanShare] = useState<boolean>()
  useEffect(() => {
    let live = true
    Sharing.isAvailableAsync()
      .then((available) => live && setCanShare(available))
      .catch(() => live && setCanShare(false))
    return () => {
      live = false
    }
  }, [])
  const styles = StyleSheet.create({
    // The chat's sheets' scrim.
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.35)' },
    sheet: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 20,
      paddingBottom: 36,
      gap: 12,
    },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    track: { height: 6, borderRadius: 3, backgroundColor: ColorPalette.grayscale.lightGrey, overflow: 'hidden' },
    error: { color: ColorPalette.semantic.error },
  })
  const type = fileTypeText(file)
  const shared = [
    file.sharedBy ? memberWords(file.sharedBy) : undefined,
    file.sharedAt ? localDate(file.sharedAt) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const progress = state.step === 'downloading' ? state.progress : undefined
  const fraction = progress && progress.total > 0 ? Math.min(1, progress.sent / progress.total) : 0

  const share = async () => {
    if (state.step !== 'ready') return
    try {
      await Sharing.shareAsync(state.opened.localUri, {
        mimeType: state.opened.mediaType ?? file.mediaType,
        dialogTitle: String(file.name),
      })
    } catch {
      // The share sheet was dismissed or refused: the copy stays until the sheet closes.
    }
  }

  return (
    <View style={styles.backdrop}>
      {/* A tap outside the sheet closes it, as the chat's message actions do: a sibling, so VoiceOver reaches the buttons. */}
      <Pressable
        style={{ flex: 1 }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('Global.Close')}
        testID={testIdWithKey('RoomFileSheetClose')}
      />
      <View style={styles.sheet} testID={testIdWithKey('RoomFileSheet')}>
        <ThemedText variant="headingFour" testID={testIdWithKey('RoomFileName')}>
          {file.name}
        </ThemedText>
        <ThemedText testID={testIdWithKey('RoomFileFacts')}>
          {[
            type ? (t('Rooms.FileTypeAsShared', { type }) as string) : undefined,
            file.size !== undefined ? fileSizeText(t, file.size, i18n.language) : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </ThemedText>
        {shared ? (
          <ThemedText style={styles.muted}>
            {t('Rooms.FileSharedBy', { who: shared, interpolation: { escapeValue: false } })}
          </ThemedText>
        ) : null}
        <ThemedText variant="caption" style={styles.muted}>
          {t('Rooms.FileCaution')}
        </ThemedText>

        {state.step === 'downloading' ? (
          <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
            <View
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
              testID={testIdWithKey('RoomFileProgress')}
            >
              <View
                style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: ColorPalette.brand.primary }}
              />
            </View>
            <Button
              title={t('Global.Cancel')}
              buttonType={ButtonType.Secondary}
              onPress={cancel}
              testID={testIdWithKey('RoomFileCancel')}
            />
          </View>
        ) : state.step === 'ready' ? (
          canShare ? (
            <Button
              title={t('Rooms.FileShare')}
              buttonType={ButtonType.Primary}
              onPress={share}
              testID={testIdWithKey('RoomFileShare')}
            />
          ) : (
            <ThemedText style={styles.muted} testID={testIdWithKey('RoomFileShareUnavailable')}>
              {t('Rooms.FileShareUnavailable')}
            </ThemedText>
          )
        ) : (
          <>
            {state.step === 'failed' ? (
              <ThemedText
                style={styles.error}
                accessibilityLiveRegion="polite"
                testID={testIdWithKey('RoomFileFailed')}
              >
                {t('Rooms.FileFailed')}
              </ThemedText>
            ) : null}
            <Button
              title={t(state.step === 'failed' ? 'Rooms.TryAgain' : 'Rooms.FileDownload')}
              buttonType={ButtonType.Primary}
              onPress={download}
              testID={testIdWithKey('RoomFileDownload')}
            />
          </>
        )}
      </View>
    </View>
  )
}

export default RoomFileSheet
