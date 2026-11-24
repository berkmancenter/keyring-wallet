import { render } from '@testing-library/react-native'
import React from 'react'

import { testIdWithKey } from '../../../utils/testable'
import { RoomQuote } from '../components/RoomQuote'
import { toInertText } from '../inertText'

const text = toInertText('Can we move the reading group to Thursday?')

describe('RoomQuote', () => {
  test("a reply shows who wrote the target and the target's words, in at most two lines", () => {
    const { getByTestId } = render(<RoomQuote mine={false} target={{ available: true, author: 'Noor Haddad', text }} />)
    expect(getByTestId(testIdWithKey('RoomQuoteName')).props.children).toBe('Noor Haddad')
    const words = getByTestId(testIdWithKey('RoomQuoteText'))
    expect(words.props.children).toBe(text)
    expect(words.props.numberOfLines).toBe(2)
  })

  test('a target that is not available says so where the name goes, and shows nothing of it', () => {
    const { getByTestId, queryByTestId } = render(<RoomQuote mine target={{ available: false }} />)
    expect(getByTestId(testIdWithKey('RoomQuoteName')).props.children).toBe('Rooms.QuoteUnavailable')
    expect(queryByTestId(testIdWithKey('RoomQuoteText'))).toBeNull()
  })

  test('a note is called a note and shows its title, whoever wrote it', () => {
    const title = toInertText('Onboarding decisions')
    const { getByTestId } = render(
      <RoomQuote mine={false} target={{ available: true, note: true, author: 'Ines Costa', text: title }} />
    )
    expect(getByTestId(testIdWithKey('RoomQuoteName')).props.children).toBe('Rooms.QuoteNote')
    expect(getByTestId(testIdWithKey('RoomQuoteText')).props.children).toBe(title)
  })

  test('a room that shows no authors says a member, never Unknown or nothing', () => {
    const { getByTestId } = render(<RoomQuote mine={false} target={{ available: true, text }} />)
    expect(getByTestId(testIdWithKey('RoomQuoteName')).props.children).toBe('Rooms.QuoteNoAuthor')
  })

  test('an edited target says so only when marked, in words for whose reply it is', () => {
    const target = { available: true as const, author: 'Ines Costa', text }
    const plain = render(<RoomQuote mine target={target} />)
    expect(plain.queryByTestId(testIdWithKey('RoomQuoteChanged'))).toBeNull()
    const mine = render(<RoomQuote mine target={{ ...target, changed: true }} />)
    expect(mine.getByTestId(testIdWithKey('RoomQuoteChanged')).props.children).toBe('Rooms.QuoteChangedMine')
    const theirs = render(<RoomQuote mine={false} target={{ ...target, changed: true }} />)
    expect(theirs.getByTestId(testIdWithKey('RoomQuoteChanged')).props.children).toBe('Rooms.QuoteChanged')
  })
})
