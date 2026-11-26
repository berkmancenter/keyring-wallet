// Rule 1 and 4: testIdWithKey with a string literal, in JSX and in navigator options.
import { Text, View } from 'react-native'

import { testIdWithKey } from '../../src/utils/testable'

export const screenOptions = {
  tabBarTestID: testIdWithKey('TabHome'),
}

export const LiteralFixture = ({ done }: { done: boolean }) => (
  <View testID={testIdWithKey('FixtureRoot')}>
    <Text testID={testIdWithKey('FixtureTitle')}>title</Text>
    <Text testID={testIdWithKey(done ? 'FixtureDone' : 'FixturePending')}>state</Text>
    <Text testID={testIdWithKey('FixtureParens' as string)}>parens</Text>
  </View>
)
