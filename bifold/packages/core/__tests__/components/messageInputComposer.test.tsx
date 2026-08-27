import { renderComposer } from '../../src/components/chat/MessageInput'

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

  const composerFrom = (props: Record<string, unknown>, disabled = false) => {
    const tree = renderComposer(props, theme, 'Type here', disabled) as React.ReactElement
    const children = (tree.props as { children: React.ReactElement[] }).children
    // [icon, composer]
    return children[1]
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

    expect(composer.props.textInputProps.accessibilityLabel).toBe('')
    expect(composer.props.textInputProps.maxFontSizeMultiplier).toBe(1.2)
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
    const tree = renderComposer({ textInputProps: {} }, themed, 'Type here', false) as React.ReactElement
    const composer = (tree.props as { children: React.ReactElement[] }).children[1]

    const styles = composer.props.textInputProps.style
    expect(Array.isArray(styles)).toBe(true)
    expect(styles[0]).toMatchObject({ color: '#010B13', fontWeight: '500' })
  })

  test('passes placeholder and its colour through textInputProps', () => {
    const composer = composerFrom({ textInputProps: {} })

    expect(composer.props.textInputProps.placeholder).toBe('Type here')
    expect(composer.props.textInputProps.placeholderTextColor).toBe('#888888')
  })

  test('a caller-supplied style still wins over ours', () => {
    const callerStyle = { color: 'rebeccapurple' }
    const composer = composerFrom({ textInputProps: { style: callerStyle } })

    const styles = composer.props.textInputProps.style
    expect(styles[styles.length - 1]).toBe(callerStyle)
  })
})
