/**
 * A file a post carries, as a chip under its words: an icon for its type, its name, and the type and size the
 * sharer gave it. Tapping it opens the attachment sheet; nothing is downloaded until the member asks there. A file
 * still on its way up has no sheet yet: its chip is not a button.
 *
 * @module rooms/components/RoomFileChip
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View, type ViewStyle } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'
import type { RoomFile } from '../types'

import { fileIcon, fileSizeText, fileTypeText } from './fileWords'
import { roomHandle } from './RoomRow'

export const RoomFileChip: React.FC<{
  file: RoomFile
  ink: string
  edge: string
  onPress?: (file: RoomFile) => void
}> = ({ file, ink, edge, onPress }) => {
  const { t, i18n } = useTranslation()
  const line = [fileTypeText(file), file.size !== undefined ? fileSizeText(t, file.size, i18n.language) : undefined]
    .filter(Boolean)
    .join(' · ')
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: edge,
  }
  const label = line ? `${file.name}, ${line}` : String(file.name)
  const testID = testIdWithKey(`RoomFileChip_${roomHandle(file.fileId)}`)
  const content = (
    <>
      <Icon name={fileIcon(file)} size={26} color={ink} />
      <View style={{ flexShrink: 1 }}>
        <ThemedText style={{ color: ink, fontWeight: '600' }} numberOfLines={1} ellipsizeMode="middle">
          {file.name}
        </ThemedText>
        {line ? <ThemedText style={{ color: ink, fontSize: 12 }}>{line}</ThemedText> : null}
      </View>
    </>
  )
  if (!onPress)
    return (
      <View style={style} accessible accessibilityLabel={label} testID={testID}>
        {content}
      </View>
    )
  return (
    <Pressable
      onPress={() => onPress(file)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('Rooms.FileOpenHint')}
      testID={testID}
      style={style}
    >
      {content}
    </Pressable>
  )
}

export default RoomFileChip
