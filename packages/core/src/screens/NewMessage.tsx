/**
 * New message (the Messages list redesign, L3): pick a contact to write to. Messages lists conversations only, so a
 * new one starts here. One row per contact, as the Contacts and Messages lists group them (a merged contact
 * appears once, #607), by name, A to Z; never infrastructure (isConversationPartner). A tap opens the chat, the one
 * its Messages row would open (connectionToOpen), and this picker closes behind it.
 *
 * @module screens/NewMessage
 */
import { useConnections } from '@bifold/react-hooks'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native'

import Button, { ButtonType } from '../components/buttons/Button'
import { ThemedText } from '../components/texts/ThemedText'
import { TOKENS, useServices } from '../container-api'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { connectionDisplayName } from '../hooks/connections'
import { useConnectionActivity } from '../hooks/useConnectionActivity'
import { useUnreadMessages } from '../hooks/useUnreadMessages'
import ContactPhoto from '../modules/vrc/components/ContactPhoto'
import { useVrcNameCache } from '../modules/vrc/context/VrcNameCacheProvider'
import { isConversationPartner, messageRows } from '../modules/vrc/contacts/messageRows'
import { useConnectionFacts, useConnectionRelationships } from '../modules/vrc/contacts/useContactFacts'
import { useContactLinks } from '../modules/vrc/contacts/useContactLinks'
import { MessageStackParams, Screens, Stacks } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'

interface NewMessageProps {
  navigation: StackNavigationProp<MessageStackParams, Screens.NewMessage>
}

const AVATAR_SIZE = 44

const PickerRow: React.FC<{
  connection: DidCommConnectionRecord
  name: string
  onPress: () => void
  testID: string
}> = ({ connection, name, onPress, testID }) => {
  const facts = useConnectionFacts(connection.id)
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      testID={testID}
      style={styles.row}
    >
      <ContactPhoto
        photo={facts.photo}
        name={name}
        fallbackUrl={connection.imageUrl}
        size={AVATAR_SIZE}
        initials={2}
        muted
      />
      <ThemedText style={styles.name} numberOfLines={1}>
        {name}
      </ThemedText>
    </TouchableOpacity>
  )
}

const NewMessage: React.FC<NewMessageProps> = ({ navigation }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { records } = useConnections()
  const [store] = useStore()
  const [{ contactHideList, enableChat }] = useServices([TOKENS.CONFIG])
  const { getVrcName } = useVrcNameCache()
  const contactLinks = useContactLinks(true)
  const relationshipOf = useConnectionRelationships()
  const activity = useConnectionActivity()
  const { unreadByConnection } = useUnreadMessages()

  const contacts = useMemo(() => {
    const partners = records.filter((record) => isConversationPartner(record, contactHideList))
    return messageRows(
      partners,
      relationshipOf,
      contactLinks,
      (connection) => activity(connection.id, connection.createdAt),
      (connection) => unreadByConnection[connection.id] ?? 0
    )
      .map((row) => ({
        row,
        name: connectionDisplayName(
          row.connection,
          store.preferences.alternateContactNames,
          getVrcName(row.connection.id)
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [
    records,
    contactHideList,
    relationshipOf,
    contactLinks,
    activity,
    unreadByConnection,
    store.preferences.alternateContactNames,
    getVrcName,
  ])

  const open = useCallback(
    (connectionId: string) => {
      // The picker closes behind the chat: back from it is the Messages list, not this picker.
      navigation.goBack()
      navigation.getParent()?.navigate(Stacks.ContactStack, {
        screen: enableChat ? Screens.Chat : Screens.ContactDetails,
        params: { connectionId },
      })
    },
    [navigation, enableChat]
  )

  const addContact = useCallback(() => {
    navigation.getParent()?.navigate(Stacks.ConnectStack, { screen: Screens.Scan, params: { defaultToConnect: true } })
  }, [navigation])

  return (
    <FlatList
      style={{ backgroundColor: ColorPalette.brand.secondaryBackground }}
      contentContainerStyle={{ flexGrow: 1 }}
      data={contacts}
      keyExtractor={({ row }) => row.key}
      renderItem={({ item }) => (
        <PickerRow
          connection={item.row.connection}
          name={item.name}
          onPress={() => open(item.row.connection.id)}
          testID={testIdWithKey('NewMessageContact')}
        />
      )}
      ListEmptyComponent={
        <View style={styles.empty} testID={testIdWithKey('NewMessageEmpty')}>
          <ThemedText style={styles.emptyText}>{t('MessagesList.PickerEmpty')}</ThemedText>
          <Button
            title={t('MessagesList.AddContact')}
            buttonType={ButtonType.Secondary}
            onPress={addContact}
            testID={testIdWithKey('NewMessageAddContact')}
          />
        </View>
      }
    />
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16 },
  name: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 40 },
  emptyText: { fontSize: 16, lineHeight: 23, textAlign: 'center' },
})

export default NewMessage
