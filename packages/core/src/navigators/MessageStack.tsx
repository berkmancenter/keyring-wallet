import { ParamListBase, RouteProp } from '@react-navigation/native'
import { createStackNavigator, StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useTheme } from '../contexts/theme'
import Messages from '../screens/Messages'
import NewMessage from '../screens/NewMessage'
import WhatAreConnections from '../modules/vrc/screens/WhatAreConnections'
import Room from '../modules/rooms/screens/Room'
import RoomInfo from '../modules/rooms/screens/RoomInfo'
import RoomOffer from '../modules/rooms/screens/RoomOffer'
import RoomPart, { roomPartTitle } from '../modules/rooms/screens/RoomPart'
import { MessageStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'
import { TOKENS, useServices } from '../container-api'

interface MessageStackProps {
  route?: RouteProp<ParamListBase>
  navigation?: StackNavigationProp<ParamListBase>
}

const MessageStack: React.FC<MessageStackProps> = ({ route, navigation }) => {
  const Stack = createStackNavigator<MessageStackParams>()
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary] = useServices([TOKENS.OBJECT_SCREEN_CONFIG])
  // A notice reaches this stack as the tab route's `{ screen: … }`. React Navigation keeps that param on the tab, and
  // the tab unmounts on blur (`TabStack.tsx`), so each return rebuilt this stack and opened the notice's screen again:
  // an offer long gone said it couldn't be read, on every return to Messages. The stack has acted on it by the time
  // this effect runs, so it is dropped here, as in MyAgentStack.
  const routedScreen = (route?.params as { screen?: string } | undefined)?.screen
  useEffect(() => {
    if (routedScreen) navigation?.setParams({ screen: undefined, params: undefined })
  }, [routedScreen, navigation])

  return (
    <Stack.Navigator screenOptions={{ ...defaultStackOptions }}>
      <Stack.Screen
        name={Screens.Messages}
        component={Messages}
        options={{ title: t('Screens.Messages'), ...ScreenOptionsDictionary[Screens.Messages] }}
      />
      <Stack.Screen
        name={Screens.NewMessage}
        component={NewMessage}
        options={{ title: t('MessagesList.NewMessage'), ...ScreenOptionsDictionary[Screens.NewMessage] }}
      />
      <Stack.Screen
        name={Screens.WhatAreConnections}
        component={WhatAreConnections}
        options={{
          title: '',
          ...ScreenOptionsDictionary[Screens.WhatAreConnections],
        }}
      />
      {/* A room opens here from its row in Messages, so Back comes back to Messages (rooms in Messages, R2). */}
      <Stack.Screen
        name={Screens.Room}
        component={Room}
        options={{ title: t('Rooms.Room'), ...ScreenOptionsDictionary[Screens.Room] }}
      />
      <Stack.Screen
        name={Screens.RoomInfo}
        component={RoomInfo}
        options={{ title: t('Rooms.Details'), ...ScreenOptionsDictionary[Screens.RoomInfo] }}
      />
      <Stack.Screen
        name={Screens.RoomPart}
        component={RoomPart}
        options={({ route }) => ({
          title: roomPartTitle(t, route.params?.part),
          ...ScreenOptionsDictionary[Screens.RoomPart],
        })}
      />
      <Stack.Screen
        name={Screens.RoomOffer}
        component={RoomOffer}
        options={{ title: t('Rooms.Offer'), ...ScreenOptionsDictionary[Screens.RoomOffer] }}
      />
    </Stack.Navigator>
  )
}

export default MessageStack
