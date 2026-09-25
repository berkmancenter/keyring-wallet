/**
 * The applicant's request card says when a vetter's eligibility could not be
 * checked, and why, in words (keyring-bifold#125). Advisory: nothing else on
 * the card changes, and a legacy acceptance says nothing at all.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { EligibilityNote } from '../screens/EligibilityNote'

const show = (request: Record<string, unknown>) =>
  render(
    <BasicAppContext>
      <EligibilityNote request={request} style={{}} />
    </BasicAppContext>
  )

describe("a vetter's eligibility on the request card", () => {
  test('a refused check says so, with the reason in words', () => {
    const tree = show({ eligibilityOk: false, eligibilityRefusal: 'nonce', eligibilityDetail: 'nonce mismatch' })
    expect(tree.getByTestId(testIdWithKey('VettingEligibilityUnchecked'))).toHaveTextContent(
      'Vetting.EligibilityUnchecked'
    )
    expect(tree.getByTestId(testIdWithKey('VettingEligibilityUncheckedReason'))).toHaveTextContent(
      /Vetting\.EligibilityReason\.nonce/
    )
  })

  test('every reason the check can give has words in each language', () => {
    const reasons = [
      'malformed',
      'holder',
      'nonce',
      'domain',
      'proof',
      'noRoleCredential',
      'grantIssuer',
      'grantSubject',
      'grantMalformed',
      'grantExpired',
      'grantProof',
      'legacyExpired',
    ]
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../../localization/${lang}/${lang}.json`)
      expect(typeof copy.Vetting.EligibilityUnchecked).toBe('string')
      for (const reason of reasons) expect(typeof copy.Vetting.EligibilityReason[reason]).toBe('string')
    }
  })

  test('a verified vetter, a legacy acceptance, or an older record shows nothing', () => {
    for (const request of [{ eligibilityOk: true }, { eligibilityOk: true, eligibilityLegacy: true }, {}]) {
      const tree = show(request)
      expect(tree.queryByTestId(testIdWithKey('VettingEligibilityUnchecked'))).toBeNull()
    }
  })
})
