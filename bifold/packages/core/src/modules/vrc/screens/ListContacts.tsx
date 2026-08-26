import { W3cCredentialRecord } from '@credo-ts/core'

import { isPeerVrcCredential } from '../credentialTypes'
import { useConnections } from '@bifold/react-hooks'
import { useNavigation, useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useMemo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, View, TouchableOpacity, StyleSheet, Platform } from 'react-native'
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
import { resolveContactDisplayInfo } from '../utils/rcardDisplayUtils'
import { verifyVrcHardwareEvidence } from '../services/BiometricSignatureVerifier'
import { vrcFlowStore } from '../witnessStatusStore'
import { getConnectionName } from '../../../utils/helpers'

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
  const { records: connectionRecords } = useConnections()

  // Exchanges in flight whose VRC hasn't landed yet: shown as pending rows so
  // the new contact is visible immediately, not only once credentials arrive.
  const [inFlightConnectionIds, setInFlightConnectionIds] = useState<string[]>(() =>
    vrcFlowStore.getInFlightConnectionIds()
  )
  useEffect(() => {
    const refresh = () => setInFlightConnectionIds(vrcFlowStore.getInFlightConnectionIds())
    vrcFlowStore.on('flowUpdate', refresh)
    return () => {
      vrcFlowStore.off('flowUpdate', refresh)
    }
  }, [])

  const pendingContacts = useMemo(
    () =>
      inFlightConnectionIds
        .map((connectionId) => {
          const connection = connectionRecords.find((r) => r.id === connectionId)
          if (!connection) return undefined
          return {
            connectionId,
            name: getConnectionName(connection, store.preferences.alternateContactNames ?? {}),
          }
        })
        .filter((p): p is { connectionId: string; name: string } => p !== undefined),
    [inFlightConnectionIds, connectionRecords, store.preferences.alternateContactNames]
  )

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
    pendingSubtitle: {
      fontFamily: 'SourceSans3-Regular',
      fontSize: 13,
      color: '#666666',
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
      const credentialData = credential.encoded

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
      // eslint-disable-next-line no-console
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
      const credentialData = credential.encoded

      if (
        credentialData &&
        typeof credentialData === 'object' &&
        !Array.isArray(credentialData) &&
        'type' in credentialData
      ) {
        return isPeerVrcCredential(credentialData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[VRC:Contacts] hasDTGCredentialType error:', error)
    }

    return false
  }

  // Helper function to extract date from credential (validFrom or issuanceDate)
  const getCredentialDate = (credential: W3cCredentialRecord): Date | null => {
    try {
      const credentialData = credential.encoded

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
      // eslint-disable-next-line no-console
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
        // Contact info source: received RCard first (post-separation exchanges),
        // then the legacy VRC issuer object fields (pre-separation exchanges).
        const displayInfo = resolveContactDisplayInfo(w3cCredentialRecords, id)
        contactDetails.push({
          issuer: {
            id,
            name: formatIssuerName(id, displayInfo.name || name),
            email: displayInfo.email || email,
            organization: displayInfo.organization || organization,
          },
          hasWitnessCredentials: hasWitnessCredential(id),
          hasHardwareAttestation: hasHardwareAttestationCredential(id),
        })
      }
    })

    return contactDetails.sort((a, b) => a.issuer.name.localeCompare(b.issuer.name))
  }, [w3cCredentialRecords, hasWitnessCredential, hasHardwareAttestationCredential])

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
          // eslint-disable-next-line no-console
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

  // Pending rows render above the credential-backed contacts. Same card
  // styling; a spinner instead of badges, and not tappable — there is no
  // contact detail to show until the credential lands.
  const renderPendingRows = () =>
    pendingContacts.length === 0 ? null : (
      <View>
        {pendingContacts.map((pending) => (
          <View
            key={`pending-${pending.connectionId}`}
            style={styles.itemContainer}
            accessible={true}
            accessibilityLabel={`Contact exchange in progress: ${pending.name}`}
          >
            <View style={styles.avatarCircle}>
              <Icon name="account-outline" size={22} color="#666666" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.itemText}>{pending.name}</ThemedText>
              <ThemedText style={styles.pendingSubtitle}>Exchange in progress...</ThemedText>
            </View>
            <ActivityIndicator size="small" color="#666666" />
          </View>
        ))}
      </View>
    )

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={styles.listContainer}
        contentContainerStyle={[{ flexGrow: 1 }, styles.listContentContainer]}
        data={groupedContacts}
        keyExtractor={(item) => item.issuer.id}
        renderItem={renderContactItem}
        ListHeaderComponent={renderPendingRows()}
        ListEmptyComponent={pendingContacts.length === 0 ? EmptyContactsList : null}
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

export default ListContacts
