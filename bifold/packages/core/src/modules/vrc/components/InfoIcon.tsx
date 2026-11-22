import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { RootStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { useTheme } from '../../../contexts/theme'
import { ThemedText } from '../../../components/texts/ThemedText'
import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import { ModalUsage } from '../../../types/remove'
import { useDeleteContact } from '../hooks/useDeleteContact'
import { useChatContact } from '../hooks/useChatContact'

import IconButton, { ButtonLocation } from '../../../components/buttons/IconButton'
import DisappearingMessagesSheet from '../../../components/chat/DisappearingMessagesSheet'
import { useConnectionDisplayName } from '../../../hooks/connections'
import { useClearChat } from '../../chat/useClearChat'

interface InfoIconProps {
  connectionId: string
}

const InfoIcon: React.FC<InfoIconProps> = ({ connectionId }) => {
  const navigation = useNavigation<StackNavigationProp<RootStackParams>>()
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  // Their relationship and contact page, as the chat header's title opens it too (useChatContact).
  const { issuerDid, viewContact } = useChatContact(connectionId)
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 })
  const [isRemoveModalDisplayed, setIsRemoveModalDisplayed] = useState(false)
  const buttonRef = useRef<View>(null)
  const { deleteContact } = useDeleteContact()
  const [disappearingVisible, setDisappearingVisible] = useState(false)
  const clearChat = useClearChat()
  const name = useConnectionDisplayName(connectionId)
  const handleMenuOpen = useCallback(() => {
    if (buttonRef.current) {
      buttonRef.current.measureInWindow((x, y, width, height) => {
        setMenuPosition({
          top: y + height + 8,
          right: 16,
        })
        setMenuVisible(true)
      })
    } else {
      setMenuVisible(true)
    }
  }, [])

  const handleMenuClose = useCallback(() => {
    setMenuVisible(false)
  }, [])

  const handleViewContact = useCallback(() => {
    setMenuVisible(false)
    viewContact?.()
  }, [viewContact])

  const handleDisappearing = useCallback(() => {
    setMenuVisible(false)
    setDisappearingVisible(true)
  }, [])

  const handleClearChat = useCallback(() => {
    setMenuVisible(false)
    clearChat(connectionId, name)
  }, [clearChat, connectionId, name])

  const handleDeletePress = useCallback(() => {
    setMenuVisible(false)
    setIsRemoveModalDisplayed(true)
  }, [])

  const handleConfirmRemove = useCallback(async () => {
    setIsRemoveModalDisplayed(false)

    const success = await deleteContact({
      issuerId: issuerDid || '',
      connectionId,
    })

    if (success) {
      // Navigate back to Messages list after successful deletion
      navigation.goBack()
    }
  }, [deleteContact, issuerDid, connectionId, navigation])

  const handleCancelRemove = useCallback(() => {
    setIsRemoveModalDisplayed(false)
  }, [])

  const styles = StyleSheet.create({
    menuOverlay: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    menuContainer: {
      position: 'absolute',
      backgroundColor: ColorPalette.brand.primaryBackground,
      borderRadius: 8,
      paddingVertical: 8,
      minWidth: 180,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      gap: 12,
    },
    menuItemText: {
      fontSize: 16,
    },
    deleteText: {
      color: ColorPalette.semantic.error,
    },
  })

  return (
    <>
      <View ref={buttonRef} collapsable={false}>
        <IconButton
          buttonLocation={ButtonLocation.Right}
          accessibilityLabel={t('Chat.Details')}
          testID={testIdWithKey('ContactMenu')}
          onPress={handleMenuOpen}
          icon="dots-vertical"
        />
      </View>

      {/* Popup Menu */}
      <Modal visible={menuVisible} transparent={true} animationType="fade" onRequestClose={handleMenuClose}>
        {/*
         * The overlay is a sibling behind the menu, not its parent: an accessible Pressable is one element to iOS
         * accessibility, so every item inside it was unreachable to VoiceOver (and to the e2e driver), read as one
         * merged label. The same fix as the message actions sheet (MessageActions.tsx).
         */}
        <View style={styles.menuOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleMenuClose}
            accessibilityRole="button"
            accessibilityLabel={t('Global.Close')}
            testID={testIdWithKey('ContactMenuOverlay')}
          />
          <View
            style={[
              styles.menuContainer,
              {
                top: menuPosition.top,
                right: menuPosition.right,
              },
            ]}
          >
            {/* View Contact Option - only show if we have an issuer relationship */}
            {issuerDid && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={handleViewContact}
                accessibilityLabel={t('ContactDetails.ViewContact')}
                accessibilityRole="menuitem"
                testID={testIdWithKey('ContactMenuViewContact')}
              >
                <Icon name="account-outline" size={20} color={ColorPalette.brand.text} />
                <ThemedText style={styles.menuItemText}>{t('ContactDetails.ViewContact')}</ThemedText>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleDisappearing}
              accessibilityLabel={t('Chat.DisappearingMessages')}
              accessibilityRole="menuitem"
              testID={testIdWithKey('ContactMenuDisappearing')}
            >
              <Icon name="timer-outline" size={20} color={ColorPalette.brand.text} />
              <ThemedText style={styles.menuItemText}>{t('Chat.DisappearingMessages')}</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleClearChat}
              accessibilityLabel={t('Chat.ClearChat')}
              accessibilityRole="menuitem"
              testID={testIdWithKey('ContactMenuClearChat')}
            >
              <Icon name="broom" size={20} color={ColorPalette.semantic.error} />
              <ThemedText style={[styles.menuItemText, styles.deleteText]}>{t('Chat.ClearChat')}</ThemedText>
            </TouchableOpacity>

            {/* Remove Contact Option */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleDeletePress}
              accessibilityLabel={t('ContactDetails.RemoveContact')}
              accessibilityRole="menuitem"
              testID={testIdWithKey('ContactMenuRemoveContact')}
            >
              <Icon name="delete-outline" size={20} color={ColorPalette.semantic.error} />
              <ThemedText style={[styles.menuItemText, styles.deleteText]}>
                {t('ContactDetails.RemoveContact')}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <DisappearingMessagesSheet
        visible={disappearingVisible}
        connectionId={connectionId}
        name={name}
        onClose={() => setDisappearingVisible(false)}
      />

      {/* Remove Contact Confirmation Modal */}
      <CommonRemoveModal
        usage={ModalUsage.ContactRemove}
        visible={isRemoveModalDisplayed}
        onSubmit={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />
    </>
  )
}

export default InfoIcon
