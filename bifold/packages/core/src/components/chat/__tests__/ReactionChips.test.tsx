import { fireEvent, render } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'
import { StyleSheet } from 'react-native'

import { CHIP_MAX_WIDTH, ReactionChips, reactionChipsLabel } from '../ReactionChips'

const long = 'thanks for organising all of this, really appreciated by everyone'

describe('ReactionChips', () => {
  test('a count shows only for more than one person', () => {
    const { queryByText } = render(
      <ReactionChips
        isMe={false}
        label="l"
        chips={[
          { value: '👍', count: 5, mine: true },
          { value: '❤️', count: 1, mine: false },
        ]}
      />
    )
    expect(queryByText('5')).toBeTruthy()
    expect(queryByText('1')).toBeNull()
  })

  test("the phone's own chip is marked, and another's is not", () => {
    const { getByText } = render(
      <ReactionChips
        isMe={false}
        label="l"
        chips={[
          { value: '👍', count: 1, mine: true },
          { value: '❤️', count: 1, mine: false },
        ]}
      />
    )
    const fill = (value: string) => StyleSheet.flatten(getByText(value).parent?.parent?.props.style).backgroundColor
    expect(fill('👍')).toBe('#E8E0EC')
    expect(fill('❤️')).toBe('#FFFFFF')
  })

  test('a long value stays on one line, in a chip of limited width, and the row wraps', () => {
    const { getByText, getByTestId } = render(
      <ReactionChips isMe={false} label="l" testID="row" chips={[{ value: long, count: 1, mine: false }]} />
    )
    expect(getByText(long).props.numberOfLines).toBe(1)
    expect(StyleSheet.flatten(getByText(long).parent?.parent?.props.style).maxWidth).toBe(CHIP_MAX_WIDTH)
    expect(StyleSheet.flatten(getByTestId('row').props.style).flexWrap).toBe('wrap')
  })

  test("under the phone's own message they sit on the right", () => {
    const { getByTestId } = render(<ReactionChips isMe label="l" testID="row" chips={[]} />)
    expect(StyleSheet.flatten(getByTestId('row').props.style).justifyContent).toBe('flex-end')
  })

  test('a row with no handler is only read; with one, a tap reaches it', () => {
    const chips = [{ value: '👍', count: 1, mine: false }]
    const read = render(<ReactionChips isMe={false} label="said" testID="row" chips={chips} />)
    expect(read.getByTestId('row').props.accessibilityLabel).toBe('said')
    expect(read.getByTestId('row').props.onPress).toBeUndefined()
    const onPress = jest.fn()
    const tapped = render(<ReactionChips isMe={false} label="said" testID="row" chips={chips} onPress={onPress} />)
    fireEvent.press(tapped.getByTestId('row'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  test('the spoken label keeps a value as written, and says which is yours', () => {
    const t = jest.fn((key: string, options: { emoji: string; interpolation: { escapeValue: boolean } }) => {
      expect(options.interpolation.escapeValue).toBe(false)
      return `${key}:${options.emoji}`
    }) as unknown as TFunction
    expect(
      reactionChipsLabel(t, [
        { value: "it's a/b", count: 1, mine: false },
        { value: '👍', count: 2, mine: true },
      ])
    ).toBe("Chat.ReactionThem:it's a/b, Chat.ReactionYou:👍")
  })
})
