/**
 * Whether the vetter's eligibility could be checked, on the applicant's
 * request card (keyring-bifold#125).
 *
 * Advisory, as the spec makes the check: the step goes on and the statement
 * can still count, but the person is told this vetter could not be confirmed,
 * and why, in words. A legacy acceptance is logged, never shown; the developer
 * text shows only in a development build, as the grant's reason does.
 *
 * @module trust-tasks/screens/EligibilityNote
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Text, type TextStyle } from 'react-native'

import { testIdWithKey } from '../../../utils/testable'
import type { VettingApplicationRequest } from '../module/vtiVetting'

export const EligibilityNote: React.FC<{
  request: Pick<VettingApplicationRequest, 'eligibilityOk' | 'eligibilityRefusal' | 'eligibilityDetail'>
  style: TextStyle
}> = ({ request, style }) => {
  const { t } = useTranslation()
  if (request.eligibilityOk !== false || !request.eligibilityRefusal) return null
  return (
    <>
      <Text style={style} testID={testIdWithKey('VettingEligibilityUnchecked')}>
        {t('Vetting.EligibilityUnchecked')}
      </Text>
      <Text style={style} testID={testIdWithKey('VettingEligibilityUncheckedReason')}>
        {t(`Vetting.EligibilityReason.${request.eligibilityRefusal}`)}
        {__DEV__ && request.eligibilityDetail ? `\n${request.eligibilityDetail}` : ''}
      </Text>
    </>
  )
}
