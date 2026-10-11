// Rule 6: a key read from a same-file lookup table by element or property access contributes
// every string value of that table; the call itself stays listed as derived.
import { Text, View } from 'react-native'

import { testIdWithKey } from '../../src/utils/testable'

enum Usage {
  Biometrics = 'biometrics',
  Attestation = 'attestation',
  Check = 'check',
}

export const LookupFixture = ({ usage, ids }: { usage: Usage; ids: { root: string } }) => {
  const inputTestId = {
    [Usage.Biometrics]: 'FixtureBiometricsEnterPIN',
    [Usage.Attestation]: 'FixtureAttestationEnterPIN',
    [Usage.Check]: 'FixtureSettingEnterPIN',
  }
  const buttonTestId = {
    [Usage.Biometrics]: 'FixtureContinue',
    [Usage.Attestation]: 'FixtureContinue',
    [Usage.Check]: 'FixtureSave',
  } as const
  const labels = { title: 'FixtureLabelNotAnId' }
  return (
    <View testID={testIdWithKey(inputTestId[usage])}>
      <Text testID={testIdWithKey(buttonTestId[usage])}>button</Text>
      <Text testID={testIdWithKey(buttonTestId.check)}>again</Text>
      <Text testID={testIdWithKey(ids.root)}>from a prop, nothing to resolve</Text>
      <Text accessibilityLabel={labels.title}>not a testID</Text>
    </View>
  )
}
