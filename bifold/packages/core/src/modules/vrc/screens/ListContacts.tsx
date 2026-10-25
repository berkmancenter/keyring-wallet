import { W3cCredentialRecord } from '@credo-ts/core'

import { isPeerVrcCredential } from '../credentialTypes'
import { useNavigation, useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect, useMemo, useCallback } from 'react'
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
  getVerifiedWitnessCredentialsForSubject,
  extractWitnessInfo,
  hasVrcHardwareAttestation,
} from '../utils/witnessCredentialUtils'
import { resolveContactDisplayInfo } from '../utils/rcardDisplayUtils'
import { testIdWithKey } from '../../../utils/testable'
import { contactIdOf } from '../contacts/contactLinks'
import { useContactFacts } from '../contacts/useContactFacts'
import { useContactLinks } from '../contacts/useContactLinks'
import type { ContactCardProps } from '../../../types/contact-card'

const ListContacts: React.FC = () => {
  const { t } = useTranslation()
  const [store, dispatch] = useStore()
  const [{ enableTours: enableToursConfig }, ContactCard] = useServices([TOKENS.CONFIG, TOKENS.COMPONENT_CONTACT_CARD])
  const navigation = useNavigation<StackNavigationProp<ContactStackParams>>()
  useTheme()
  const { start, stop } = useTour()
  const screenIsFocused = useIsFocused()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()
  // Read again on each return to the list, so a merge or a separation made on a contact's screen shows here.
  const contactLinks = useContactLinks(screenIsFocused)

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
      const vwcs = getVerifiedWitnessCredentialsForSubject(w3cCredentialRecords, contactIssuerId)
      return vwcs.length > 0
    },
    [w3cCredentialRecords]
  )

  // Helper function to check if any of this contact's VWCs confirmed locality
  // (BLE co-presence) — locality-plan.md §8.2/§9.1. Any confirmed VWC is
  // enough, same "any, not all" rule as hasWitnessCredential above.
  const hasLocalityConfirmed = useCallback(
    (contactIssuerId: string): boolean => {
      const vwcs = getVerifiedWitnessCredentialsForSubject(w3cCredentialRecords, contactIssuerId)
      return vwcs.some((vwc) => extractWitnessInfo(vwc)?.locality?.outcome === 'confirmed')
    },
    [w3cCredentialRecords]
  )

  // Track which contacts have passed cryptographic HW verification

  // Only used to detect candidates that MIGHT have HW evidence (for triggering verification)
  const hasHardwareAttestationCredential = useCallback(
    (contactIssuerId: string): boolean => {
      if (hasVrcHardwareAttestation(w3cCredentialRecords, contactIssuerId)) {
        return true
      }
      const vwcs = getVerifiedWitnessCredentialsForSubject(w3cCredentialRecords, contactIssuerId)
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
  const formatIssuerName = useCallback(
    (_issuerId: string, issuerName?: string): string =>
      // Not a piece of the DID in the name's place (#12).
      issuerName || t('ContactDetails.UnnamedContact'),
    [t]
  )

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

  // Filter and group credentials by contact: one row per contact, which is one relationship (issuer) unless
  // relationships were merged. The row is the relationship of the newest card; badges cover every relationship.
  const { groupedContacts, relationshipsByRow } = useMemo(() => {
    const filteredCredentials = w3cCredentialRecords.filter((cred) => hasDTGCredentialType(cred))

    const issuerGroupsMap = new Map<string, W3cCredentialRecord[]>()

    filteredCredentials.forEach((credential) => {
      const issuerData = extractIssuer(credential)
      if (issuerData) {
        const contactId = contactIdOf(contactLinks, issuerData.id)
        if (!issuerGroupsMap.has(contactId)) {
          issuerGroupsMap.set(contactId, [])
        }
        issuerGroupsMap.get(contactId)!.push(credential)
      }
    })

    const contactDetails: ContactCredentialDetails[] = []
    // A row's issuer id → every relationship (issuer id) of that contact, the row's own first.
    const rowRelationships = new Map<string, string[]>()

    issuerGroupsMap.forEach((credentials, _contactId) => {
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
        const relationships = [id]
        for (const credential of sortedCredentials) {
          const other = extractIssuer(credential)?.id
          if (other && !relationships.includes(other)) relationships.push(other)
        }
        rowRelationships.set(id, relationships)
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
          hasWitnessCredentials: relationships.some(hasWitnessCredential),
          hasHardwareAttestation: relationships.some(hasHardwareAttestationCredential),
          hasLocalityConfirmed: relationships.some(hasLocalityConfirmed),
        })
      }
    })

    return {
      groupedContacts: contactDetails.sort((a, b) => a.issuer.name.localeCompare(b.issuer.name)),
      relationshipsByRow: rowRelationships,
    }
  }, [
    w3cCredentialRecords,
    contactLinks,
    hasWitnessCredential,
    hasHardwareAttestationCredential,
    hasLocalityConfirmed,
    formatIssuerName,
  ])

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
      <ContactRow
        Card={ContactCard}
        contact={item}
        relationships={relationshipsByRow.get(item.issuer.id) ?? [item.issuer.id]}
        onPress={() => {
          navigation.navigate(Screens.ContactDetails, { contact: item })
        }}
        testID={testIdWithKey('ContactCard')}
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

/**
 * One contact, with its hardware verification from the facts every screen
 * shares (contacts/useContactFacts): verified once, not again here and again on
 * the contact's page. While evidence the contact carries is checked, the card
 * may hold the badge's place (UI-smoothness plan, Phase 4).
 */
const ContactRow: React.FC<{
  Card: React.FC<ContactCardProps>
  contact: ContactCredentialDetails
  relationships: string[]
  onPress: () => void
  testID: string
}> = ({ Card, contact, relationships, onPress, testID }) => {
  const { hwVerified } = useContactFacts(relationships)
  return (
    <Card
      contact={contact}
      hardwareVerified={hwVerified.known && hwVerified.value}
      hardwareChecking={!hwVerified.known && contact.hasHardwareAttestation === true}
      onPress={onPress}
      testID={testID}
    />
  )
}
