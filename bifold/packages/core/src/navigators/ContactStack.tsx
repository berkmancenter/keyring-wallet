import { createStackNavigator } from '@react-navigation/stack'
import React from 'react'
import { useTranslation } from 'react-i18next'

import HeaderRightHome from '../components/buttons/HeaderHome'
import { AttachTourStep } from '../components/tour/AttachTourStep'
import { useTheme } from '../contexts/theme'
import Chat from '../screens/Chat'
import ContactDetails from '../modules/vrc/screens/ContactDetails'
import WitnessHeaderButton from '../modules/vrc/components/WitnessHeaderButton'
import CredentialDetails from '../screens/CredentialDetails'
import ListContacts from '../modules/vrc/screens/ListContacts'
import ProofDetails from '../screens/ProofDetails'
import RenameContact from '../screens/RenameContact'
import JSONDetails from '../screens/JSONDetails'
import WhatAreContacts from '../modules/vrc/screens/WhatAreContacts'
import WhatAreConnections from '../modules/vrc/screens/WhatAreConnections'
import WitnessConnections from '../modules/vrc/screens/WitnessConnections'
import OpenIDCredentialDetails from '../modules/openid/screens/OpenIDCredentialDetails'
import { BaseTourID } from '../types/tour'
import { ContactStackParams, Screens } from '../types/navigators'

import { useDefaultStackOptions } from './defaultStackOptions'
import { TOKENS, useServices } from '../container-api'

const ContactStack: React.FC = () => {
  const Stack = createStackNavigator<ContactStackParams>()
  const theme = useTheme()
  const { t } = useTranslation()
  const defaultStackOptions = useDefaultStackOptions(theme)
  const [ScreenOptionsDictionary] = useServices([TOKENS.OBJECT_SCREEN_CONFIG])

  return (
    <Stack.Navigator screenOptions={{ ...defaultStackOptions }}>
      <Stack.Screen
        name={Screens.Contacts}
        component={ListContacts}
        options={{
          title: t('Screens.Contacts'),
          headerRight: () => (
            <AttachTourStep tourID={BaseTourID.ContactsTour} index={1}>
              <WitnessHeaderButton />
            </AttachTourStep>
          ),
          ...ScreenOptionsDictionary[Screens.Contacts],
        }}
      />
      <Stack.Screen
        name={Screens.ContactDetails}
        component={ContactDetails}
        options={{
          title: t('Screens.ContactDetails'),
          ...ScreenOptionsDictionary[Screens.ContactDetails],
        }}
      />
      <Stack.Screen
        name={Screens.RenameContact}
        component={RenameContact}
        options={{
          title: t('Screens.RenameContact'),
          ...ScreenOptionsDictionary[Screens.RenameContact],
        }}
      />
      <Stack.Screen
        name={Screens.JSONDetails}
        component={JSONDetails}
        options={{
          title: t('Screens.JSONDetails'),
          ...ScreenOptionsDictionary[Screens.JSONDetails],
        }}
      />
      <Stack.Screen
        name={Screens.Chat}
        component={Chat}
        options={{
          ...ScreenOptionsDictionary[Screens.Chat],
        }}
      />
      <Stack.Screen
        name={Screens.WhatAreContacts}
        component={WhatAreContacts}
        options={{
          title: '',
          ...ScreenOptionsDictionary[Screens.WhatAreContacts],
        }}
      />
      <Stack.Screen
        name={Screens.WhatAreConnections}
        component={WhatAreConnections}
        options={{
          title: '',
          ...ScreenOptionsDictionary[Screens.WhatAreConnections],
        }}
      />
      <Stack.Screen
        name={Screens.WitnessConnections}
        component={WitnessConnections}
        options={{
          title: t('Screens.WitnessConnections'),
          ...ScreenOptionsDictionary[Screens.WitnessConnections],
        }}
      />
      <Stack.Screen
        name={Screens.CredentialDetails}
        component={CredentialDetails}
        options={{ title: t('Screens.CredentialDetails'), ...ScreenOptionsDictionary[Screens.CredentialDetails] }}
      />
      <Stack.Screen
        name={Screens.OpenIDCredentialDetails}
        component={OpenIDCredentialDetails}
        options={{ title: t('Screens.CredentialDetails'), ...ScreenOptionsDictionary[Screens.OpenIDCredentialDetails] }}
      />
      <Stack.Screen
        name={Screens.ProofDetails}
        component={ProofDetails}
        options={() => ({
          title: '',
          headerRight: () => <HeaderRightHome />,
          ...ScreenOptionsDictionary[Screens.ProofDetails],
        })}
      />
    </Stack.Navigator>
  )
}

export default ContactStack
