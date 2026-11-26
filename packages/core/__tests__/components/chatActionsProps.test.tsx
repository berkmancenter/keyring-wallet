import { render } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
// gifted-chat's own touchable, the element a press lands on. Coupled to gifted's internals on purpose: asserting on the
// props we pass it stays green while gifted ignores them (wrapperStyle was 44 while the target was 40, C2's check).
import { TouchableOpacity } from 'react-native-gifted-chat/lib/components/TouchableOpacity'

import { renderActions } from '../../src/components/chat/ChatActions'
import { COMPOSER_BUTTON } from '../../src/components/chat/MessageInput'

/**
 * gifted-chat v3's Actions accepts (Actions.d.ts): action,
 * actionSheetOptionTintColor, actions, buttonStyle, icon, iconTextStyle,
 * title, wrapperStyle.
 *
 * It does NOT accept `containerStyle` or `optionTintColor` — both are v2
 * names. v3 ignores unknown props silently instead of erroring, so passing
 * the old names left the action button unstyled with nothing to indicate it.
 */
describe('renderActions uses v3 prop names', () => {
  const theme = { options: '#111111', optionsText: '#222222' }
  const actions = [{ text: 'Send proof request', icon: () => null, onPress: () => undefined }]

  // A full tap target (44 pt, 48 dp on Android), the "+" no longer a boxed 40-point icon (chat redesign C2). Asserted
  // on the touchable itself: with an icon of our own, v3 never draws the wrapper, so a wrapperStyle of 44 still left
  // a 40-point target (C2's simulator check).
  test('the touchable itself is the full tap target, with none of its own padding', () => {
    const tree = render(<>{renderActions({ onPressActionButton: () => undefined }, theme, actions)}</>)
    const touchable = tree.UNSAFE_getByType(TouchableOpacity)
    const style = StyleSheet.flatten((touchable.props as { style?: StyleProp<ViewStyle> }).style)

    expect(style).toMatchObject({ width: COMPOSER_BUTTON, height: COMPOSER_BUTTON })
    expect([style.paddingLeft, style.paddingRight, style.paddingVertical]).toEqual([0, 0, 0])
  })

  test('passes no v2 container style', () => {
    const el = renderActions({}, theme, actions) as React.ReactElement
    expect(el.props).not.toHaveProperty('containerStyle')
  })

  test('sets the action-sheet tint by its v3 name', () => {
    const el = renderActions({}, theme, actions) as React.ReactElement<{ actionSheetOptionTintColor?: string }>

    expect(el.props.actionSheetOptionTintColor).toBe('#222222')
    expect(el.props).not.toHaveProperty('optionTintColor')
  })

  test('renders nothing when there are no actions', () => {
    expect(renderActions({}, theme, undefined)).toBeNull()
  })
})
