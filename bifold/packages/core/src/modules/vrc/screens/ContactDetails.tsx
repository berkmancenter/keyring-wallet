import { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useState, useMemo } from 'react'
import { StyleSheet, View, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAgent } from '@credo-ts/react-hooks'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTranslation } from 'react-i18next'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { ContactStackParams, Screens } from '../../../types/navigators'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import { ModalUsage } from '../../../types/remove'
import { useDeleteContact } from '../hooks/useDeleteContact'
import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { getWitnessCredentialsForSubject, extractWitnessInfo, getVrcCredentialJsonForSubject, WitnessRecord } from '../utils/witnessCredentialUtils'
import { verifyVrcHardwareEvidence } from '../services/BiometricSignatureVerifier'

const AVATAR_BG = '#E8E0E8'
const NAME_COLOR = '#010B13'
const BRAND_PURPLE = '#622C62'
const BADGE_HW_TEAL = '#4D7A8B'
const BADGE_WITNESS_PURPLE = '#A349A4'
const AVATAR_SIZE = 50

type ContactDetailsProps = StackScreenProps<ContactStackParams, Screens.ContactDetails>

const ContactDetails: React.FC<ContactDetailsProps> = ({ route, navigation }) => {
  if (!route?.params) {
    throw new Error('ContactDetails route params were not set properly')
  }

  const { contact } = route.params
  const { ColorPalette, TextTheme, Assets } = useTheme()
  const { agent } = useAgent()
  const { t } = useTranslation()
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [isRemoveModalDisplayed, setIsRemoveModalDisplayed] = useState<boolean>(false)
  const { deleteContact } = useDeleteContact()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()

  const witnessCredentials = useMemo(() => {
    return getWitnessCredentialsForSubject(w3cCredentialRecords, contact.issuer.id)
  }, [w3cCredentialRecords, contact.issuer.id])

  const witnessRecords = useMemo(() => {
    return witnessCredentials.map(extractWitnessInfo).filter((record): record is WitnessRecord => record !== null)
  }, [witnessCredentials])

  const [hwVerified, setHwVerified] = useState(false)

  useEffect(() => {
    let cancelled = false
    const verify = async () => {
      try {
        console.log(`[VRC:Badge] ContactDetails: verifying HW attestation for issuer=${contact.issuer.id}`)
        const rawCred = getVrcCredentialJsonForSubject(w3cCredentialRecords, contact.issuer.id)
        if (!rawCred) {
          console.log(`[VRC:Badge] ContactDetails: no raw credential found for issuer`)
          if (!cancelled) setHwVerified(false)
          return
        }
        console.log(`[VRC:Badge] ContactDetails: raw credential keys: ${Object.keys(rawCred).sort().join(', ')}`)
        const result = await verifyVrcHardwareEvidence(rawCred as any)
        console.log(`[VRC:Badge] ContactDetails: verification result valid=${result?.valid}, error=${result?.error ?? 'none'}`)
        if (!cancelled) {
          setHwVerified(result?.valid === true)
        }
      } catch (e) {
        console.log(`[VRC:Badge] ContactDetails: verification exception: ${e}`)
        if (!cancelled) setHwVerified(false)
      }
    }
    verify()
    return () => { cancelled = true }
  }, [w3cCredentialRecords, contact.issuer.id])

  useEffect(() => {
    const lookupConnection = async () => {
      if (!agent) return

      try {
        const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
        const record = await repository.findByCounterpartyRelationshipDid(agent.context, contact.issuer.id)

        if (record?.connectionId) {
          setConnectionId(record.connectionId)
        }
      } catch (error) {
        console.warn('[VRC:ContactDetails] Connection lookup error:', error instanceof Error ? error.message : String(error))
      }
    }

    lookupConnection()
  }, [agent, contact.issuer.id])

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: ColorPalette.brand.secondaryBackground,
    },
    contentContainer: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    avatarSection: {
      alignItems: 'center',
      paddingTop: 16,
      paddingBottom: 12,
    },
    avatarCircle: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: AVATAR_BG,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactName: {
      ...TextTheme.headingTwo,
      fontWeight: 'bold',
      color: NAME_COLOR,
      marginTop: 8,
      textAlign: 'center',
    },
    badgesContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 8,
    },
    verifiedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(163, 73, 164, 0.12)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      gap: 4,
    },
    verifiedBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: BADGE_WITNESS_PURPLE,
    },
    hardwareAttestationBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(77, 122, 139, 0.2)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 25,
      gap: 4,
    },
    hardwareAttestationBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: BADGE_HW_TEAL,
    },
    divider: {
      height: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.08)',
      marginBottom: 12,
    },
    detailsSection: {
      marginBottom: 8,
    },
    fieldGroup: {
      marginBottom: 12,
    },
    fieldLabel: {
      ...TextTheme.label,
      color: NAME_COLOR,
      fontSize: 14,
      fontWeight: '800',
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    fieldValue: {
      ...TextTheme.normal,
      fontSize: 16,
      color: NAME_COLOR,
    },
    viewMessagesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      marginBottom: 12,
    },
    viewMessagesIconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#F1D2D6',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    viewMessagesText: {
      fontSize: 16,
      fontWeight: '600',
      color: BRAND_PURPLE,
    },
    removeButton: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      paddingVertical: 14,
      paddingHorizontal: 40,
      borderRadius: 40,
      borderWidth: 2,
      borderColor: '#622C62',
      borderStyle: 'dashed' as const,
      marginTop: 16,
      marginBottom: 24,
    },
    removeButtonText: {
      ...TextTheme.bold,
      fontSize: 16,
      color: '#622C62',
      textAlign: 'center',
    },
    witnessSection: {
      marginBottom: 4,
    },
    witnessSectionHeader: {
      ...TextTheme.label,
      color: NAME_COLOR,
      marginBottom: 4,
      fontSize: 14,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    witnessRecord: {
      marginBottom: 8,
    },
    witnessSubSection: {
      marginBottom: 4,
    },
    witnessLabel: {
      ...TextTheme.label,
      color: NAME_COLOR,
      marginBottom: 4,
      fontSize: 13,
      fontWeight: '800',
    },
    witnessValue: {
      ...TextTheme.normal,
      fontSize: 14,
    },
    localityVerified: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
  })

  const handleViewMessages = () => {
    if (connectionId) {
      navigation.getParent()?.navigate(Screens.Chat, { connectionId })
    }
  }

  const handleRemoveContact = useCallback(() => {
    setIsRemoveModalDisplayed(true)
  }, [])

  const handleConfirmRemove = useCallback(async () => {
    setIsRemoveModalDisplayed(false)

    const success = await deleteContact({
      issuerId: contact.issuer.id,
      connectionId,
    })

    if (success) {
      navigation.pop()
    }
  }, [deleteContact, contact.issuer.id, connectionId, navigation])

  const handleCancelRemove = useCallback(() => {
    setIsRemoveModalDisplayed(false)
  }, [])

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView style={styles.contentContainer} contentContainerStyle={styles.scrollContent}>
        {/* Avatar + Name + Badges */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Icon name="account-outline" size={32} color="#666666" />
          </View>
          <ThemedText style={styles.contactName}>{contact.issuer.name}</ThemedText>
          {(witnessRecords.length > 0 || hwVerified) && (
            <View style={styles.badgesContainer}>
              {hwVerified && (
                <View style={styles.hardwareAttestationBadge}>
                  <Icon name="shield-check" size={14} color={BADGE_HW_TEAL} />
                  <ThemedText style={styles.hardwareAttestationBadgeText}>Secure Exchange</ThemedText>
                </View>
              )}
              {witnessRecords.length > 0 && (
                <View style={styles.verifiedBadge}>
                  <Icon name="check-decagram" size={14} color={BADGE_WITNESS_PURPLE} />
                  <ThemedText style={styles.verifiedBadgeText}>Verified</ThemedText>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={styles.divider} />

        {/* Detail Fields */}
        <View style={styles.detailsSection}>
          {contact.issuer.email && (
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.fieldLabel}>Email</ThemedText>
              <ThemedText style={styles.fieldValue} selectable={true}>
                {contact.issuer.email}
              </ThemedText>
            </View>
          )}

          {contact.issuer.organization && (
            <View style={styles.fieldGroup}>
              <ThemedText style={styles.fieldLabel}>Organisation</ThemedText>
              <ThemedText style={styles.fieldValue} selectable={true}>
                {contact.issuer.organization}
              </ThemedText>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <ThemedText style={styles.fieldLabel}>{t('ContactDetails.RelationshipDID')}</ThemedText>
            <ThemedText style={styles.fieldValue} selectable={true}>
              {contact.issuer.id}
            </ThemedText>
          </View>
        </View>

        {/* Witness Records */}
        {witnessRecords.length > 0 && (
          <View style={styles.witnessSection}>
            <ThemedText style={styles.witnessSectionHeader}>Witness Records</ThemedText>
            {witnessRecords.map((record, index) => (
              <View key={index} style={styles.witnessRecord}>
                {record.event && (
                  <View style={styles.witnessSubSection}>
                    <ThemedText style={styles.witnessLabel}>Event</ThemedText>
                    <ThemedText style={styles.witnessValue}>{record.event}</ThemedText>
                  </View>
                )}
                {record.witnessName && (
                  <View style={styles.witnessSubSection}>
                    <ThemedText style={styles.witnessLabel}>Witnessed By</ThemedText>
                    <ThemedText style={styles.witnessValue}>{record.witnessName}</ThemedText>
                  </View>
                )}
                {record.issuanceDate && (
                  <View style={styles.witnessSubSection}>
                    <ThemedText style={styles.witnessLabel}>Date</ThemedText>
                    <ThemedText style={styles.witnessValue}>
                      {new Date(record.issuanceDate).toLocaleDateString()}
                    </ThemedText>
                  </View>
                )}
                {record.localityVerification && (
                  <View style={styles.witnessSubSection}>
                    <ThemedText style={styles.witnessLabel}>Locality Verification</ThemedText>
                    <View style={styles.localityVerified}>
                      <Icon
                        name={record.localityVerification.confirmed ? 'check-circle' : 'information'}
                        size={16}
                        color={record.localityVerification.confirmed ? ColorPalette.semantic.success : ColorPalette.grayscale.mediumGrey}
                      />
                      <ThemedText style={styles.witnessValue}>
                        {record.localityVerification.confirmed ? 'Verified' : 'Not Verified'}
                        {record.localityVerification.type ? ` (${record.localityVerification.type})` : ''}
                      </ThemedText>
                    </View>
                    {record.localityVerification.details && (
                      <ThemedText style={[styles.witnessValue, { marginTop: 4 }]}>
                        {record.localityVerification.details}
                      </ThemedText>
                    )}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* View Messages */}
        <TouchableOpacity
          onPress={handleViewMessages}
          accessibilityLabel={t('ContactDetails.ViewMessages')}
          accessibilityRole="button"
          style={[styles.viewMessagesRow, !connectionId && { opacity: 0.5 }]}
          disabled={!connectionId}
        >
          <View style={styles.viewMessagesIconCircle}>
            {Assets.svg.tabFourIcon ? (
              <Assets.svg.tabFourIcon width={18} height={18} fill="#000000" color="#000000" />
            ) : (
              <Icon name="message-text-outline" size={18} color="#000000" />
            )}
          </View>
          <ThemedText style={styles.viewMessagesText}>
            {t('ContactDetails.ViewMessages')}
          </ThemedText>
        </TouchableOpacity>

        {/* Remove Contact */}
        <TouchableOpacity
          onPress={handleRemoveContact}
          accessibilityLabel={t('ContactDetails.RemoveContact')}
          accessibilityRole="button"
          style={styles.removeButton}
        >
          <ThemedText style={styles.removeButtonText}>{t('ContactDetails.RemoveContact')}</ThemedText>
        </TouchableOpacity>
      </ScrollView>

      <CommonRemoveModal
        usage={ModalUsage.ContactRemove}
        visible={isRemoveModalDisplayed}
        onSubmit={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />
    </SafeAreaView>
  )
}

export default ContactDetails
