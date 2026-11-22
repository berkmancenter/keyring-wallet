/**
 * A failure as a screen shows it: the sentence (`sayFailure`), and the
 * original text one tap away under Details, never on its own. The screens
 * that still showed a caught error's raw message — "vtiAgent: sent
 * vtc/join-requests/manifest; the community has not answered yet" on the
 * vetting screen (225 gate) — show it through this instead.
 *
 * TestIDs: `<testID>` for the sentence, `<testID>DetailsToggle`, `<testID>Detail`.
 *
 * @module trust-tasks/screens/SaidFailure
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, Text, View, type TextStyle } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'

import type { Said } from './plainError'

export const SaidFailure: React.FC<{ said: Said; testID: string; style: TextStyle }> = ({ said, testID, style }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [open, setOpen] = useState(false)
  const muted = { color: ColorPalette.grayscale.mediumGrey }
  return (
    <View>
      <Text style={style} testID={testIdWithKey(testID)}>
        {said.words ?? t(said.key ?? 'Errors.Unknown')}
      </Text>
      {said.detail ? (
        <>
          <Pressable
            onPress={() => setOpen((was) => !was)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            testID={testIdWithKey(`${testID}DetailsToggle`)}
          >
            <Text style={muted}>{t('Errors.ShowDetails')}</Text>
          </Pressable>
          {open ? (
            <ScrollView style={{ maxHeight: 120 }}>
              <Text style={muted} selectable testID={testIdWithKey(`${testID}Detail`)}>
                {said.detail}
              </Text>
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

export default SaidFailure
