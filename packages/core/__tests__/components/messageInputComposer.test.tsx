import React from 'react'
import { Composer } from 'react-native-gifted-chat'

import { StyleSheet, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native'
// gifted-chat's own touchable, the element a press lands on. Coupled to gifted's internals on purpose: asserting on the
// props we pass it stays green while gifted ignores them (wrapperStyle, min/maxComposerHeight, C2's simulator check).
import { TouchableOpacity } from 'react-native-gifted-chat/lib/components/TouchableOpacity'
import { render } from '@testing-library/react-native'

import {
  COMPOSER_BUTTON,
  COMPOSER_LINE,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  renderComposer,
  renderSend,
} from '../../src/components/chat/MessageInput'

/** What these tests read off gifted-chat's Composer and Send elements: typed once here, so each read is checked. */
type ComposerElement = React.ReactElement<{
  textInputProps: Omit<TextInputProps, 'style'> & { ref?: unknown; style: StyleProp<TextStyle>[] }
}>
type SendElement = React.ReactElement<{
  isSendButtonAlwaysVisible?: boolean
  children: React.ReactElement<{ style: ViewStyle }>
}>

/**
 * gifted-chat's composer TextInput is fully controlled (value={text}), and the
 * wiring that feeds that state back — onChangeText, plus the input ref — is
 * handed to it inside textInputProps. renderComposer adds its own entries to
 * that object, so it has to MERGE: an object literal replacing it leaves a
 * controlled input with no change handler, which reverts every keystroke to ''
 * and makes the composer silently unusable (device 2026-08-26).
 */
describe('renderComposer textInputProps', () => {
  const theme = { inputText: {} }

  const composerFrom = (props: Record<string, unknown>, disabled = false, withTheme: object = theme) => {
    const tree = renderComposer(props, withTheme, 'Type here', disabled) as React.ReactElement
    const children = React.Children.toArray((tree.props as { children: React.ReactNode }).children)
    // Found by type, not position: the field holds the composer and, optionally, an accessory (the emoji button).
    return children.find((child) => React.isValidElement(child) && child.type === Composer) as ComposerElement
  }

  test("keeps gifted-chat's onChangeText and ref", () => {
    const onChangeText = jest.fn()
    const ref = { current: null }
    const composer = composerFrom({ text: 'hi', textInputProps: { onChangeText, ref } })

    expect(composer.props.textInputProps.onChangeText).toBe(onChangeText)
    expect(composer.props.textInputProps.ref).toBe(ref)
  })

  test('still applies its own input props alongside them', () => {
    const onChangeText = jest.fn()
    const composer = composerFrom({ textInputProps: { onChangeText } })

    // gifted-chat names the input by its placeholder; a label of the same words made VoiceOver say it twice (C2).
    expect(composer.props.textInputProps.accessibilityLabel).toBe('')
    // The theme's cap for text in the composer (C2 raised it from 1.2).
    expect(composer.props.textInputProps.maxFontSizeMultiplier).toBe(1.5)
    expect(composer.props.textInputProps.editable).toBe(true)
  })

  test('disabled turns the input read-only without dropping the wiring', () => {
    const onChangeText = jest.fn()
    const composer = composerFrom({ textInputProps: { onChangeText } }, true)

    expect(composer.props.textInputProps.editable).toBe(false)
    expect(composer.props.textInputProps.onChangeText).toBe(onChangeText)
  })

  test('tolerates a caller that passes no textInputProps at all', () => {
    const composer = composerFrom({ text: '' })

    expect(composer.props.textInputProps.editable).toBe(true)
    expect(composer.props.textInputProps.onChangeText).toBeUndefined()
  })

  /**
   * v3's Composer reads styling, placeholder and placeholder colour ONLY from
   * textInputProps — the top-level textInputStyle / placeholder /
   * placeholderTextColor props are v2 API and are silently dropped. Composer
   * applies textInputProps.style last, which is what lets the theme colour
   * beat its scheme default of textInput_dark: { color: '#fff' } against the
   * toolbar's hardcoded white background.
   */
  test('carries the theme text colour through textInputProps.style', () => {
    const themed = { inputText: { color: '#010B13', fontWeight: '500' } }
    const composer = composerFrom({ textInputProps: {} }, false, themed)

    const styles = composer.props.textInputProps.style
    expect(Array.isArray(styles)).toBe(true)
    expect(styles[0]).toMatchObject({ color: '#010B13', fontWeight: '500' })
  })

  test('passes placeholder and its colour through textInputProps', () => {
    const composer = composerFrom({ textInputProps: {} })

    expect(composer.props.textInputProps.placeholder).toBe('Type here')
    // #666666 on the field's white is 5.7:1; #888888 was 3.5:1, under the 4.5:1 minimum (C2).
    expect(composer.props.textInputProps.placeholderTextColor).toBe('#666666')
  })

  // gifted-chat 3.3.3 sizes nothing on native: the TextInput grows with its text. A flex on it took the field's
  // height instead, so it scrolled at one line's height (C2's simulator check); it is bounded here instead.
  test('the input grows with its text, from one line to five, and is never stretched to the field', () => {
    const style = StyleSheet.flatten(composerFrom({ textInputProps: {} }).props.textInputProps.style)

    expect(style.flex).toBeUndefined()
    expect(style).toMatchObject({ minHeight: COMPOSER_MIN_HEIGHT, maxHeight: COMPOSER_MAX_HEIGHT })
    expect(COMPOSER_MAX_HEIGHT - COMPOSER_MIN_HEIGHT).toBe(4 * COMPOSER_LINE)
  })

  test('a caller-supplied style still wins over ours', () => {
    const callerStyle = { color: 'rebeccapurple' }
    const composer = composerFrom({ textInputProps: { style: callerStyle } })

    const styles = composer.props.textInputProps.style
    expect(styles[styles.length - 1]).toBe(callerStyle)
  })
})

/**
 * gifted-chat v3 ignores unknown props silently rather than erroring, so a v2
 * prop name is invisible until someone notices the behaviour never happened.
 * Pin the v3 names for Send (Send.d.ts accepts: children, containerStyle,
 * isSendButtonAlwaysVisible, isTextOptional, label, sendButtonProps, text,
 * textStyle — note there is no `alwaysShowSend` and no `disabled`).
 */
describe('renderSend uses v3 prop names', () => {
  const theme = { sendEnabled: '#123456' }

  test('asks for an always-visible send button by its v3 name', () => {
    const send = renderSend({ text: 'hi' }, theme) as SendElement

    expect(send.props.isSendButtonAlwaysVisible).toBe(true)
    expect(send.props).not.toHaveProperty('alwaysShowSend')
  })

  test('does not pass a `disabled` prop v3 would ignore', () => {
    const send = renderSend({ text: '' }, theme) as SendElement

    // v3's Send already refuses to fire on empty text; `disabled` was v2-era
    // and silently dropped, so passing it only misleads the reader.
    expect(send.props).not.toHaveProperty('disabled')
  })

  // gifted-chat sizes Send's touchable by its child, the 36-point circle, and its container takes no touches: Send
  // measured 36 dp on Android (C2's simulator check). The touchable itself fills the square.
  test('the touchable itself is the full tap target', () => {
    const tree = render(<>{renderSend({ text: 'hi', onSend: () => undefined }, theme)}</>)
    const touchable = tree.UNSAFE_getByType(TouchableOpacity)
    const style = StyleSheet.flatten((touchable.props as { style?: StyleProp<ViewStyle> }).style)

    expect(style).toMatchObject({ width: COMPOSER_BUTTON, height: COMPOSER_BUTTON })
  })

  test('still styles the button from the theme', () => {
    const enabled = renderSend({ text: 'hi' }, theme) as SendElement
    const empty = renderSend({ text: '' }, theme) as SendElement

    expect(enabled.props.children.props.style.backgroundColor).toBe('#123456')
    expect(empty.props.children.props.style.backgroundColor).toBe('#E0E0E0')
  })
})
