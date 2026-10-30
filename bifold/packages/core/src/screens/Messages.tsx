import { DidCommConnectionType, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { useConnections } from '@bifold/react-hooks'
import { useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'

import IconButton, { ButtonLocation } from '../components/buttons/IconButton'
import EmptyListConnections from '../modules/vrc/components/EmptyListConnections'
import { useStore } from '../contexts/store'
import { useConnectionActivity } from '../hooks/useConnectionActivity'
import { useUnreadMessages } from '../hooks/useUnreadMessages'
import { messageRows } from '../modules/vrc/contacts/messageRows'
import { useConnectionRelationships } from '../modules/vrc/contacts/useContactFacts'
import { useContactLinks } from '../modules/vrc/contacts/useContactLinks'
import { useTheme } from '../contexts/theme'
import { MessageStackParams, Screens, Stacks } from '../types/navigators'
import { messageWakeFetching, useReportMessagesListFocus } from '../utils/messageWake'
import { testIdWithKey } from '../utils/testable'
import { TOKENS, useServices } from '../container-api'

interface MessagesProps {
  navigation: StackNavigationProp<MessageStackParams, Screens.Messages>
}

const Messages: React.FC<MessagesProps> = ({ navigation }) => {
  const { ColorPalette } = useTheme()
  const { t } = useTranslation()
  const { records: connectionRecords } = useConnections()
  // A tapped message notification is being resolved (utils/messageWake.ts):
  // said here, so the list is not a blank wait while the messages come in.
  const fetchingNew = useSyncExternalStore(messageWakeFetching.subscribe, messageWakeFetching.get)
  // A tapped message notification waits for this list to have focus before
  // it opens a chat, and stays put if the person leaves it (messageWake.ts).
  useReportMessagesListFocus()
  const [store] = useStore()
  const [{ contactHideList }, ContactListItem, defaultScreenOptionsDict] = useServices([
    TOKENS.CONFIG,
    TOKENS.COMPONENT_CONTACT_LIST_ITEM,
    TOKENS.OBJECT_SCREEN_CONFIG,
  ])

  // People and witnesses only: never the mediator or another hidden connection, never one not yet completed. The
  // same in developer mode: a conversation list is not where infrastructure is inspected.
  const connections = useMemo(
    () =>
      connectionRecords.filter((r) => {
        const isMediatorConnection = r.connectionTypes.includes(DidCommConnectionType.Mediator)
        const isHidden = contactHideList?.includes((r.theirLabel || r.alias) ?? '')
        const isCompleted = r.state === DidCommDidExchangeState.Completed
        return !isMediatorConnection && !isHidden && isCompleted
      }),
    [connectionRecords, contactHideList]
  )

  // One row per contact, as the Contacts list groups them (a merged contact has a connection per exchange). Re-read
  // the links on focus, so a merge or separation made on a contact's page shows on return.
  const isFocused = useIsFocused()
  const contactLinks = useContactLinks(isFocused)
  const relationshipOf = useConnectionRelationships()
  const activity = useConnectionActivity()
  const { unreadByConnection } = useUnreadMessages()
  const rows = useMemo(
    () =>
      messageRows(
        connections,
        relationshipOf,
        contactLinks,
        (connection) => activity(connection.id, connection.createdAt),
        (connection) => unreadByConnection[connection.id] ?? 0
      ),
    [connections, relationshipOf, contactLinks, activity, unreadByConnection]
  )

  // Only show empty state if we have data but no connections (not during initial load)
  const shouldShowEmptyState = connectionRecords.length > 0 && connections.length === 0

  const style = StyleSheet.create({
    list: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    fetching: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
    fetchingText: { color: ColorPalette.grayscale.mediumGrey },
  })

  const onPressAddContact = useCallback(() => {
    navigation.getParent()?.navigate(Stacks.ConnectStack, { screen: Screens.Scan, params: { defaultToConnect: true } })
  }, [navigation])

  useEffect(() => {
    navigation.setOptions({
      // The tab's own name, in the app's language: encryption is said once, in the empty state.
      title: t('MessagesList.Title'),
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
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) => (
          <ContactListItem contact={row.connection} connectionIds={row.connectionIds} navigation={navigation as any} />
        )}
        ListEmptyComponent={() =>
          shouldShowEmptyState ? <EmptyListConnections navigation={navigation as any} /> : null
        }
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          fetchingNew ? (
            <View style={style.fetching} testID={testIdWithKey('MessagesFetchingNew')}>
              <ActivityIndicator color={ColorPalette.brand.primary} />
              <Text style={style.fetchingText}>{t('MessageWake.Fetching')}</Text>
            </View>
          ) : null
        }
      />
    </View>
  )
}

export default Messages
