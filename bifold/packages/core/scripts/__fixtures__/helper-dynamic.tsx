// Rule 2: a template or concatenation with a literal head is a stem; an empty head is derived.
import { Text, View } from 'react-native'

import { testIdWithKey } from '../../src/utils/testable'

export const DynamicFixture = ({ rows }: { rows: { id: string }[] }) => (
  <View>
    {rows.map((row) => (
      <View key={row.id} testID={testIdWithKey(`FixtureRow_${row.id}`)}>
        <Text testID={testIdWithKey('FixtureRowName_' + row.id)}>name</Text>
        <Text testID={testIdWithKey(`${row.id}Trailing`)}>trailing</Text>
        <Text testID={testIdWithKey(row.id === 'a' ? `FixtureRowA_${row.id}` : 'FixtureRowOther')}>mixed</Text>
      </View>
    ))}
  </View>
)
