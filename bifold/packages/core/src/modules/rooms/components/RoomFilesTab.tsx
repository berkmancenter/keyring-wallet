/**
 * A room's library (data rooms mock, Files): every file shared in the room, newest first, with its type and size as
 * the sharer gave them and who shared it when. A tap opens the attachment sheet, where it downloads only if asked.
 * "Add a file" takes the member to the chat's composer with the picker open, since a file is posted as a post.
 *
 * Where the room's files can't be listed, the tab says why in the rooms screens' usual words, never an empty list.
 *
 * @module rooms/components/RoomFilesTab
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import type { OperationStatus, RoomFile } from '../types'

import { FileRow } from './RoomListRows'
import { isComingSoon, RoomFeatureCard } from './RoomFeatureCard'
import { roomsStatusText } from './roomsStatusText'

export interface RoomFilesTabProps {
  /** Undefined while reading. */
  files?: RoomFile[]
  failed: boolean
  status: OperationStatus
  refreshing: boolean
  onRefresh: () => void
  /** Opens a file's sheet; none where files can't be opened. */
  onOpenFile?: (file: RoomFile) => void
  /** Offers "Add a file"; none where the member can't post one. */
  onAddFile?: () => void
}

/** Newest first; a file with no time goes last, in the host's order. */
export const newestFirst = (files: RoomFile[]): RoomFile[] =>
  files
    .map((file, at) => ({ file, at, time: file.sharedAt ? Date.parse(file.sharedAt) : NaN }))
    .sort((a, b) => {
      const [x, y] = [Number.isNaN(a.time) ? -Infinity : a.time, Number.isNaN(b.time) ? -Infinity : b.time]
      return x === y ? a.at - b.at : y - x
    })
    .map(({ file }) => file)

export const RoomFilesTab: React.FC<RoomFilesTabProps> = ({
  files,
  failed,
  status,
  refreshing,
  onRefresh,
  onOpenFile,
  onAddFile,
}) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const sorted = useMemo(() => (files ? newestFirst(files) : []), [files])
  const unavailable = roomsStatusText(t, status, 'listFiles')
  const styles = StyleSheet.create({
    list: { paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    centered: { paddingVertical: 16 },
    footer: { gap: 12, paddingTop: 12 },
  })

  const empty = isComingSoon(status) ? (
    <RoomFeatureCard status={status} feature="files" />
  ) : unavailable ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomFilesUnavailable')}>
      {unavailable}
    </ThemedText>
  ) : failed && !files ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomFilesFailed')}>
      {t('Rooms.FilesFailed')}
    </ThemedText>
  ) : files ? (
    <ThemedText style={[styles.muted, styles.centered]} testID={testIdWithKey('RoomFilesNone')}>
      {t('Rooms.FilesNone')}
    </ThemedText>
  ) : (
    <ActivityIndicator
      style={styles.centered}
      color={ColorPalette.brand.primary}
      accessibilityLabel={t('Rooms.Reading')}
      testID={testIdWithKey('RoomFilesReading')}
    />
  )

  return (
    <FlatList
      testID={testIdWithKey('RoomFiles')}
      data={unavailable ? [] : sorted}
      keyExtractor={(file) => file.fileId}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => <FileRow file={item} onPress={onOpenFile} />}
      ListEmptyComponent={empty}
      refreshControl={
        unavailable ? undefined : (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ColorPalette.brand.primary} />
        )
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {unavailable ? null : (
            <ThemedText variant="caption" style={styles.muted} testID={testIdWithKey('RoomFilesCaution')}>
              {t('Rooms.FilesCaution')}
            </ThemedText>
          )}
          {onAddFile ? (
            <Button
              title={t('Rooms.FilesAdd')}
              buttonType={ButtonType.Secondary}
              onPress={onAddFile}
              testID={testIdWithKey('RoomFilesAdd')}
            />
          ) : null}
        </View>
      }
    />
  )
}

export default RoomFilesTab
