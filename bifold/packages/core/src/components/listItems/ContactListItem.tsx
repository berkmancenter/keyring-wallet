import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'

import { useStore } from '../../contexts/store'
import { useTheme } from '../../contexts/theme'
import { useChatMessagesByConnection } from '../../hooks/chat-messages'
import { useConnectionDisplayName } from '../../hooks/connections'
import { useUnreadMessages } from '../../hooks/useUnreadMessages'
import { ContactStackParams, Screens, Stacks } from '../../types/navigators'
import { formatTime } from '../../utils/helpers'
import { testIdWithKey } from '../../utils/testable'
import { TOKENS, useServices } from '../../container-api'
import ContactPhoto from '../../modules/vrc/components/ContactPhoto'
import { useConnectionFacts } from '../../modules/vrc/contacts/useContactFacts'
import { ThemedText } from '../texts/ThemedText'

export interface ContactListItemProps {
  contact: DidCommConnectionRecord
  navigation: StackNavigationProp<ContactStackParams, Screens.Contacts>
}

const ContactListItem: React.FC<ContactListItemProps> = ({ contact, navigation }) => {
  const { ColorPalette } = useTheme()
  const messages = useChatMessagesByConnection(contact)
  // The newest thing said, never a line about the chat itself (a timer set).
  const message = messages.find((m) => m.kind !== 'system')
  const hasOnlyInitialMessage = messages.length < 2
  const [_store] = useStore()
  const [{ enableChat }] = useServices([TOKENS.CONFIG])
  const { unreadByConnection } = useUnreadMessages()
  const unreadCount = unreadByConnection[contact.id] ?? 0

  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      padding: 16,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    avatarContainer: {
      marginRight: 16,
      justifyContent: 'center',
    },
    contactNameContainer: {
      flex: 1,
      paddingVertical: 4,
    },
    nameAndTimeContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flex: 1,
    },
    timeContainer: {
      paddingVertical: 4,
      alignSelf: 'center',
    },
    unreadBadge: {
      backgroundColor: '#D21E30',
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      marginLeft: 8,
    },
    unreadBadgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '600' as const,
      lineHeight: 14,
    },
  })

  const navigateToContact = useCallback(() => {
    navigation.getParent()?.navigate(Stacks.ContactStack, {
      screen: enableChat ? Screens.Chat : Screens.ContactDetails,
      params: { connectionId: contact.id },
    })
  }, [navigation, contact, enableChat])

  const contactLabel = useConnectionDisplayName(contact.id)
  // Their photo from their contact card, as on Contacts; else the connection's own image; else their initial.
  const facts = useConnectionFacts(contact.id)

  return (
    <TouchableOpacity
      onPress={navigateToContact}
      testID={testIdWithKey('Contact')}
      accessibilityLabel={contactLabel}
      accessibilityRole="button"
    >
      <View style={styles.container}>
        <View style={styles.avatarContainer}>
          <ContactPhoto photo={facts.photo} name={contactLabel} fallbackUrl={contact.imageUrl} size={50} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameAndTimeContainer}>
            <View style={styles.contactNameContainer}>
              <ThemedText variant="labelTitle" style={unreadCount > 0 ? { fontWeight: '700' } : undefined}>
                {contactLabel}
              </ThemedText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.timeContainer}>
                {message && <ThemedText>{formatTime(message.createdAt, { shortMonth: true, trim: true })}</ThemedText>}
              </View>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <ThemedText style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</ThemedText>
                </View>
              )}
            </View>
          </View>
          <View>
            {message && !hasOnlyInitialMessage && (
              <ThemedText
                numberOfLines={1}
                ellipsizeMode={'tail'}
                style={unreadCount > 0 ? { fontWeight: '600' } : undefined}
              >
                {message.text}
              </ThemedText>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}

export default ContactListItem
