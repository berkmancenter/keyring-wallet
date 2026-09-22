import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { useTranslation } from 'react-i18next'

import { TOKENS, useServices } from '../container-api'
import { useTheme } from '../contexts/theme'
import MyAgent from '../modules/trust-tasks/screens/MyAgent'
import VtiCommunity from '../modules/trust-tasks/screens/VtiCommunity'
import VtiInvited from '../modules/trust-tasks/screens/VtiInvited'
import VtaAgentHome from '../modules/trust-tasks/screens/VtaAgentHome'
import VtaLink from '../modules/trust-tasks/screens/VtaLink'
import VtiVetting from '../modules/trust-tasks/screens/VtiVetting'
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
      <Stack.Screen name={Screens.VtiVetting} options={{ title: t('Screens.Vetting'), ...ScreenOptionsDictionary[Screens.VtiVetting] }}>
        {() => <VtiVetting config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtaLink}
        component={VtaLink}
        options={{ title: t('Screens.VtaLink'), ...ScreenOptionsDictionary[Screens.VtaLink] }}
      />
      <Stack.Screen name={Screens.VtiInvited} options={{ title: t('Screens.Invited'), ...ScreenOptionsDictionary[Screens.VtiInvited] }}>
        {() => <VtiInvited config={config.vti} />}
      </Stack.Screen>
      <Stack.Screen
        name={Screens.VtaAgent}
        component={VtaAgentHome}
        options={{ title: t('Screens.VtaAgent'), ...ScreenOptionsDictionary[Screens.VtaAgent] }}
      />
    </Stack.Navigator>
  )
}

export default MyAgentStack
