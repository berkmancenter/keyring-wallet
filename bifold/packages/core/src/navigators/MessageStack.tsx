import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
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
