import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../contexts/theme'
import Messages from '../screens/Messages'
import WhatAreConnections from '../modules/vrc/screens/WhatAreConnections'
import { MessageStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'
import { TOKENS, useServices } from '../container-api'

const MessageStack: React.FC = () => {
  const Stack = createStackNavigator<MessageStackParams>()
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary] = useServices([TOKENS.OBJECT_SCREEN_CONFIG])

  return (
    <Stack.Navigator screenOptions={{ ...defaultStackOptions }}>
      <Stack.Screen
        name={Screens.Messages}
        component={Messages}
        options={{ title: t('Screens.Messages'), ...ScreenOptionsDictionary[Screens.Messages] }}
      />
      <Stack.Screen
        name={Screens.WhatAreConnections}
        component={WhatAreConnections}
        options={{
          title: '',
          ...ScreenOptionsDictionary[Screens.WhatAreConnections],
        }}
      />
    </Stack.Navigator>
  )
}

export default MessageStack
