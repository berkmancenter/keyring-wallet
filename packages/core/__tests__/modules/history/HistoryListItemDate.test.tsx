/**
 * A history card's date, in the app's language: it was forced to US English ("en-US"); these words are ours
 * (utils/localDay.ts).
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import HistoryListItem from '../../../src/modules/history/ui/components/HistoryListItem'
import { BasicAppContext } from '../../helpers/app'
import { speak } from '../../helpers/appLanguage'

const item = { content: { createdAt: new Date(2026, 9, 15, 16, 1) } } as never

describe('a history card’s date', () => {
  test('French and Portuguese', async () => {
    await speak('fr')
    expect(
      render(
        <BasicAppContext>
          <HistoryListItem item={item} />
        </BasicAppContext>
      ).getByText('15 oct. 2026')
    ).toBeTruthy()
    await speak('pt-BR')
    expect(
      render(
        <BasicAppContext>
          <HistoryListItem item={item} />
        </BasicAppContext>
      ).getByText('15 de out. de 2026')
    ).toBeTruthy()
    await speak('en')
  })
})
