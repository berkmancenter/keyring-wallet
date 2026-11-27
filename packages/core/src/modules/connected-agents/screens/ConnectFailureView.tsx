import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { testIdWithKey } from '../../../utils/testable'
import ConnectNotice from '../components/ConnectNotice'
import { CONNECT_END_KEY, ConnectEnd, connectEndIcon } from '../failureCopy'

import { DigitCells } from './ConnectNumberView'

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: 16, gap: 18 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: '#E7E7E9' },
})

export interface ConnectFailureViewProps {
  end: ConnectEnd
  /** For "locked": the minutes left. */
  minutesLeft?: number
  /** For "wrong-number": the digits as typed, kept in their cells under the notice (§6); there is no second try. */
  typed?: string
  /** For "wrong-number": how many cells (MATCH_NUMBER_DIGITS). */
  cells?: number
  onClose: () => void
}

/**
 * How a connect ends when it does not connect (§6 "Failure, ..."; canvas frames 4, 18 and K23): one notice naming
 * what happened, and "Close". Nothing on it offers a retry: a code is spent or gone, and the plan's one try is one.
 */
const ConnectFailureView: React.FC<ConnectFailureViewProps> = ({ end, minutesLeft, typed, cells, onClose }) => {
  const { t } = useTranslation()
  const text = end === 'locked' ? t(CONNECT_END_KEY.locked, { count: minutesLeft ?? 1 }) : t(CONNECT_END_KEY[end])
  return (
    <View style={styles.screen} testID={testIdWithKey('ConnectFailure')}>
      <ScrollView contentContainerStyle={styles.body}>
        <ConnectNotice text={text} icon={connectEndIcon(end)} />
        {end === 'wrong-number' && typed && cells ? <DigitCells value={typed} cells={cells} wrong /> : null}
      </ScrollView>
      <View style={styles.bar}>
        <Button
          title={t('Global.Close')}
          buttonType={ButtonType.Primary}
          onPress={onClose}
          testID={testIdWithKey('ConnectFailureClose')}
          accessibilityLabel={t('Global.Close')}
        />
      </View>
    </View>
  )
}

export default ConnectFailureView
