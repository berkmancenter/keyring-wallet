/**
 * A document from the other side that was refused unread (keyring-bifold#128):
 * its proof, issuer or type did not hold, so nothing it said was acted on. The
 * request's status stays where it was; this says why the step has not moved.
 *
 * The applicant sees it on the request card (a refused acceptance, session,
 * decline or error from the vetter); the vetter sees it on the desk (a
 * refused card). A refused statement has its own words (VettingStatementRefused).
 *
 * @module trust-tasks/screens/EnvelopeRefusalNote
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View, type TextStyle } from 'react-native'

import { testIdWithKey } from '../../../utils/testable'
import type { PeerDocumentRefusal } from '../module/vtiVetting'

export const EnvelopeRefusalNote: React.FC<{
  refusal?: PeerDocumentRefusal
  side: 'applicant' | 'vetter'
  style: TextStyle
  errorStyle: TextStyle
}> = ({ refusal, side, style, errorStyle }) => {
  const { t } = useTranslation()
  if (!refusal) return null
  return (
    <View testID={testIdWithKey('VettingEnvelopeRefused')}>
      <Text style={errorStyle}>{t(side === 'vetter' ? 'Vetting.EnvelopeRefusedDesk' : 'Vetting.EnvelopeRefused')}</Text>
      <Text style={style} testID={testIdWithKey('VettingEnvelopeRefusedReason')}>
        {t(`Vetting.EnvelopeRefusedReason.${refusal}`)}
      </Text>
    </View>
  )
}
