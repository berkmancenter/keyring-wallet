import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { CredentialExchangeRecord, CredentialRole, CredentialState, SdJwtVcRecord, W3cCredentialRecord } from '@credo-ts/core'
import { useCredentialByState } from '@credo-ts/react-hooks'
import { useNavigation, useIsFocused } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, View } from 'react-native'

import CredentialCard from '../components/misc/CredentialCard'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { useTour } from '../contexts/tour/tour-context'
import { RootStackParams, Screens } from '../types/navigators'
import { TOKENS, useServices } from '../container-api'
import { EmptyListProps } from '../components/misc/EmptyList'
import { CredentialListFooterProps } from '../types/credential-list-footer'
import { useOpenIDCredentials } from '../modules/openid/context/OpenIDCredentialRecordProvider'
import { GenericCredentialExchangeRecord } from '../types/credentials'
import { CredentialErrors } from '../components/misc/CredentialCard11'
import { BaseTourID } from '../types/tour'
import { OpenIDCredentialType } from '../modules/openid/types'

const ListCredentials: React.FC = () => {
  const { t } = useTranslation()
  const [store, dispatch] = useStore()
  const [
    CredentialListOptions,
    credentialEmptyList,
    credentialListFooter,
    { enableTours: enableToursConfig, credentialHideList },
  ] = useServices([
    TOKENS.COMPONENT_CRED_LIST_OPTIONS,
    TOKENS.COMPONENT_CRED_EMPTY_LIST,
    TOKENS.COMPONENT_CRED_LIST_FOOTER,
    TOKENS.CONFIG,
  ])
  const navigation = useNavigation<StackNavigationProp<RootStackParams>>()
  const { ColorPalette } = useTheme()
  const { start, stop } = useTour()
  const screenIsFocused = useIsFocused()
  const {
    openIdState: { w3cCredentialRecords, sdJwtVcRecords },
  } = useOpenIDCredentials()

  let credentials: GenericCredentialExchangeRecord[] = [
    ...useCredentialByState(CredentialState.CredentialReceived),
    ...useCredentialByState(CredentialState.Done),
    ...w3cCredentialRecords,
    ...sdJwtVcRecords,
  ]

  // Deduplicate: if a credential exists in both CredentialReceived and Done states
  // (same threadId), keep only the Done record. This prevents ghost "Unknown Credential"
  // cards from appearing during the brief transition between states.
  const doneThreadIds = new Set(
    credentials
      .filter((r): r is CredentialExchangeRecord =>
        r instanceof CredentialExchangeRecord && r.state === CredentialState.Done
      )
      .map((r) => r.threadId)
      .filter(Boolean)
  )
  credentials = credentials.filter((r) => {
    if (
      r instanceof CredentialExchangeRecord &&
      r.state === CredentialState.CredentialReceived &&
      r.threadId &&
      doneThreadIds.has(r.threadId)
    ) {
      return false
    }
    return true
  })

  const CredentialEmptyList = credentialEmptyList as React.FC<EmptyListProps>
  const CredentialListFooter = credentialListFooter as React.FC<CredentialListFooterProps>

  // Helper function to check if credential should be hidden from wallet view
  // This includes DTGCredential (RelationshipCredential) and RCardTemplate
  const shouldHideFromWallet = (credential: GenericCredentialExchangeRecord): boolean => {
    try {
      const cred = credential as any

      // For W3C credentials - check if it has a 'credential' property (duck typing)
      // This handles both W3cCredentialRecord instances and plain objects
      if (cred.credential && typeof cred.credential === 'object') {
        const credentialData = cred.credential

        // Check the type property on the credential
        if ('type' in credentialData) {
          const typeValue = credentialData.type
          const types = Array.isArray(typeValue) ? typeValue : [typeValue]

          // Check for credential types that should be hidden from wallet
          // - DTGCredential: Relationship credentials (shown in Contacts)
          // - RelationshipCredential: Peer VRC exchanges (shown in Contacts)
          // - RCardTemplate: Self-issued business card (internal use only)
          if (
            types.some(
              (type: unknown) =>
                typeof type === 'string' &&
                (type.includes('DTGCredential') ||
                  type.includes('RelationshipCredential') ||
                  type.includes('RCardTemplate'))
            )
          ) {
            return true
          }
        }
      }

      // For CredentialExchangeRecord - hide issuer role records
      // Issuer role means YOU issued this credential to someone else, not a credential you hold
      if (cred.role === CredentialRole.Issuer) {
        return true
      }

      // For CredentialExchangeRecord (DIDComm exchanges) - hide JSON-LD exchange records.
      // JSON-LD credentials via DIDComm create both a CredentialExchangeRecord AND a
      // W3cCredentialRecord. We hide the exchange record to avoid duplicate/unknown cards,
      // since the W3cCredentialRecord handles display.
      //
      // Detection strategy: AnonCreds exchange records have credentialAttributes populated
      // and/or AnonCreds metadata. If neither is present, it's a JSON-LD exchange record.
      if (cred.state === CredentialState.Done || cred.state === CredentialState.CredentialReceived) {
        const hasAnonCredsMetadata =
          cred.metadata?.data?.[AnonCredsCredentialMetadataKey]?.credentialDefinitionId ||
          cred.metadata?._anoncreds?.credentialDefinitionId
        const hasCredentialAttributes =
          cred.credentialAttributes && Array.isArray(cred.credentialAttributes) && cred.credentialAttributes.length > 0
        const hasW3cBinding =
          cred.credentials &&
          Array.isArray(cred.credentials) &&
          cred.credentials.some((c: any) => c.credentialRecordType === 'w3c')
        const hasAnyBindings =
          cred.credentials && Array.isArray(cred.credentials) && cred.credentials.length > 0

        // Only apply JSON-LD exchange record hiding when there are actual credential bindings.
        // Records with no bindings are either pending or minimal mock records.
        if (hasAnyBindings && !hasAnonCredsMetadata && !hasCredentialAttributes) {
          return true
        }
        if (hasW3cBinding && !hasAnonCredsMetadata) {
          return true
        }
      }

      // For SdJwtVc records - check compactSdJwtVc property
      if (cred.compactSdJwtVc && typeof cred.compactSdJwtVc === 'object') {
        const credentialData = cred.compactSdJwtVc
        if ('type' in credentialData) {
          const typeValue = credentialData.type
          const types = Array.isArray(typeValue) ? typeValue : [typeValue]
          if (
            types.some(
              (type: unknown) =>
                typeof type === 'string' &&
                (type.includes('DTGCredential') ||
                  type.includes('RelationshipCredential') ||
                  type.includes('RCardTemplate'))
            )
          ) {
            return true
          }
        }
      }

      // For AnonCreds CredentialExchangeRecord, check credential attributes
      if (cred.credentialAttributes && Array.isArray(cred.credentialAttributes)) {
        const typeAttribute = cred.credentialAttributes.find((attr: any) => attr && attr.name === 'type')

        if (
          typeAttribute &&
          typeAttribute.value &&
          typeof typeAttribute.value === 'string' &&
          (typeAttribute.value.includes('DTGCredential') ||
            typeAttribute.value.includes('RelationshipCredential') ||
            typeAttribute.value.includes('RCardTemplate'))
        ) {
          return true
        }
      }
    } catch {
      // If any error occurs during type checking, default to false (show in Wallet)
    }

    return false
  }

  // Build a set of W3cCredentialRecord IDs that are already referenced by a
  // CredentialExchangeRecord (via its credentials bindings). These W3C records
  // are internal duplicates created by Credo for AnonCreds-in-W3C format;
  // the exchange record already handles display with proper OCA branding.
  const w3cIdsOwnedByExchangeRecords = new Set<string>()
  credentials.forEach((r) => {
    const cred = r as any
    if (cred.credentials && Array.isArray(cred.credentials)) {
      cred.credentials.forEach((binding: any) => {
        if (binding.credentialRecordId) {
          w3cIdsOwnedByExchangeRecords.add(binding.credentialRecordId)
        }
      })
    }
  })

  // Remove W3cCredentialRecords that are already represented by a CredentialExchangeRecord
  credentials = credentials.filter((r) => {
    if (r instanceof W3cCredentialRecord && w3cIdsOwnedByExchangeRecords.has(r.id)) {
      return false
    }
    return true
  })

  // Filter out credentials that should be hidden from wallet view
  credentials = credentials.filter((r) => !shouldHideFromWallet(r))

  // Filter out hidden credentials when not in dev mode
  if (!store.preferences.developerModeEnabled) {
    credentials = credentials.filter((r) => {
      const credDefId = r.metadata.get(AnonCredsCredentialMetadataKey)?.credentialDefinitionId
      return !credentialHideList?.includes(credDefId)
    })
  }

  useEffect(() => {
    const shouldShowTour = enableToursConfig && store.tours.enableTours && !store.tours.seenCredentialsTour

    if (shouldShowTour && screenIsFocused) {
      start(BaseTourID.CredentialsTour)
      dispatch({
        type: DispatchAction.UPDATE_SEEN_CREDENTIALS_TOUR,
        payload: [true],
      })
    }
  }, [enableToursConfig, store.tours.enableTours, store.tours.seenCredentialsTour, screenIsFocused, start, dispatch])

  // stop the tour when the screen unmounts
  useEffect(() => {
    return stop
  }, [stop])

  const renderCardItem = (cred: GenericCredentialExchangeRecord) => {
    return (
      <CredentialCard
        credential={cred as CredentialExchangeRecord}
        credentialErrors={
          (cred as CredentialExchangeRecord).revocationNotification?.revocationDate && [CredentialErrors.Revoked]
        }
        onPress={() => {
          if (cred instanceof W3cCredentialRecord) {
            navigation.navigate(Screens.OpenIDCredentialDetails, {
              credentialId: cred.id,
              type: OpenIDCredentialType.W3cCredential,
            })
          } else if (cred instanceof SdJwtVcRecord) {
            navigation.navigate(Screens.OpenIDCredentialDetails, {
              credentialId: cred.id,
              type: OpenIDCredentialType.SdJwtVc,
            })
          } else {
            navigation.navigate(Screens.CredentialDetails, { credentialId: cred.id })
          }
        }}
      />
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={{ backgroundColor: ColorPalette.brand.primaryBackground }}
        contentContainerStyle={{ flexGrow: 1 }}
        data={credentials.sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())}
        keyExtractor={(credential) => credential.id}
        renderItem={({ item: credential, index }) => {
          return (
            <View
              style={{
                marginHorizontal: 15,
                marginTop: 15,
                marginBottom: index === credentials.length - 1 ? 45 : 0,
              }}
            >
              {renderCardItem(credential)}
            </View>
          )
        }}
        ListEmptyComponent={() => <CredentialEmptyList message={t('Credentials.EmptyList')} />}
        ListFooterComponent={() => <CredentialListFooter credentialsCount={credentials.length} />}
      />
      <CredentialListOptions />
    </View>
  )
}

export default ListCredentials
