import { W3cCredentialRecord } from '@credo-ts/core'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgent } from '@credo-ts/react-hooks'
import { View, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { RootStackParams, Screens, Stacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { useTheme } from '../../../contexts/theme'
import { ThemedText } from '../../../components/texts/ThemedText'
import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import { ModalUsage } from '../../../types/remove'
import { useDeleteContact } from '../hooks/useDeleteContact'

import IconButton, { ButtonLocation } from '../../../components/buttons/IconButton'

interface InfoIconProps {
  connectionId: string
}

const InfoIcon: React.FC<InfoIconProps> = ({ connectionId }) => {
  const navigation = useNavigation<StackNavigationProp<RootStackParams>>()
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [issuerDid, setIssuerDid] = useState<string | null>(null)
  const [issuerName, setIssuerName] = useState<string | null>(null)
  const [issuerEmail, setIssuerEmail] = useState<string | undefined>(undefined)
  const [issuerOrganization, setIssuerOrganization] = useState<string | undefined>(undefined)
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 })
  const [isRemoveModalDisplayed, setIsRemoveModalDisplayed] = useState(false)
  const buttonRef = useRef<View>(null)
  const { deleteContact } = useDeleteContact()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()

  const extractIssuer = (credential: W3cCredentialRecord): { id: string; name?: string; email?: string; organization?: string } | null => {
    try {
      const credentialData = credential.credential

      if (
        credentialData &&
        typeof credentialData === 'object' &&
        !Array.isArray(credentialData) &&
        'issuer' in credentialData
      ) {
        const issuerValue = (credentialData as any).issuer

        if (typeof issuerValue === 'string') {
          return { id: issuerValue }
        }

        if (issuerValue && typeof issuerValue === 'object' && 'id' in issuerValue) {
          return {
            id: issuerValue.id,
            name: issuerValue.name || undefined,
            email: issuerValue.email || undefined,
            organization: issuerValue.organization || undefined,
          }
        }
      }
    } catch (error) {}

    return null
  }

  // Helper function to format issuer name with fallback
  const formatIssuerName = (issuerId: string, issuerName?: string): string => {
    if (issuerName) {
      return issuerName
    }
    // Fallback: "Unknown" + last 8 characters of DID
    const last8 = issuerId.slice(-8)
    return `Unknown ...${last8}`
  }

  // Look up the counterparty's relationship DID for this connection
  // This is the DID used as issuer.id in VRC credentials, needed for navigation consistency
  useEffect(() => {
    const lookupIssuer = async () => {
      if (!agent) return

      try {
        const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
        const allRecords = await repository.getAll(agent.context)
        const record = allRecords.find((r) => r.connectionId === connectionId)

        // Use counterpartyRelationshipDid as this matches the credential's issuer.id
        if (record?.counterpartyRelationshipDid) {
          const counterpartyRelationshipDid = record.counterpartyRelationshipDid
          setIssuerDid(counterpartyRelationshipDid)

          // Look up the issuer name from W3C credentials
          const matchingCredential = w3cCredentialRecords.find((cred) => {
            const issuer = extractIssuer(cred)
            return issuer?.id === counterpartyRelationshipDid
          })

          if (matchingCredential) {
            const issuer = extractIssuer(matchingCredential)
            setIssuerName(formatIssuerName(counterpartyRelationshipDid, issuer?.name))
            setIssuerEmail(issuer?.email)
            setIssuerOrganization(issuer?.organization)
          } else {
            setIssuerName(formatIssuerName(counterpartyRelationshipDid))
          }
        }
      } catch (error) {}
    }

    lookupIssuer()
  }, [agent, connectionId, w3cCredentialRecords])

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
    if (issuerDid && issuerName) {
      navigation.navigate(Stacks.ContactStack, {
        screen: Screens.ContactDetails,
        params: {
          contact: {
            issuer: {
              id: issuerDid,
              name: issuerName,
              email: issuerEmail,
              organization: issuerOrganization,
            },
          },
        },
      })
    }
  }, [navigation, issuerDid, issuerName, issuerEmail, issuerOrganization])

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
        <Pressable style={styles.menuOverlay} onPress={handleMenuClose}>
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
              >
                <Icon name="account-outline" size={20} color={ColorPalette.brand.text} />
                <ThemedText style={styles.menuItemText}>{t('ContactDetails.ViewContact')}</ThemedText>
              </TouchableOpacity>
            )}

            {/* Remove Contact Option */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleDeletePress}
              accessibilityLabel={t('ContactDetails.RemoveContact')}
              accessibilityRole="menuitem"
            >
              <Icon name="delete-outline" size={20} color={ColorPalette.semantic.error} />
              <ThemedText style={[styles.menuItemText, styles.deleteText]}>
                {t('ContactDetails.RemoveContact')}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

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
