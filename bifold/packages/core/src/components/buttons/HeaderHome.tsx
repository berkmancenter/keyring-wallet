import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { Stacks } from '../../types/navigators'
import { testIdWithKey } from '../../utils/testable'

import IconButton, { ButtonLocation } from './IconButton'

const HeaderRightHome: React.FC = () => {
  const { t } = useTranslation()
  const navigation = useNavigation()

  return (
    <IconButton
      buttonLocation={ButtonLocation.Right}
      accessibilityLabel={t('Global.Home')}
      testID={testIdWithKey('HomeButton')}
      onPress={() => navigation.getParent()?.navigate(Stacks.TabStack)}
      icon="home"
    />
  )
}

export default HeaderRightHome
