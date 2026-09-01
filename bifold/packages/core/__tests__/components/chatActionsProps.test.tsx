import React from 'react'

import { renderActions } from '../../src/components/chat/ChatActions'

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

  test('styles the wrapper by its v3 name', () => {
    const el = renderActions({}, theme, actions) as React.ReactElement

    expect(el.props.wrapperStyle).toMatchObject({ width: 40, height: 40 })
    expect(el.props).not.toHaveProperty('containerStyle')
  })

  test('sets the action-sheet tint by its v3 name', () => {
    const el = renderActions({}, theme, actions) as React.ReactElement

    expect(el.props.actionSheetOptionTintColor).toBe('#222222')
    expect(el.props).not.toHaveProperty('optionTintColor')
  })

  test('renders nothing when there are no actions', () => {
    expect(renderActions({}, theme, undefined)).toBeNull()
  })
})
