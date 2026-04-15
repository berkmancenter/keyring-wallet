import type { ConnectionRecord } from '@credo-ts/core'

import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native'

import { useStore } from '../../contexts/store'
import { useTheme } from '../../contexts/theme'
import { useChatMessagesByConnection } from '../../hooks/chat-messages'
import { useConnectionDisplayName } from '../../hooks/connections'
import { useUnreadMessages } from '../../hooks/useUnreadMessages'
import { ContactStackParams, Screens, Stacks } from '../../types/navigators'
import { formatTime } from '../../utils/helpers'
import { testIdWithKey } from '../../utils/testable'
import { TOKENS, useServices } from '../../container-api'
import { ThemedText } from '../texts/ThemedText'

export interface ContactListItemProps {
  contact: ConnectionRecord
  navigation: StackNavigationProp<ContactStackParams, Screens.Contacts>
}

const ContactListItem: React.FC<ContactListItemProps> = ({ contact, navigation }) => {
  const { ColorPalette, ListItems } = useTheme()
  const messages = useChatMessagesByConnection(contact)
  const message = messages[0]
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
      alignItems: 'center',
      justifyContent: 'center',
      width: 50,
      height: 50,
      borderRadius: 25,
      borderColor: ListItems.avatarCircle.borderColor,
      borderWidth: 1,
      marginRight: 16,
    },
    avatarPlaceholder: {
      textAlign: 'center',
    },
    avatarImage: {
      width: 30,
      height: 30,
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
  const contactLabelAbbr = useMemo(() => contactLabel?.charAt(0).toUpperCase(), [contactLabel])

  return (
    <TouchableOpacity
      onPress={navigateToContact}
      testID={testIdWithKey('Contact')}
      accessibilityLabel={contactLabel}
      accessibilityRole="button"
    >
      <View style={styles.container}>
        <View style={styles.avatarContainer}>
          {contact.imageUrl ? (
            <View>
              <Image style={styles.avatarImage} source={{ uri: contact.imageUrl }} />
            </View>
          ) : (
            <ThemedText allowFontScaling={false} variant="headingFour" style={styles.avatarPlaceholder}>
              {contactLabelAbbr}
            </ThemedText>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameAndTimeContainer}>
            <View style={styles.contactNameContainer}>
              <ThemedText
                variant="labelTitle"
                style={unreadCount > 0 ? { fontWeight: '700' } : undefined}
              >
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
