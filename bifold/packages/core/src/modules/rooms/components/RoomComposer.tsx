/**
 * A room's composer: the chat's slim composer, drawn to the same measures (a 40-point pill field that grows a line
 * at a time to five, then scrolls, and a 44-point Send) with the theme's colours. The chat's own composer leaves are
 * gifted-chat renderers and need its state, so a room, whose list is its own, uses this plain field instead.
 *
 * Above the field, who the member posts as: a room's audience differs from a one-to-one chat's, and the identity
 * differs per room, so it is in view at the moment of posting, not only in the header.
 *
 * Where the member may not post, the composer is replaced by the reason, in the rooms screens' usual words
 * ("You can't post here", "Coming soon"), never by a field that would fail on Send.
 *
 * @module rooms/components/RoomComposer
 */
import React, { useState } from 'react'
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
import { MAX_POST_LENGTH } from '../useRoomSend'

export interface RoomComposerProps {
  /** Sends the text; false when nothing was sent (the field then keeps it). */
  onSend: (text: string) => boolean
  /** Why the member can't post here; the composer shows this instead of a field. */
  unavailable?: string
  /** Who the member posts as, in words ("…negative-weird"). */
  postingAs?: string
}

export const RoomComposer: React.FC<RoomComposerProps> = ({ onSend, unavailable, postingAs }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [text, setText] = useState('')
  const hasText = text.trim().length > 0
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
      backgroundColor: hasText ? ColorPalette.brand.primary : ColorPalette.grayscale.lightGrey,
    },
    unavailable: { padding: 16, color: ColorPalette.grayscale.mediumGrey, textAlign: 'center' },
    postingAs: {
      paddingHorizontal: 22,
      paddingTop: 6,
      fontSize: 12,
      color: ColorPalette.grayscale.mediumGrey,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
  })

  if (unavailable)
    return (
      <View style={{ backgroundColor: ColorPalette.brand.secondaryBackground }}>
        <ThemedText style={styles.unavailable} testID={testIdWithKey('RoomComposerUnavailable')}>
          {unavailable}
        </ThemedText>
      </View>
    )

  const send = () => {
    if (onSend(text)) setText('')
  }

  return (
    <>
      {postingAs ? (
        <ThemedText style={styles.postingAs} numberOfLines={1} testID={testIdWithKey('RoomComposerPostingAs')}>
          {t('Rooms.PostingAs', { who: postingAs, interpolation: { escapeValue: false } })}
        </ThemedText>
      ) : null}
      <View style={styles.bar} testID={testIdWithKey('RoomComposer')}>
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
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
          disabled={!hasText}
          style={TAP_TARGET}
          accessibilityRole="button"
          accessibilityLabel={t('Rooms.Send')}
          accessibilityState={{ disabled: !hasText }}
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
