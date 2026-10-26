import React from 'react'
import { Platform, Pressable, View } from 'react-native'
import { Composer, InputToolbar, Send } from 'react-native-gifted-chat'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { testIdWithKey } from '../../utils/testable'

import { ChatIds } from './Chat.ids'

/**
 * The composer (chat redesign C2, Option A): a plain "+" outside on the left, a 40-point pill field with the emoji
 * button inside it on the right, and on the right Camera while the field is empty, Send once there is text. Buttons
 * are 44 points (48 dp on Android) whatever their glyph.
 */

/** A button's square: the platform's minimum tap target. */
export const COMPOSER_BUTTON = Platform.select({ android: 48, default: 44 }) as number
/** The field at one line; it grows a line at a time to {@link COMPOSER_MAX_LINES}, then scrolls. */
export const COMPOSER_FIELD = 40
export const COMPOSER_LINE = 21
export const COMPOSER_MAX_LINES = 5
/** The text's padding inside the field: one line plus this is the field less its 1-point edge (40 - 2). */
const COMPOSER_PAD_TOP = 8
const COMPOSER_PAD_BOTTOM = 9
/**
 * The TextInput's own height bounds. gifted-chat 3.3.3 sizes nothing on native (its minComposerHeight /
 * maxComposerHeight are v2 props it no longer reads): the multiline TextInput grows with its text, so the bounds are
 * set on it here, and past five lines it scrolls.
 */
export const COMPOSER_MIN_HEIGHT = COMPOSER_FIELD - 2
export const COMPOSER_MAX_HEIGHT = COMPOSER_LINE * COMPOSER_MAX_LINES + COMPOSER_PAD_TOP + COMPOSER_PAD_BOTTOM

/** A touchable that fills a button's square, its content centred. */
export const TAP_TARGET = {
  width: COMPOSER_BUTTON,
  height: COMPOSER_BUTTON,
  alignItems: 'center',
  justifyContent: 'center',
} as const

const FIELD_EDGE = '#CFCACF'
const ICON = '#4A4A4A'

export const renderInputToolbar = (props: any, _theme: any) => (
  <InputToolbar
    {...props}
    containerStyle={{
      backgroundColor: '#F5F5F5', // Match chat background
      borderTopWidth: 0,
      paddingHorizontal: 6,
      paddingTop: 6,
      paddingBottom: 8,
    }}
    // The row itself is bare: the pill is the field, not the whole bar.
    primaryStyle={{
      alignItems: 'flex-end',
      backgroundColor: 'transparent',
      marginHorizontal: 0,
    }}
  />
)

/** `accessory` is drawn inside the field, after the text (the emoji button). */
export const renderComposer = (
  props: any,
  theme: any,
  placeholder: string,
  disabled?: boolean,
  accessory?: React.ReactNode
) => (
  // The field: a pill with a visible edge, so it reads as one even holding only an emoji and no caret (272).
  <View
    style={{
      flex: 1,
      minHeight: COMPOSER_FIELD,
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: '#FFFFFF',
      borderRadius: COMPOSER_FIELD / 2,
      borderWidth: 1,
      borderColor: FIELD_EDGE,
      paddingLeft: 14,
      marginHorizontal: 2,
    }}
    testID={testIdWithKey(ChatIds.composerField)}
  >
    {/*
     * Everything the TextInput needs goes through textInputProps, MERGED into
     * what gifted-chat passed down — never replacing it.
     *
     * gifted-chat v3's Composer destructures only ({ text, textInputProps }).
     * Top-level textInputStyle / placeholder / placeholderTextColor props are
     * v2 API and are silently ignored, and textInputProps carries two separate
     * things we must not drop:
     *
     *  - onChangeText and the input ref, the only path back to the controlled
     *    value={text}. Replacing the object left a controlled input with no
     *    change handler, so every keystroke reverted to '' and the keyboard
     *    re-asserted sentence capitalisation on the emptied field.
     *  - style, which Composer applies LAST and so is the only way to beat its
     *    own scheme-dependent default. That default is
     *    textInput_dark: { color: '#fff' }, and the toolbar above hardcodes a
     *    white background, so in dark mode the text was white on white —
     *    invisible but present (device 2026-08-26).
     */}
    <Composer
      {...props}
      textInputProps={{
        ...props.textInputProps,
        // gifted-chat already names the input by its placeholder; naming it again made VoiceOver say "Message
        // Message" (simulator check on C2), so the label stays empty and the placeholder is read once.
        accessibilityLabel: '',
        maxFontSizeMultiplier: 1.5,
        editable: !disabled,
        placeholder,
        placeholderTextColor: '#666666',
        style: [
          {
            ...theme.inputText,
            // No flex: a flex child takes the field's height and scrolls inside it instead of growing (C2's
            // simulator check: 44 points at every line). Its own text sizes it, within these bounds.
            minHeight: COMPOSER_MIN_HEIGHT,
            maxHeight: COMPOSER_MAX_HEIGHT,
            fontSize: 16,
            lineHeight: COMPOSER_LINE,
            paddingTop: COMPOSER_PAD_TOP,
            paddingBottom: COMPOSER_PAD_BOTTOM,
            paddingHorizontal: 0,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 4,
          },
          props.textInputProps?.style,
        ],
      }}
    />
    {accessory}
  </View>
)

/** The emoji button inside the field: 38 points, so the field keeps its 40-point height. */
export const ComposerEmojiButton: React.FC<{ label: string; disabled?: boolean; onPress: () => void }> = ({
  label,
  disabled,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    hitSlop={4}
    style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
    accessibilityRole="button"
    accessibilityLabel={label}
    testID={testIdWithKey(ChatIds.composerEmoji)}
  >
    <Icon name="emoticon-happy-outline" size={22} color={ICON} />
  </Pressable>
)

/**
 * Send once the field holds text; until then, Camera when the chat takes photos (`camera`), else Send greyed out.
 * Camera is disabled whenever the field is (offline, or a VRC exchange under way), as the emoji button is.
 * gifted-chat's Send refuses to fire on empty text by itself (onSend runs only when trimmedText.length ||
 * isTextOptional), so the greyed Send needs no guard of its own.
 */
export const renderSend = (
  props: any,
  theme: any,
  camera?: { label: string; onPress: () => void; disabled?: boolean }
) => {
  const hasText = !!props.text?.trim()
  if (!hasText && camera)
    return (
      <Pressable
        onPress={camera.onPress}
        disabled={camera.disabled}
        style={{
          width: COMPOSER_BUTTON,
          height: COMPOSER_BUTTON,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: camera.disabled ? 0.4 : 1,
        }}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!camera.disabled }}
        accessibilityLabel={camera.label}
        testID={testIdWithKey(ChatIds.composerCamera)}
      >
        <Icon name="camera-outline" size={24} color={ICON} />
      </Pressable>
    )
  return (
    <Send
      {...props}
      // v3 prop name. `alwaysShowSend` was v2 and is silently ignored; `disabled` is not part of v3's Send at all.
      isSendButtonAlwaysVisible={true}
      containerStyle={{
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 0,
        marginBottom: 0,
        height: COMPOSER_BUTTON,
        width: COMPOSER_BUTTON,
      }}
      // The touchable itself fills the square. gifted-chat sizes it by its child (the 36-point circle), and the
      // container above takes no touches: Send measured 36 dp on Android (C2's simulator check).
      sendButtonProps={{ style: TAP_TARGET }}
    >
      <View
        style={{
          backgroundColor: hasText ? theme.sendEnabled : '#E0E0E0',
          borderRadius: 18,
          width: 36,
          height: 36,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        // No testID here: the accessible touchable around it folds this view away on iOS, so an id on it is
        // unreachable there (C2's simulator check). Send is found by gifted-chat's GC_SEND_TOUCHABLE, as the pair
        // runner's sendChat does; an id passed in sendButtonProps would replace that one.
      >
        <Icon name="arrow-up" size={22} color="white" />
      </View>
    </Send>
  )
}
