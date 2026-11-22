// Rule 5: a testID prop without the helper is recorded as raw (no prefix is applied at runtime).
import { Text, View } from 'react-native'

export const RawFixture = ({ testID }: { testID: string }) => (
  <View testID="FixtureRawRoot">
    <Text testID={'FixtureRawText'}>text</Text>
    <Text testID={testID}>passed through, not recorded</Text>
  </View>
)
