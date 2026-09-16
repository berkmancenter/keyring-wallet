import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { TOKENS, useServices } from '../container-api'
import { useTheme } from '../contexts/theme'
import MyAgent from '../modules/trust-tasks/screens/MyAgent'
import VtiCommunity from '../modules/trust-tasks/screens/VtiCommunity'
import { MyAgentStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'

const MyAgentStack: React.FC = () => {
  const Stack = createStackNavigator<MyAgentStackParams>()
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary, config] = useServices([TOKENS.OBJECT_SCREEN_CONFIG, TOKENS.CONFIG])

  return (
    <Stack.Navigator screenOptions={{ ...defaultStackOptions }}>
      <Stack.Screen
        name={Screens.MyAgent}
        options={{ title: t('Screens.MyAgent'), ...ScreenOptionsDictionary[Screens.MyAgent] }}
      >
        {() => <MyAgent config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtiCommunity}
        component={VtiCommunity}
        options={{ title: t('Screens.Community'), ...ScreenOptionsDictionary[Screens.VtiCommunity] }}
      />
    </Stack.Navigator>
  )
}

export default MyAgentStack
