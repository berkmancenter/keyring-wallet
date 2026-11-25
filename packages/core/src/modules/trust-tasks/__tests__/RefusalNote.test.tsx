/**
 * A card the vetter's phone refused, or a session the applicant's phone
 * refused, says so on screen with the reason in words (keyring-bifold#130).
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { VettingCardRefusal, VettingSessionRefusal } from '../module/vtiVetting'
import { RefusalNote } from '../screens/RefusalNote'

const CARD: VettingCardRefusal[] = [
  'sessionClosed',
  'malformed',
  'audience',
  'publisher',
  'community',
  'challenge',
  'domain',
  'expired',
  'outlivesSession',
  'proof',
  'missingClaim',
  'commitment',
]
const SESSION: VettingSessionRefusal[] = ['malformed', 'community', 'expired', 'unknownRequest', 'alreadyAttested']

const show = (kind: 'Card' | 'Session', refusal?: string) =>
  render(
    <BasicAppContext>
      <RefusalNote kind={kind} refusal={refusal} style={{}} errorStyle={{}} />
    </BasicAppContext>
  )

describe('a refused card or session', () => {
  test("the vetter's desk says the card was not accepted, and why", () => {
    const tree = show('Card', 'commitment')
    expect(tree.getByTestId(testIdWithKey('VettingCardRefused'))).toHaveTextContent(/Vetting\.CardRefused/)
    expect(tree.getByTestId(testIdWithKey('VettingCardRefusedReason'))).toHaveTextContent(
      'Vetting.CardRefusedReason.commitment'
    )
  })

  test("the applicant's request says the session was not accepted, and why", () => {
    const tree = show('Session', 'unknownRequest')
    expect(tree.getByTestId(testIdWithKey('VettingSessionRefused'))).toHaveTextContent(/Vetting\.SessionRefused/)
    expect(tree.getByTestId(testIdWithKey('VettingSessionRefusedReason'))).toHaveTextContent(
      'Vetting.SessionRefusedReason.unknownRequest'
    )
  })

  test('every reason has words in each language', () => {
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../../localization/${lang}/${lang}.json`)
      expect(typeof copy.Vetting.CardRefused).toBe('string')
      expect(typeof copy.Vetting.SessionRefused).toBe('string')
      for (const r of CARD) expect(typeof copy.Vetting.CardRefusedReason[r]).toBe('string')
      for (const r of SESSION) expect(typeof copy.Vetting.SessionRefusedReason[r]).toBe('string')
    }
  })

  test('nothing refused shows nothing', () => {
    expect(show('Card').queryByTestId(testIdWithKey('VettingCardRefused'))).toBeNull()
    expect(show('Session').queryByTestId(testIdWithKey('VettingSessionRefused'))).toBeNull()
  })
})
