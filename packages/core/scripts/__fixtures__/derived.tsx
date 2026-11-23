// Derived: keys built from calls or variables are recorded with their expression, not as keys.
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { testIdWithKey } from '../../src/utils/testable'

export const DerivedFixture = ({ label }: { label: string }) => {
  const { t } = useTranslation()
  return (
    <View testID={testIdWithKey(t('Fixture.Root'))}>
      <Text testID={testIdWithKey(label)}>label</Text>
    </View>
  )
}
