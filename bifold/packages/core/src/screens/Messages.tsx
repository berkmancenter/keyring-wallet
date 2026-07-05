import { ConnectionType, DidExchangeState } from '@credo-ts/core'
import { useConnections } from '@credo-ts/react-hooks'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, StyleSheet, View } from 'react-native'

import IconButton, { ButtonLocation } from '../components/buttons/IconButton'
import EmptyListConnections from '../modules/vrc/components/EmptyListConnections'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { MessageStackParams, Screens, Stacks } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'
import { TOKENS, useServices } from '../container-api'

interface MessagesProps {
  navigation: StackNavigationProp<MessageStackParams, Screens.Messages>
}

const Messages: React.FC<MessagesProps> = ({ navigation }) => {
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const { records: connectionRecords } = useConnections()
  const [store] = useStore()
  const [{ contactHideList }, ContactListItem, defaultScreenOptionsDict] = useServices([
    TOKENS.CONFIG,
    TOKENS.COMPONENT_CONTACT_LIST_ITEM,
    TOKENS.OBJECT_SCREEN_CONFIG,
  ])

  // Filter connections to show peer-to-peer and witness connections (not infrastructure)
  const connections = connectionRecords.filter((r) => {
    const isMediatorConnection = r.connectionTypes.includes(ConnectionType.Mediator)
    const isHidden = contactHideList?.includes((r.theirLabel || r.alias) ?? '')
    const isCompleted = r.state === DidExchangeState.Completed

    if (!store.preferences.developerModeEnabled) {
      return !isMediatorConnection && !isHidden && isCompleted
    }
    return true
  })

  // Only show empty state if we have data but no connections (not during initial load)
  const shouldShowEmptyState = connectionRecords.length > 0 && connections.length === 0

  const style = StyleSheet.create({
    list: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    itemSeparator: {
      backgroundColor: ColorPalette.brand.primaryBackground,
      height: 1,
      marginHorizontal: 16,
    },
  })

  const onPressAddContact = useCallback(() => {
    navigation.getParent()?.navigate(Stacks.ConnectStack, { screen: Screens.Scan, params: { defaultToConnect: true } })
  }, [navigation])

  useEffect(() => {
    navigation.setOptions({
      title: 'Secure Connection Messaging',
      headerTitleAlign: 'center',
    })

    if (store.preferences.useConnectionInviterCapability) {
      navigation.setOptions({
        headerRight: () => (
          <IconButton
            buttonLocation={ButtonLocation.Right}
            accessibilityLabel={t('Contacts.AddContact')}
            testID={testIdWithKey('AddContact')}
            onPress={onPressAddContact}
            icon="plus-circle-outline"
          />
        ),
      })
    } else {
      navigation.setOptions({
        headerRight: defaultScreenOptionsDict[Screens.Messages]?.headerRight,
      })
    }
  }, [store.preferences.useConnectionInviterCapability, navigation, t, onPressAddContact, defaultScreenOptionsDict])

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={style.list}
        contentContainerStyle={{ flexGrow: 1 }}
        data={connections}
        ItemSeparatorComponent={() => <View style={style.itemSeparator} />}
        keyExtractor={(connection) => connection.id}
        renderItem={({ item: connection }) => <ContactListItem contact={connection} navigation={navigation as any} />}
        ListEmptyComponent={() =>
          shouldShowEmptyState ? <EmptyListConnections navigation={navigation as any} /> : null
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

export default Messages
