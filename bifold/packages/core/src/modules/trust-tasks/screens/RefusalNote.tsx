/**
 * A document from the other side that was checked and not taken
 * (keyring-bifold#130): the vetter's desk says why a card was refused, the
 * applicant's request card why a session was. The step does not move and the
 * other side is not told (openvtc refuses silently too), so the screen is the
 * only place a person learns why nothing happened. A later accepted document
 * clears the refusal.
 *
 * @module trust-tasks/screens/RefusalNote
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View, type TextStyle } from 'react-native'

import { testIdWithKey } from '../../../utils/testable'

export const RefusalNote: React.FC<{
  /** `Card` or `Session`: picks the words (Vetting.<kind>Refused…) and the testIDs (Vetting<kind>Refused…). */
  kind: 'Card' | 'Session'
  refusal?: string
  style: TextStyle
  errorStyle: TextStyle
}> = ({ kind, refusal, style, errorStyle }) => {
  const { t } = useTranslation()
  if (!refusal) return null
  return (
    <View testID={testIdWithKey(`Vetting${kind}Refused`)}>
      <Text style={errorStyle}>{t(`Vetting.${kind}Refused`)}</Text>
      <Text style={style} testID={testIdWithKey(`Vetting${kind}RefusedReason`)}>
        {t(`Vetting.${kind}RefusedReason.${refusal}`)}
      </Text>
    </View>
  )
}
