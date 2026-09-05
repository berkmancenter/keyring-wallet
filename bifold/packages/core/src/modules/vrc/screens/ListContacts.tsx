import { W3cCredentialRecord } from '@credo-ts/core'

import { isPeerVrcCredential } from '../credentialTypes'
import { useNavigation, useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useMemo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, View, StyleSheet } from 'react-native'

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

const ListContacts: React.FC = () => {
  const { t: _t } = useTranslation()
  const [store, dispatch] = useStore()
  const [{ enableTours: enableToursConfig }, ContactCard] = useServices([TOKENS.CONFIG, TOKENS.COMPONENT_CONTACT_CARD])
  const navigation = useNavigation<StackNavigationProp<ContactStackParams>>()
  useTheme()
  const { start, stop } = useTour()
  const screenIsFocused = useIsFocused()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()

  const styles = StyleSheet.create({
    listContainer: {
      backgroundColor: '#F5F5F5',
      flex: 1,
    },
    listContentContainer: {
      paddingVertical: 8,
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
            photo: displayInfo.photo,
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

  // How a contact is drawn is injected, not hard-coded: an exchanged R-Card is
  // the app's most skinnable credential, and a demo profile swaps this token
  // for its own renderer (see app/src/demo-profiles/trading-card/) without
  // touching this screen.
  const renderContactItem = ({ item }: { item: ContactCredentialDetails }) => {
    return (
      <ContactCard
        contact={item}
        hardwareVerified={hwVerifiedMap[item.issuer.id] === true}
        onPress={() => {
          navigation.navigate(Screens.ContactDetails, { contact: item })
        }}
      />
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
