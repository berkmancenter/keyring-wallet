/**
 * The day pill: its words in the app's language from our own locale files, a header for a screen reader, and nothing
 * for a day gifted-chat has not worked out yet.
 */
import { render } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'
import { View } from 'react-native'

import { ChatIds } from '../../../src/components/chat/Chat.ids'
import { DayPill, renderDayPill } from '../../../src/components/chat/DayPill'
import fr from '../../../src/localization/fr/fr.json'
import { testIdWithKey } from '../../../src/utils/testable'

const mockI18n = i18next.createInstance()
mockI18n.init({ lng: 'fr', resources: { fr: { translation: fr } }, initImmediate: false })
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockI18n.t.bind(mockI18n), i18n: mockI18n }),
}))

describe('the day pill', () => {
  const day = new Date(2024, 0, 1, 9, 0)
  const pill = testIdWithKey(ChatIds.dayPill)

  test('in the app’s language, from the locale files (French here)', () => {
    expect(render(<DayPill date={day} />).getByTestId(pill).props.children).toBe('1 janv. 2024')
  })

  test('as gifted-chat’s renderDay it is the same pill', () => {
    const tree = render(<View>{renderDayPill({ createdAt: day.getTime() })}</View>)
    expect(tree.getByTestId(pill).props.children).toBe('1 janv. 2024')
  })

  test('nothing before gifted-chat knows the day (the control above shows one)', () => {
    const tree = render(<View testID="host">{renderDayPill({})}</View>)
    expect(tree.getByTestId('host')).toBeTruthy()
    expect(tree.queryByTestId(pill)).toBeNull()
  })

  test('a screen reader can move from day to day', () => {
    expect(render(<DayPill date={day} />).getByTestId(pill).props.accessibilityRole).toBe('header')
  })
})
