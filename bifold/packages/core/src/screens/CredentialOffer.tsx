import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import { CredentialPreviewAttribute } from '@credo-ts/core'
import { useCredentialById } from '@credo-ts/react-hooks'
import { BrandingOverlay, MetaOverlay } from '@bifold/oca'
import { Attribute, CredentialOverlay, Field } from '@bifold/oca/build/legacy'
import { useIsFocused } from '@react-navigation/native'
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../components/buttons/Button'
import ConnectionImage from '../components/misc/ConnectionImage'
import CredentialCard from '../components/misc/CredentialCard'
import CommonRemoveModal from '../components/modals/CommonRemoveModal'
import Record from '../components/record/Record'
import { EventTypes } from '../constants'
import { TOKENS, useServices, useContainer } from '../container-api'
import { useAnimatedComponents } from '../contexts/animated-components'
import { useNetwork } from '../contexts/network'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { useTour } from '../contexts/tour/tour-context'
import { useOutOfBandByConnectionId } from '../hooks/connections'
import { HistoryCardType, HistoryRecord } from '../modules/history/types'
import { BifoldError } from '../types/error'
import { Stacks } from '../types/navigators'
import { ModalUsage } from '../types/remove'
import { useAppAgent } from '../utils/agent'
import { getCredentialName } from '../utils/cred-def'
import { getCredentialIdentifiers, isValidAnonCredsCredential } from '../utils/credential'
import { useCredentialConnectionLabel } from '../utils/helpers'
import { buildFieldsFromAnonCredsCredential } from '../utils/oca'
import { testIdWithKey } from '../utils/testable'

import CredentialOfferAccept from './CredentialOfferAccept'
import { BaseTourID } from '../types/tour'
import { ThemedText } from '../components/texts/ThemedText'
import { isDTGCredentialType } from '../types/credential-display'
import { validateRelationshipCredential, RelationshipCredentialValidation } from '../modules/vrc/vrc-manager'
import { verifyVrcHardwareEvidence, SignatureVerificationResult } from '../modules/vrc/services/BiometricSignatureVerifier'
import type { HardwareAttestationEvidence } from '../modules/vrc/types/evidence'
import WitnessVerifiedBanner from '../modules/vrc/components/WitnessVerifiedBanner'

type CredentialOfferProps = {
  navigation: any
  credentialId: string
}

const CredentialOffer: React.FC<CredentialOfferProps> = ({ navigation, credentialId }) => {
  const { agent } = useAppAgent()
  const { t, i18n } = useTranslation()
  const { ColorPalette } = useTheme()
  const { RecordLoading } = useAnimatedComponents()
  const { assertNetworkConnected } = useNetwork()
  const [
    bundleResolver,
    { enableTours: enableToursConfig },
    logger,
    historyManagerCurried,
    historyEnabled,
    historyEventsLogger,
  ] = useServices([
    TOKENS.UTIL_OCA_RESOLVER,
    TOKENS.CONFIG,
    TOKENS.UTIL_LOGGER,
    TOKENS.FN_LOAD_HISTORY,
    TOKENS.HISTORY_ENABLED,
    TOKENS.HISTORY_EVENTS_LOGGER,
  ])

  // Get credential display registry from container (optional - may not be registered)
  const container = useContainer()
  const credentialDisplayRegistry = useMemo(() => {
    try {
      return container.resolve(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY)
    } catch {
      return undefined
    }
  }, [container])
  const [loading, setLoading] = useState<boolean>(true)
  const [buttonsVisible, setButtonsVisible] = useState(true)
  const [acceptModalVisible, setAcceptModalVisible] = useState(false)
  const [declineModalVisible, setDeclineModalVisible] = useState(false)
  const [overlay, setOverlay] = useState<CredentialOverlay<BrandingOverlay>>({ presentationFields: [] })
  const [isJsonLdCredential, setIsJsonLdCredential] = useState(false)
  const [jsonLdCredentialData, setJsonLdCredentialData] = useState<any>(null)
  const [customDisplayFields, setCustomDisplayFields] = useState<Field[]>([])
  const [customButtonText, setCustomButtonText] = useState<{ accept: string; decline: string } | null>(null)
  const [credentialTypeName, setCredentialTypeName] = useState<string | null>(null)
  const [didValidation, setDidValidation] = useState<RelationshipCredentialValidation | null>(null)
  const [attestationValidation, setAttestationValidation] = useState<SignatureVerificationResult | null>(null)
  const credential = useCredentialById(credentialId)
  const credentialConnectionLabel = useCredentialConnectionLabel(credential)
  const [store, dispatch] = useStore()
  const { start } = useTour()
  const screenIsFocused = useIsFocused()
  const goalCode = useOutOfBandByConnectionId(credential?.connectionId ?? '')?.outOfBandInvitation?.goalCode
  const [ConnectionAlert] = useServices([TOKENS.COMPONENT_CONNECTION_ALERT])
  const processedCredentialRef = useRef<string | null>(null)

  // Check if this is a VRC (Verifiable Relationship Credential) exchange
  // VRC credentials should navigate to Contacts instead of Wallet after acceptance
  const isVrcCredential = goalCode?.includes('relationship.credential')

  const styles = StyleSheet.create({
    headerTextContainer: {
      paddingHorizontal: 25,
      paddingVertical: 16,
    },
    headerText: {
      flexShrink: 1,
    },
    footerButton: {
      paddingTop: 10,
    },
  })

  // Determine if this is a VRC/contact credential
  // Check both goal code and credential type (JSON-LD credentials have type array)
  const isContactCredential = useMemo(() => {
    // Check goal code first
    if (goalCode?.includes('relationship.credential')) {
      return true
    }
    // Check JSON-LD credential type array
    if (jsonLdCredentialData?.type) {
      const types = Array.isArray(jsonLdCredentialData.type) ? jsonLdCredentialData.type : [jsonLdCredentialData.type]
      return types.some(
        (type: unknown) =>
          typeof type === 'string' && (type.includes('DTGCredential') || type.includes('RelationshipCredential'))
      )
    }
    return false
  }, [goalCode, jsonLdCredentialData])

  // Tour logic - show contact offer tour for VRC credentials, credential offer tour for others
  // Only run after loading is complete so we know the credential type
  useEffect(() => {
    // Don't show tour while still loading - we need to know if it's a contact credential first
    if (loading) {
      return
    }

    // Use appropriate tour based on credential type
    if (isContactCredential) {
      const shouldShowContactTour = enableToursConfig && store.tours.enableTours && !store.tours.seenContactOfferTour
      if (shouldShowContactTour && screenIsFocused) {
        start(BaseTourID.ContactOfferTour)
        dispatch({
          type: DispatchAction.UPDATE_SEEN_CONTACT_OFFER_TOUR,
          payload: [true],
        })
      }
    } else {
      const shouldShowTour = enableToursConfig && store.tours.enableTours && !store.tours.seenCredentialOfferTour
      if (shouldShowTour && screenIsFocused) {
        start(BaseTourID.CredentialOfferTour)
        dispatch({
          type: DispatchAction.UPDATE_SEEN_CREDENTIAL_OFFER_TOUR,
          payload: [true],
        })
      }
    }
  }, [
    enableToursConfig,
    store.tours.enableTours,
    store.tours.seenCredentialOfferTour,
    store.tours.seenContactOfferTour,
    screenIsFocused,
    start,
    dispatch,
    isContactCredential,
    loading,
  ])

  useEffect(() => {
    if (!agent || !credential) {
      DeviceEventEmitter.emit(
        EventTypes.ERROR_ADDED,
        new BifoldError(t('Error.Title1035'), t('Error.Message1035'), t('CredentialOffer.CredentialNotFound'), 1035)
      )
    }
  }, [agent, credential, t])

  useEffect(() => {
    if (!credential || !agent) {
      return
    }

    if (processedCredentialRef.current === credential.id) {
      return
    }

    const processCredential = async () => {
      processedCredentialRef.current = credential.id
      setLoading(true)

      try {
        // Get format data to determine credential type
        const formatData = await agent.credentials.getFormatData(credential.id)
        logger?.info(`[CredentialOffer] Format data: ${JSON.stringify(formatData, null, 2)}`)

        // Check if this is a JSON-LD credential (data integrity format)
        const hasJsonLdOffer =
          formatData?.offer && ('dataIntegrity' in formatData.offer || 'ldProof' in formatData.offer)
        const hasNoAnonCredsOffer =
          formatData?.offer && !('indy' in formatData.offer) && !('anoncreds' in formatData.offer)

        logger?.info(
          `[CredentialOffer] hasJsonLdOffer=${hasJsonLdOffer}, hasNoAnonCredsOffer=${hasNoAnonCredsOffer}, offer keys: ${
            formatData?.offer ? Object.keys(formatData.offer) : 'none'
          }`
        )

        if (hasJsonLdOffer || (hasNoAnonCredsOffer && formatData?.offer)) {
          // This is a JSON-LD credential offer
          logger?.info('[CredentialOffer] Detected JSON-LD credential offer')
          setIsJsonLdCredential(true)

          // Extract the credential data from the offer
          // Try multiple possible locations for the credential data
          const offer = formatData.offer as any
          const credentialData =
            offer?.dataIntegrity?.credential ||
            offer?.ldProof?.credential ||
            offer?.jsonld?.credential || // aries/ld-proof-vc-detail@v1.0 format
            offer?.jsonLd?.credential || // alternative casing
            offer?.credential // direct credential property

          logger?.info(
            `[CredentialOffer] Extracted credential data: ${
              credentialData ? JSON.stringify(credentialData, null, 2).substring(0, 500) : 'null'
            }`
          )

          if (credentialData) {
            setJsonLdCredentialData(credentialData)

            logger?.info(`[CredentialOffer] credentialDisplayRegistry available: ${!!credentialDisplayRegistry}`)
            logger?.info(`[CredentialOffer] isDTGCredentialType: ${isDTGCredentialType(credentialData)}`)

            // Check if it's a DTG credential and use custom display
            if (isDTGCredentialType(credentialData) && credentialDisplayRegistry) {
              const displayInfo = credentialDisplayRegistry.getDisplayInfo(credentialData)
              logger?.info(
                `[CredentialOffer] Display info: matched=${displayInfo.matched}, fields count=${displayInfo.fields.length}`
              )
              if (displayInfo.matched) {
                logger?.info(
                  `[CredentialOffer] Using custom display for DTG credential, fields: ${JSON.stringify(
                    displayInfo.fields
                  )}`
                )
                setCustomDisplayFields(displayInfo.fields)
                setCustomButtonText({
                  accept: t(displayInfo.buttonText.accept as any) as string,
                  decline: t(displayInfo.buttonText.decline as any) as string,
                })
                if (displayInfo.credentialTypeName) {
                  setCredentialTypeName(displayInfo.credentialTypeName)
                }
              }
            } else if (!credentialDisplayRegistry) {
              logger?.warn('[CredentialOffer] No credential display registry available')
            }

            // Validate RelationshipCredential DIDs against stored values
            if (
              credential?.connectionId &&
              Array.isArray(credentialData.type) &&
              credentialData.type.includes('RelationshipCredential')
            ) {
              const issuerDid =
                typeof credentialData.issuer === 'string' ? credentialData.issuer : credentialData.issuer?.id
              const subjectDid = credentialData.credentialSubject?.id as string

              if (issuerDid && subjectDid) {
                logger?.info(
                  `[CredentialOffer] Validating RelationshipCredential DIDs - issuer: ${issuerDid}, subject: ${subjectDid}`
                )
                try {
                  const validation = await validateRelationshipCredential(
                    agent,
                    credential.connectionId,
                    issuerDid,
                    subjectDid
                  )
                  setDidValidation(validation)
                  logger?.info(
                    `[CredentialOffer] DID validation result: isValid=${validation.isValid}, issuerMatches=${validation.issuerDidMatches}, subjectMatches=${validation.subjectDidMatches}`
                  )
                } catch (err) {
                  logger?.error(`[CredentialOffer] DID validation error: ${err}`)
                }
              }
            }

            // Verify attestation certificate chain if evidence is present
            if (credentialData.evidence && Array.isArray(credentialData.evidence) && credentialData.evidence.length > 0) {
              const evidence = credentialData.evidence[0] as HardwareAttestationEvidence
              
              // Only verify if there's a certificate chain
              if (evidence?.attestation?.certificateChain && evidence.attestation.certificateChain.length > 0) {
                logger?.info(`[CredentialOffer] Verifying attestation certificate chain...`)
                logger?.info(`[CredentialOffer] Platform: ${evidence.hardwareBinding?.platform}`)
                logger?.info(`[CredentialOffer] Key Storage: ${evidence.hardwareBinding?.keyStorage}`)
                logger?.info(`[CredentialOffer] Chain Length: ${evidence.attestation.certificateChain.length}`)
                
                try {
                  // Use the convenience function that automatically extracts signed content
                  // The signature was over the credential WITHOUT the evidence block
                  const attestationResult = await verifyVrcHardwareEvidence(credentialData as Record<string, unknown>)
                  setAttestationValidation(attestationResult)
                  
                  if (attestationResult && attestationResult.valid) {
                    logger?.info(`[CredentialOffer] ✅ Attestation verification PASSED`)
                    logger?.info(`[CredentialOffer]   Certificate chain valid: ${attestationResult.details.certificateChainValid}`)
                    logger?.info(`[CredentialOffer]   Platform: ${attestationResult.platform}`)
                    logger?.info(`[CredentialOffer]   Security Level: ${attestationResult.securityLevel}`)
                  } else if (attestationResult) {
                    logger?.warn(`[CredentialOffer] ⚠️ Attestation verification FAILED: ${attestationResult.error}`)
                    logger?.warn(`[CredentialOffer]   Certificate chain valid: ${attestationResult.details.certificateChainValid}`)
                    logger?.warn(`[CredentialOffer]   Public key matches: ${attestationResult.details.publicKeyMatchesCert}`)
                    logger?.warn(`[CredentialOffer]   Signature valid: ${attestationResult.details.signatureValid}`)
                  }
                } catch (err) {
                  logger?.error(`[CredentialOffer] Attestation verification error: ${err}`)
                  // Set a failed result on error
                  setAttestationValidation({
                    valid: false,
                    details: {
                      certificateChainValid: false,
                      publicKeyMatchesCert: false,
                      signatureValid: false,
                      verificationLevel: 'none',
                      cryptoLibraryAvailable: false,
                    },
                    error: `Verification error: ${err}`,
                    verifiedAt: new Date().toISOString(),
                  })
                }
              } else {
                logger?.info(`[CredentialOffer] No certificate chain in evidence - attestation not verified`)
                // No chain = no verification possible, but not a failure
                setAttestationValidation({
                  valid: false,
                  details: {
                    certificateChainValid: false,
                    publicKeyMatchesCert: false,
                    signatureValid: false,
                    verificationLevel: 'none',
                    cryptoLibraryAvailable: false,
                  },
                  error: 'No certificate chain provided',
                  verifiedAt: new Date().toISOString(),
                  platform: evidence?.hardwareBinding?.platform,
                  securityLevel: evidence?.hardwareBinding?.keyStorage,
                })
              }
            }
          } else {
            logger?.warn('[CredentialOffer] Could not extract credential data from offer')
          }

          setLoading(false)
          return
        }

        // Process as AnonCreds credential
        if (isValidAnonCredsCredential(credential)) {
          const { offer, offerAttributes } = formatData
          const offerData = offer?.anoncreds ?? offer?.indy

          if (offerData) {
            credential.metadata.add(AnonCredsCredentialMetadataKey, {
              schemaId: offerData.schema_id,
              credentialDefinitionId: offerData.cred_def_id,
            })
          }

          if (offerAttributes) {
            credential.credentialAttributes = [...offerAttributes.map((item) => new CredentialPreviewAttribute(item))]
          }

          // Resolve presentation fields for AnonCreds
          const identifiers = getCredentialIdentifiers(credential)
          const attributes = buildFieldsFromAnonCredsCredential(credential)
          const bundle = await bundleResolver.resolveAllBundles({ identifiers, attributes, language: i18n.language })
          const fields = bundle?.presentationFields ?? []
          const metaOverlay = bundle?.metaOverlay ?? {}

          setOverlay({
            metaOverlay: metaOverlay as MetaOverlay,
            presentationFields: (fields as Attribute[]).filter((field) => field.value),
          })
        }
      } catch (err) {
        const errorMsg = (err as Error)?.message ?? String(err)
        logger?.error(`[CredentialOffer] Error processing credential: ${err}`)

        if (errorMsg.includes('RecordDuplicateError') || errorMsg.includes('Multiple records found')) {
          logger?.warn('[CredentialOffer] Duplicate DidCommMessage records detected — credential may have been accepted already')
        }
      }

      setLoading(false)
    }

    processCredential()
  }, [credential, agent, bundleResolver, i18n.language, logger, credentialDisplayRegistry, t])

  const toggleDeclineModalVisible = useCallback(() => setDeclineModalVisible((prev) => !prev), [])

  const logHistoryRecord = useCallback(
    async (type: HistoryCardType) => {
      try {
        if (!(agent && historyEnabled)) {
          logger.trace(
            `[${CredentialOffer.name}]:[logHistoryRecord] Skipping history log, either history function disabled or agent undefined!`
          )
          return
        }
        const historyManager = historyManagerCurried(agent)

        if (!credential) {
          logger.error(`[${CredentialOffer.name}]:[logHistoryRecord] Cannot save history, credential undefined!`)
          return
        }
        const ids = getCredentialIdentifiers(credential)
        const name =
          overlay.metaOverlay?.name ?? (await getCredentialName(ids.credentialDefinitionId, ids.schemaId, agent))

        /** Save history record for card accepted */
        const recordData: HistoryRecord = {
          type: type,
          message: name,
          createdAt: credential?.createdAt,
          correspondenceId: credentialId,
          correspondenceName: credentialConnectionLabel,
        }
        historyManager.saveHistory(recordData)
      } catch (err: unknown) {
        logger.error(`[${CredentialOffer.name}]:[logHistoryRecord] Error saving history: ${err}`)
      }
    },
    [agent, historyEnabled, logger, historyManagerCurried, credential, credentialId, credentialConnectionLabel, overlay]
  )

  const handleAcceptTouched = useCallback(async () => {
    try {
      if (!(agent && credential && assertNetworkConnected())) {
        return
      }

      setButtonsVisible(false)
      setAcceptModalVisible(true)

      await agent.credentials.acceptOffer({ credentialRecordId: credential.id })
      if (historyEventsLogger.logAttestationAccepted) {
        const type = HistoryCardType.CardAccepted
        await logHistoryRecord(type)
      }
    } catch (err: unknown) {
      setButtonsVisible(true)
      const error = new BifoldError(t('Error.Title1024'), t('Error.Message1024'), (err as Error)?.message ?? err, 1024)
      DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
    }
  }, [agent, credential, assertNetworkConnected, logHistoryRecord, t, historyEventsLogger.logAttestationAccepted])

  const handleDeclineTouched = useCallback(async () => {
    try {
      if (agent && credential) {
        const connectionId = credential.connectionId ?? ''
        const connection = await agent.connections.findById(connectionId)

        await agent.credentials.declineOffer(credential.id)

        if (connection) {
          await agent.credentials.sendProblemReport({
            credentialRecordId: credential.id,
            description: t('CredentialOffer.Declined'),
          })
        }
      }

      toggleDeclineModalVisible()
      if (historyEventsLogger.logAttestationRefused) {
        const type = HistoryCardType.CardDeclined
        await logHistoryRecord(type)
      }

      navigation.getParent()?.navigate(Stacks.TabStack)
    } catch (err: unknown) {
      const error = new BifoldError(t('Error.Title1025'), t('Error.Message1025'), (err as Error)?.message ?? err, 1025)
      DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
    }
  }, [
    agent,
    credential,
    t,
    toggleDeclineModalVisible,
    navigation,
    logHistoryRecord,
    historyEventsLogger.logAttestationRefused,
  ])

  // Get issuer name for JSON-LD credentials
  const jsonLdIssuerName =
    jsonLdCredentialData?.issuer?.name ||
    (typeof jsonLdCredentialData?.issuer === 'string' ? jsonLdCredentialData.issuer : null)

  // Display fields - use custom fields for DTG credentials, overlay fields for AnonCreds
  const displayFields = customDisplayFields.length > 0 ? customDisplayFields : overlay.presentationFields || []

  // Button text - use custom for DTG credentials
  const acceptButtonText = customButtonText?.accept ?? t('Global.Accept')
  const declineButtonText = customButtonText?.decline ?? t('Global.Decline')

  // Determine if accept should be disabled due to DID validation failure
  const isAcceptDisabled = !buttonsVisible || (didValidation !== null && !didValidation.isValid)

  const header = () => {
    const displayName = isJsonLdCredential ? jsonLdIssuerName : credentialConnectionLabel
    return (
      <>
        <ConnectionImage connectionId={credential?.connectionId} />
        <View style={styles.headerTextContainer}>
          <ThemedText style={styles.headerText} testID={testIdWithKey('HeaderText')}>
            <ThemedText>{displayName || t('ContactDetails.AContact')}</ThemedText>{' '}
            {t('CredentialOffer.IsOfferingYouACredential')}
          </ThemedText>
        </View>
        {/* Show credential type name for DTG credentials */}
        {credentialTypeName && (
          <View style={{ paddingHorizontal: 25, paddingBottom: 16 }}>
            <ThemedText
              style={{ fontSize: 20, fontWeight: '600', color: ColorPalette.brand.primary }}
              testID={testIdWithKey('CredentialTypeName')}
            >
              {credentialTypeName}
            </ThemedText>
          </View>
        )}
        {/* Warning alert for DID validation failure */}
        {didValidation && !didValidation.isValid && (
          <View
            style={{
              marginHorizontal: 15,
              marginBottom: 16,
              padding: 12,
              backgroundColor: '#FEE2E2',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#EF4444',
            }}
            testID={testIdWithKey('DIDValidationWarning')}
          >
            <ThemedText style={{ fontWeight: '600', color: '#DC2626', marginBottom: 4 }}>
              ⚠️ {t('Attestation.SecurityWarning')}
            </ThemedText>
            <ThemedText style={{ color: '#7F1D1D', fontSize: 13 }}>
              {t('Attestation.DIDMismatchWarning')}
            </ThemedText>
            {!didValidation.issuerDidMatches && (
              <ThemedText style={{ color: '#7F1D1D', fontSize: 12, marginTop: 8 }}>
                • {t('Attestation.IssuerDIDMismatch')}{'\n'}
                {t('Attestation.Expected')}: {didValidation.expectedIssuerDid || t('Attestation.NotSet')}
                {'\n'}
                {t('Attestation.Received')}: {didValidation.actualIssuerDid}
              </ThemedText>
            )}
            {!didValidation.subjectDidMatches && (
              <ThemedText style={{ color: '#7F1D1D', fontSize: 12, marginTop: 8 }}>
                • {t('Attestation.YourRDIDMismatch')}{'\n'}
                {t('Attestation.Expected')}: {didValidation.expectedSubjectDid || t('Attestation.NotSet')}
                {'\n'}
                {t('Attestation.Received')}: {didValidation.actualSubjectDid}
              </ThemedText>
            )}
          </View>
        )}
        {/* Witness Verified Banner - shows when credential comes after a witnessed exchange */}
        <WitnessVerifiedBanner connectionId={credential?.connectionId} />
        {/* Hardware Attestation Banner - matching WitnessVerifiedBanner styling */}
        {attestationValidation && attestationValidation.valid && (
          <View
            style={{
              backgroundColor: 'rgba(77, 122, 139, 0.2)',
              borderColor: '#4D7A8B',
              borderWidth: 1,
              borderRadius: 8,
              marginHorizontal: 15,
              marginTop: 8,
              marginBottom: 8,
              paddingHorizontal: 16,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
            testID={testIdWithKey('AttestationVerified')}
          >
            <View style={{ marginRight: 12 }}>
              <Icon name="shield-check" size={28} color="#4D7A8B" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: 'bold', fontSize: 14, color: '#4D7A8B', marginBottom: 2 }}>
                Secure Exchange
              </ThemedText>
              <ThemedText style={{ fontSize: 12, color: '#4D7A8B', opacity: 0.9 }}>
                Signed by {attestationValidation.platform === 'ios' ? 'Apple Secure Enclave' : attestationValidation.platform === 'android' ? 'Android TEE' : 'Secure Hardware'}
              </ThemedText>
            </View>
            <Icon name="check-circle" size={20} color="#4D7A8B" />
          </View>
        )}
        {attestationValidation && !attestationValidation.valid && attestationValidation.error !== 'No certificate chain provided' && (
          <View
            style={{
              backgroundColor: '#FEF3C7',
              borderColor: '#F59E0B',
              borderWidth: 1,
              borderRadius: 8,
              marginHorizontal: 15,
              marginTop: 8,
              marginBottom: 8,
              paddingHorizontal: 16,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
            testID={testIdWithKey('AttestationWarning')}
          >
            <View style={{ marginRight: 12 }}>
              <Icon name="shield-alert" size={28} color="#92400E" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: 'bold', fontSize: 14, color: '#92400E', marginBottom: 2 }}>
                Hardware Verification Issue
              </ThemedText>
              <ThemedText style={{ fontSize: 12, color: '#92400E', opacity: 0.9 }}>
                Could not verify hardware attestation
              </ThemedText>
            </View>
            <Icon name="alert-circle" size={20} color="#92400E" />
          </View>
        )}
        {!loading && credential && !isJsonLdCredential && (
          <View style={{ marginHorizontal: 15, marginBottom: 16 }}>
            <CredentialCard credential={credential} />
          </View>
        )}
      </>
    )
  }

  const footer = () => {
    return (
      <View
        style={{
          paddingHorizontal: 25,
          paddingVertical: 16,
          paddingBottom: 26,
          backgroundColor: ColorPalette.brand.secondaryBackground,
        }}
      >
        {loading ? <RecordLoading /> : null}
        {Boolean(credentialConnectionLabel) && goalCode === 'aries.vc.issue' && (
          <ConnectionAlert connectionLabel={credentialConnectionLabel} />
        )}
        <View style={styles.footerButton}>
          <Button
            title={acceptButtonText}
            accessibilityLabel={acceptButtonText}
            testID={testIdWithKey('AcceptCredentialOffer')}
            buttonType={ButtonType.Primary}
            onPress={handleAcceptTouched}
            disabled={isAcceptDisabled}
          />
        </View>
        <View style={styles.footerButton}>
          <Button
            title={declineButtonText}
            accessibilityLabel={declineButtonText}
            testID={testIdWithKey('DeclineCredentialOffer')}
            buttonType={ButtonType.Secondary}
            onPress={toggleDeclineModalVisible}
            disabled={!buttonsVisible}
          />
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={{ flexGrow: 1 }} edges={['bottom', 'left', 'right']}>
      <Record fields={displayFields} header={header} footer={footer} />
      <CredentialOfferAccept
        visible={acceptModalVisible}
        credentialId={credentialId}
        navigateToContacts={isVrcCredential}
      />
      <CommonRemoveModal
        usage={ModalUsage.CredentialOfferDecline}
        visible={declineModalVisible}
        onSubmit={handleDeclineTouched}
        onCancel={toggleDeclineModalVisible}
      />
    </SafeAreaView>
  )
}

export default CredentialOffer
