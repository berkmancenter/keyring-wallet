/**
 * A document refused unread says so on screen, with the reason in words
 * (keyring-bifold#128): on the applicant's request card for a refused
 * acceptance or session, on the vetter's desk for a refused card.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { PeerDocumentRefusal } from '../module/vtiVetting'
import { EnvelopeRefusalNote } from '../screens/EnvelopeRefusalNote'

const REASONS: PeerDocumentRefusal[] = [
  'malformed',
  'typeMismatch',
  'issuerNotSender',
  'unsigned',
  'proof',
  'wrongSigner',
]

const show = (side: 'applicant' | 'vetter', refusal?: PeerDocumentRefusal) =>
  render(
    <BasicAppContext>
      <EnvelopeRefusalNote refusal={refusal} side={side} style={{}} errorStyle={{}} />
    </BasicAppContext>
  )

describe('a document refused unread', () => {
  test('the applicant is told a message from the vetter was ignored, and why', () => {
    const tree = show('applicant', 'wrongSigner')
    expect(tree.getByTestId(testIdWithKey('VettingEnvelopeRefused'))).toHaveTextContent(
      /Vetting\.EnvelopeRefused(?!Desk)/
    )
    expect(tree.getByTestId(testIdWithKey('VettingEnvelopeRefusedReason'))).toHaveTextContent(
      'Vetting.EnvelopeRefusedReason.wrongSigner'
    )
  })

  test('the vetter is told a card was ignored', () => {
    const tree = show('vetter', 'proof')
    expect(tree.getByTestId(testIdWithKey('VettingEnvelopeRefused'))).toHaveTextContent(/Vetting\.EnvelopeRefusedDesk/)
  })

  test('every reason has words in each language', () => {
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../../localization/${lang}/${lang}.json`)
      expect(typeof copy.Vetting.EnvelopeRefused).toBe('string')
      expect(typeof copy.Vetting.EnvelopeRefusedDesk).toBe('string')
      for (const reason of REASONS) expect(typeof copy.Vetting.EnvelopeRefusedReason[reason]).toBe('string')
    }
  })

  test('nothing refused shows nothing', () => {
    expect(show('applicant').queryByTestId(testIdWithKey('VettingEnvelopeRefused'))).toBeNull()
  })
})
