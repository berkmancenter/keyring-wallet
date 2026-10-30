import { useConnections } from '@bifold/react-hooks'
import { useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../components/buttons/Button'
import IconButton, { ButtonLocation } from '../components/buttons/IconButton'
import { ThemedText } from '../components/texts/ThemedText'
import { useStore } from '../contexts/store'
import { useConnectionActivity } from '../hooks/useConnectionActivity'
import { useUnreadMessages } from '../hooks/useUnreadMessages'
import { conversations, isConversationPartner, messageRows } from '../modules/vrc/contacts/messageRows'
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

  // People only: never the mediator, a witness service or another hidden connection, never one not yet completed
  // (isConversationPartner). The same in developer mode: a conversation list is not where infrastructure is inspected.
  const connections = useMemo(
    () => connectionRecords.filter((r) => isConversationPartner(r, contactHideList)),
    [connectionRecords, contactHideList]
  )

  // One row per contact, as the Contacts list groups them (a merged contact has a connection per exchange). Re-read
  // the links on focus, so a merge or separation made on a contact's page shows on return.
  const isFocused = useIsFocused()
  const contactLinks = useContactLinks(isFocused)
  const relationshipOf = useConnectionRelationships()
  const activity = useConnectionActivity()
  const { unreadByConnection } = useUnreadMessages()
  // Conversations only, newest first (L3): a contact appears once a message has been exchanged with them; a chat
  // cleared on this phone leaves the list until either side writes again. New ones start from New message.
  const rows = useMemo(
    () =>
      conversations(
        messageRows(
          connections,
          relationshipOf,
          contactLinks,
          (connection) => activity(connection.id, connection.createdAt),
          (connection) => unreadByConnection[connection.id] ?? 0
        ),
        (connectionId) => activity(connectionId)
      ),
    [connections, relationshipOf, contactLinks, activity, unreadByConnection]
  )

  const style = StyleSheet.create({
    list: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    fetching: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
    fetchingText: { color: ColorPalette.grayscale.mediumGrey },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingHorizontal: 40,
      paddingBottom: 80,
    },
    emptyMark: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: '#F0E6F0',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    emptyTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
    emptyBody: { fontSize: 16, lineHeight: 23, color: '#4A4A4A', textAlign: 'center' },
    emptyActions: { alignSelf: 'stretch', gap: 10, marginTop: 10 },
  })

  const onPressAddContact = useCallback(() => {
    navigation.getParent()?.navigate(Stacks.ConnectStack, { screen: Screens.Scan, params: { defaultToConnect: true } })
  }, [navigation])
  const onPressNewMessage = useCallback(() => navigation.navigate(Screens.NewMessage), [navigation])

  useEffect(() => {
    navigation.setOptions({
      // The tab's own name, in the app's language: encryption is said once, in the empty state.
      title: t('MessagesList.Title'),
      headerTitleAlign: 'center',
    })

    // New message beside whatever the header already offered (Add contact, or the app's own button).
    const defaultRight = defaultScreenOptionsDict[Screens.Messages]?.headerRight as
      | ((props: Record<string, unknown>) => React.ReactNode)
      | undefined
    navigation.setOptions({
      headerRight: (props: Record<string, unknown>) => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            buttonLocation={ButtonLocation.Right}
            accessibilityLabel={t('MessagesList.NewMessage')}
            testID={testIdWithKey('MessagesNewMessage')}
            onPress={onPressNewMessage}
            icon="square-edit-outline"
          />
          {store.preferences.useConnectionInviterCapability ? (
            <IconButton
              buttonLocation={ButtonLocation.Right}
              accessibilityLabel={t('Contacts.AddContact')}
              testID={testIdWithKey('AddContact')}
              onPress={onPressAddContact}
              icon="plus-circle-outline"
            />
          ) : (
            defaultRight?.(props)
          )}
        </View>
      ),
    })
  }, [
    store.preferences.useConnectionInviterCapability,
    navigation,
    t,
    onPressAddContact,
    onPressNewMessage,
    defaultScreenOptionsDict,
  ])

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
          // Not while a tapped notification's messages are still coming in: the list is about to fill.
          fetchingNew ? null : (
            <View style={style.empty} testID={testIdWithKey('MessagesEmpty')}>
              <View style={style.emptyMark}>
                <Icon name="message-text-lock-outline" size={40} color={ColorPalette.brand.primary} />
              </View>
              <ThemedText style={style.emptyTitle} accessibilityRole="header">
                {t('MessagesList.EmptyTitle')}
              </ThemedText>
              <ThemedText style={style.emptyBody}>{t('MessagesList.EmptyBody')}</ThemedText>
              <View style={style.emptyActions}>
                <Button
                  title={t('MessagesList.NewMessage')}
                  buttonType={ButtonType.Primary}
                  onPress={onPressNewMessage}
                  testID={testIdWithKey('MessagesEmptyNewMessage')}
                />
                <Button
                  title={t('MessagesList.AddContact')}
                  buttonType={ButtonType.Secondary}
                  onPress={onPressAddContact}
                  testID={testIdWithKey('MessagesEmptyAddContact')}
                />
              </View>
            </View>
          )
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
