import { W3cCredentialRecord } from '@credo-ts/core'
import { useNavigation, useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useMemo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, View, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { DispatchAction } from '../../../contexts/reducers/store'
import { useStore } from '../../../contexts/store'
import { useTheme } from '../../../contexts/theme'
import { useTour } from '../../../contexts/tour/tour-context'
import { ContactStackParams, Screens, ContactCredentialDetails } from '../../../types/navigators'
import { TOKENS, useServices } from '../../../container-api'
import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { BaseTourID } from '../../../types/tour'
import EmptyContactsList from '../components/EmptyContactsList'
import {
  getWitnessCredentialsForSubject,
  extractWitnessInfo,
  hasVrcHardwareAttestation,
  getVrcCredentialJsonForSubject,
} from '../utils/witnessCredentialUtils'
import { verifyVrcHardwareEvidence } from '../services/BiometricSignatureVerifier'

const ListContacts: React.FC = () => {
  const { t: _t } = useTranslation()
  const [store, dispatch] = useStore()
  const [{ enableTours: enableToursConfig }] = useServices([TOKENS.CONFIG])
  const navigation = useNavigation<StackNavigationProp<ContactStackParams>>()
  useTheme()
  const { start, stop } = useTour()
  const screenIsFocused = useIsFocused()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()

  const CARD_BG = '#F5F5F5'
  const CARD_BORDER = 'rgba(170, 170, 170, 0.4)'
  const AVATAR_BG = '#E8E0E8'
  const NAME_COLOR = '#010B13'
  const BADGE_HW_TEAL = '#4D7A8B'
  const BADGE_WITNESS_PURPLE = '#A349A4'

  const styles = StyleSheet.create({
    listContainer: {
      backgroundColor: '#F5F5F5',
      flex: 1,
    },
    listContentContainer: {
      paddingVertical: 8,
    },
    itemContainer: {
      backgroundColor: CARD_BG,
      marginHorizontal: 14,
      marginVertical: 4,
      paddingHorizontal: 14,
      paddingVertical: 0,
      height: 62,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: CARD_BORDER,
      flexDirection: 'row',
      alignItems: 'center',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
        },
        android: {
          elevation: 3,
        },
      }),
    },
    avatarCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: AVATAR_BG,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    itemText: {
      fontFamily: 'SourceSans3-Regular',
      fontSize: 16,
      color: NAME_COLOR,
      flex: 1,
    },
    badgeContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
    },
    badgeIcon: {
      marginLeft: 4,
    },
  })

  // Helper function to check if contact has witness credentials
  const hasWitnessCredential = useCallback(
    (contactIssuerId: string): boolean => {
      const vwcs = getWitnessCredentialsForSubject(w3cCredentialRecords, contactIssuerId)
      return vwcs.length > 0
    },
    [w3cCredentialRecords]
  )

  // Track which contacts have passed cryptographic HW verification
  const [hwVerifiedMap, setHwVerifiedMap] = useState<Record<string, boolean>>({})

  // Only used to detect candidates that MIGHT have HW evidence (for triggering verification)
  const hasHardwareAttestationCredential = useCallback(
    (contactIssuerId: string): boolean => {
      if (hasVrcHardwareAttestation(w3cCredentialRecords, contactIssuerId)) {
        return true
      }
      const vwcs = getWitnessCredentialsForSubject(w3cCredentialRecords, contactIssuerId)
      return vwcs.some((vwc) => {
        const info = extractWitnessInfo(vwc)
        return info?.hardwareAttestationIncluded === true
      })
    },
    [w3cCredentialRecords]
  )

  // Helper function to extract issuer from W3C credential
  const extractIssuer = (
    credential: W3cCredentialRecord
  ): { id: string; name?: string; email?: string; organization?: string } | null => {
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
    } catch (error) {
      console.warn('[VRC:Contacts] extractIssuer error:', error)
    }

    return null
  }

  // Helper function to format issuer name with fallback
  const formatIssuerName = (issuerId: string, issuerName?: string): string => {
    if (issuerName) {
      return issuerName
    }
    const last8 = issuerId.slice(-8)
    return `Unknown ...${last8}`
  }

  // Helper function to check if credential type contains "DTGCredential" but NOT "WitnessCredential"
  const hasDTGCredentialType = (credential: W3cCredentialRecord): boolean => {
    try {
      const credentialData = credential.credential

      if (
        credentialData &&
        typeof credentialData === 'object' &&
        !Array.isArray(credentialData) &&
        'type' in credentialData
      ) {
        const typeValue = (credentialData as any).type
        const types = Array.isArray(typeValue) ? typeValue : [typeValue]

        const hasDTG = types.some((type) => typeof type === 'string' && type.includes('DTGCredential'))
        const hasWitness = types.some((type) => typeof type === 'string' && type === 'WitnessCredential')

        return hasDTG && !hasWitness
      }
    } catch (error) {
      console.warn('[VRC:Contacts] hasDTGCredentialType error:', error)
    }

    return false
  }

  // Helper function to extract date from credential (validFrom or issuanceDate)
  const getCredentialDate = (credential: W3cCredentialRecord): Date | null => {
    try {
      const credentialData = credential.credential

      if (credentialData && typeof credentialData === 'object' && !Array.isArray(credentialData)) {
        if ('validFrom' in credentialData && credentialData.validFrom) {
          const validFrom = credentialData.validFrom
          if (typeof validFrom === 'string') {
            return new Date(validFrom)
          }
        }

        if ('issuanceDate' in credentialData && credentialData.issuanceDate) {
          const issuanceDate = credentialData.issuanceDate
          if (typeof issuanceDate === 'string') {
            return new Date(issuanceDate)
          }
        }
      }
    } catch (error) {
      console.warn('[VRC:Contacts] getCredentialDate error:', error)
    }

    return null
  }

  // Filter and group credentials by issuer
  const groupedContacts = useMemo(() => {
    const filteredCredentials = w3cCredentialRecords.filter((cred) => hasDTGCredentialType(cred))

    const issuerGroupsMap = new Map<string, W3cCredentialRecord[]>()

    filteredCredentials.forEach((credential) => {
      const issuerData = extractIssuer(credential)
      if (issuerData) {
        const { id } = issuerData
        if (!issuerGroupsMap.has(id)) {
          issuerGroupsMap.set(id, [])
        }
        issuerGroupsMap.get(id)!.push(credential)
      }
    })

    const contactDetails: ContactCredentialDetails[] = []

    issuerGroupsMap.forEach((credentials, _issuerId) => {
      const sortedCredentials = credentials.sort((a, b) => {
        const dateA = getCredentialDate(a)
        const dateB = getCredentialDate(b)

        if (dateA && dateB) {
          return dateB.getTime() - dateA.getTime()
        }
        if (dateA) return -1
        if (dateB) return 1
        return 0
      })

      const mostRecentCredential = sortedCredentials[0]
      const issuerData = extractIssuer(mostRecentCredential)

      if (issuerData) {
        const { id, name, email, organization } = issuerData
        contactDetails.push({
          issuer: {
            id,
            name: formatIssuerName(id, name),
            email,
            organization,
          },
          hasWitnessCredentials: hasWitnessCredential(id),
          hasHardwareAttestation: hasHardwareAttestationCredential(id),
        })
      }
    })

    return contactDetails.sort((a, b) => a.issuer.name.localeCompare(b.issuer.name))
  }, [w3cCredentialRecords])

  // Run cryptographic verification for contacts that claim HW attestation
  useEffect(() => {
    let cancelled = false
    const candidates = groupedContacts.filter((c) => c.hasHardwareAttestation)
    if (candidates.length === 0) return

    const verifyAll = async () => {
      const results: Record<string, boolean> = {}
      for (const contact of candidates) {
        if (cancelled) return
        try {
          const rawCred = getVrcCredentialJsonForSubject(w3cCredentialRecords, contact.issuer.id)
          if (!rawCred) {
            results[contact.issuer.id] = false
            continue
          }
          const result = await verifyVrcHardwareEvidence(rawCred as any)
          results[contact.issuer.id] = result?.valid === true
        } catch (error) {
          console.warn('[VRC:Contacts] HW verification error:', error)
          results[contact.issuer.id] = false
        }
      }
      if (!cancelled) {
        setHwVerifiedMap((prev) => ({ ...prev, ...results }))
      }
    }

    verifyAll()
    return () => {
      cancelled = true
    }
  }, [groupedContacts, w3cCredentialRecords])

  useEffect(() => {
    const shouldShowTour = enableToursConfig && store.tours.enableTours && !store.tours.seenContactsTour

    if (shouldShowTour && screenIsFocused) {
      start(BaseTourID.ContactsTour)
      dispatch({
        type: DispatchAction.UPDATE_SEEN_CONTACTS_TOUR,
        payload: [true],
      })
    }
  }, [enableToursConfig, store.tours.enableTours, store.tours.seenContactsTour, screenIsFocused, start, dispatch])

  useEffect(() => {
    return stop
  }, [stop])

  const renderContactItem = ({ item }: { item: ContactCredentialDetails }) => {
    return (
      <TouchableOpacity
        style={styles.itemContainer}
        onPress={() => {
          navigation.navigate(Screens.ContactDetails, { contact: item })
        }}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`Contact: ${item.issuer.name}`}
      >
        <View style={styles.avatarCircle}>
          <Icon name="account-outline" size={22} color="#666666" />
        </View>
        <ThemedText style={styles.itemText}>{item.issuer.name}</ThemedText>
        <View style={styles.badgeContainer}>
          {hwVerifiedMap[item.issuer.id] === true && (
            <Icon name="shield-check" size={18} color={BADGE_HW_TEAL} style={styles.badgeIcon} />
          )}
          {item.hasWitnessCredentials && (
            <Icon name="check-decagram" size={18} color={BADGE_WITNESS_PURPLE} style={styles.badgeIcon} />
          )}
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={styles.listContainer}
        contentContainerStyle={[{ flexGrow: 1 }, styles.listContentContainer]}
        data={groupedContacts}
        keyExtractor={(item) => item.issuer.id}
        renderItem={renderContactItem}
        ListEmptyComponent={EmptyContactsList}
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

export default ListContacts
