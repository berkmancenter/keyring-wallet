import React, { useEffect, useState, useMemo, useLayoutEffect } from 'react'
import { StackScreenProps } from '@react-navigation/stack'
import { RootStackParams, Screens } from '../../../types/navigators'
import { getCredentialForDisplay } from '../display'
import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import { ModalUsage } from '../../../types/remove'
import { DeviceEventEmitter, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { testIdWithKey } from '../../../utils/testable'
import { useTheme } from '../../../contexts/theme'
import { BifoldError } from '../../../types/error'
import { EventTypes } from '../../../constants'
import { useAgent } from '@credo-ts/react-hooks'
import { bifoldLoggerInstance } from '../../../services/bifoldLogger'
import RecordRemove from '../../../components/record/RecordRemove'
import { useOpenIDCredentials } from '../context/OpenIDCredentialRecordProvider'
import { CredentialOverlay, Field } from '@bifold/oca/build/legacy'
import { OpenIDCredentialType, W3cCredentialDisplay } from '../types'
import { TOKENS, useServices, useContainer } from '../../../container-api'
import { BrandingOverlay } from '@bifold/oca'
import Record from '../../../components/record/Record'
import { SdJwtVcRecord, W3cCredentialRecord, JsonTransformer, ClaimFormat } from '@credo-ts/core'
import { buildOverlayFromW3cCredential } from '../../../utils/oca'
import CredentialDetailSecondaryHeader from '../../../components/views/CredentialDetailSecondaryHeader'
import CredentialCardLogo from '../../../components/views/CredentialCardLogo'
import CredentialDetailPrimaryHeader from '../../../components/views/CredentialDetailPrimaryHeader'
import ScreenLayout from '../../../layout/ScreenLayout'
import OpenIDCredentialCard from '../components/OpenIDCredentialCard'
import {
  isDTGCredentialType,
  W3cCredentialJsonForDisplay,
  CredentialTerminology,
} from '../../../types/credential-display'

export enum OpenIDCredScreenMode {
  offer,
  details,
}

type OpenIDCredentialDetailsProps = StackScreenProps<RootStackParams, Screens.OpenIDCredentialDetails>

const paddingHorizontal = 24
const paddingVertical = 16

const OpenIDCredentialDetails: React.FC<OpenIDCredentialDetailsProps> = ({ navigation, route }) => {
  const { credentialId, type } = route.params

  const [credential, setCredential] = useState<W3cCredentialRecord | SdJwtVcRecord | undefined>(undefined)
  const [credentialDisplay, setCredentialDisplay] = useState<W3cCredentialDisplay>()
  const { t, i18n } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const { removeCredential, getW3CCredentialById, getSdJwtCredentialById } = useOpenIDCredentials()
  const [bundleResolver] = useServices([TOKENS.UTIL_OCA_RESOLVER])

  // Get credential display registry from container (optional - may not be registered)
  const container = useContainer()
  const credentialDisplayRegistry = useMemo(() => {
    try {
      return container.resolve(TOKENS.UTIL_CREDENTIAL_DISPLAY_REGISTRY)
    } catch {
      return undefined
    }
  }, [container])

  const [isRemoveModalDisplayed, setIsRemoveModalDisplayed] = useState(false)
  const [credentialRemoved, setCredentialRemoved] = useState(false)
  const [customDisplayFields, setCustomDisplayFields] = useState<Field[]>([])
  const [credentialTypeName, setCredentialTypeName] = useState<string | null>(null)
  const [terminology, setTerminology] = useState<CredentialTerminology | null>(null)

  const [overlay, setOverlay] = useState<CredentialOverlay<BrandingOverlay>>({
    bundle: undefined,
    presentationFields: [],
    metaOverlay: undefined,
    brandingOverlay: undefined,
  })

  const styles = StyleSheet.create({
    container: {
      backgroundColor: overlay.brandingOverlay?.primaryBackgroundColor,
      display: 'flex',
    },
    cardContainer: {
      paddingHorizontal: 10,
      paddingTop: 10,
      paddingBottom: 0,
    },
  })

  useEffect(() => {
    if (!agent) return

    const fetchCredential = async () => {
      if (credentialRemoved) return
      try {
        let record: SdJwtVcRecord | W3cCredentialRecord | undefined

        if (type === OpenIDCredentialType.SdJwtVc) {
          record = await getSdJwtCredentialById(credentialId)
        } else {
          record = await getW3CCredentialById(credentialId)
        }

        setCredential(record)
      } catch (error) {
        // credential not found for id, display an error
        DeviceEventEmitter.emit(
          EventTypes.ERROR_ADDED,
          new BifoldError(t('Error.Title1033'), t('Error.Message1033'), t('CredentialDetails.CredentialNotFound'), 1035)
        )
      }
    }
    fetchCredential()
  }, [credentialId, type, getSdJwtCredentialById, getW3CCredentialById, agent, t, credentialRemoved])

  useEffect(() => {
    if (!credential) return

    try {
      const credDisplay = getCredentialForDisplay(credential)
      setCredentialDisplay(credDisplay)
    } catch (error) {
      DeviceEventEmitter.emit(
        EventTypes.ERROR_ADDED,
        new BifoldError(t('Error.Title1033'), t('Error.Message1033'), t('CredentialDetails.CredentialNotFound'), 1034)
      )
    }
  }, [credential, t])

  useEffect(() => {
    if (!credentialDisplay || !bundleResolver || !i18n || !credentialDisplay.display) {
      return
    }

    const resolveOverlay = async () => {
      const resolvedOverlay = await buildOverlayFromW3cCredential({
        credentialDisplay,
        language: i18n.language,
        resolver: bundleResolver,
      })
      setOverlay(resolvedOverlay)
    }

    resolveOverlay()
  }, [credentialDisplay, bundleResolver, i18n])

  // Set dynamic header title based on credential type
  useLayoutEffect(() => {
    if (terminology) {
      const customTitle = t(terminology.detailScreenTitle as any) as string
      navigation.setOptions({
        title: customTitle,
      })
    }
  }, [terminology, navigation, t])

  // Check for DTG credentials and use custom display handler
  useEffect(() => {
    if (!credential || !credentialDisplayRegistry) {
      return
    }

    // Only W3cCredentialRecord has the structure we need
    if (!(credential instanceof W3cCredentialRecord)) {
      return
    }

    try {
      // Extract the credential JSON for checking
      const credentialData = credential.credential as any

      let credentialJson: W3cCredentialJsonForDisplay

      // Try simpler extraction first (matching OpenIDCredentialOffer approach)
      if (credentialData && typeof credentialData === 'object') {
        // For JWT credentials, the actual credential may be nested
        if (credentialData.claimFormat === ClaimFormat.JwtVc && credentialData.credential) {
          credentialJson = JsonTransformer.toJSON(credentialData.credential) as W3cCredentialJsonForDisplay
        } else {
          credentialJson = JsonTransformer.toJSON(credentialData) as W3cCredentialJsonForDisplay
        }
      } else {
        return
      }

      // Check if this is a DTG credential type
      const isDTG = isDTGCredentialType(credentialJson)

      if (isDTG) {
        const displayInfo = credentialDisplayRegistry.getDisplayInfo(credentialJson)

        if (displayInfo.matched) {
          setCustomDisplayFields(displayInfo.fields)
          if (displayInfo.credentialTypeName) {
            setCredentialTypeName(displayInfo.credentialTypeName)
          }
        }
        // Get terminology for this credential type
        const credTerminology = credentialDisplayRegistry.getTerminology(credentialJson)
        setTerminology(credTerminology)
      }
    } catch (error) {
      // If extraction fails, fall back to default display
      bifoldLoggerInstance.warn('[OpenIDCredentialDetails] Error extracting credential for custom display:', { error: (error as Error).message })
    }
  }, [credential, credentialDisplayRegistry])

  const toggleDeclineModalVisible = () => {
    if (credentialRemoved) {
      return
    }
    setIsRemoveModalDisplayed(!isRemoveModalDisplayed)
  }

  const handleDeclineTouched = async () => {
    setCredentialRemoved(true)
    setIsRemoveModalDisplayed(false)
    await new Promise((resolve) => setTimeout(resolve, 500))
    handleRemove()
  }

  const handleRemove = async () => {
    if (!credential) return
    try {
      await removeCredential(credential, type)
      navigation.pop()
    } catch (err) {
      const error = new BifoldError(t('Error.Title1025'), t('Error.Message1025'), (err as Error)?.message ?? err, 1025)
      DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
    }
  }

  //To be used only in specific cases where consistency with anoncreds needed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const legacyHeader = () => {
    if (!credentialDisplay) return null

    return (
      <View style={styles.container}>
        <CredentialDetailSecondaryHeader overlay={overlay} />
        <CredentialCardLogo overlay={overlay} />
        <CredentialDetailPrimaryHeader overlay={overlay} />
      </View>
    )
  }

  const renderOpenIdCard = () => {
    if (!credentialDisplay) return null
    return <OpenIDCredentialCard credentialDisplay={credentialDisplay} credentialRecord={credential} />
  }

  // Display fields - use custom fields for DTG credentials, overlay fields for others
  const displayFields = customDisplayFields.length > 0 ? customDisplayFields : overlay.presentationFields || []

  // For DTG credentials with custom fields, don't hide field values (already formatted for display)
  const shouldHideFieldValues = customDisplayFields.length === 0

  // Check if we should show the credential card (don't show for DTG credentials with custom display)
  const shouldShowCredentialCard = customDisplayFields.length === 0

  const header = () => {
    return (
      <View style={styles.cardContainer}>
        {/* Only show credential card for non-DTG credentials */}
        {shouldShowCredentialCard && renderOpenIdCard()}
        {/* Show credential type name for DTG credentials */}
        {credentialTypeName && (
          <View style={{ paddingHorizontal: 15, paddingTop: 16 }}>
            <Text
              style={{ fontSize: 20, fontWeight: '600', color: ColorPalette.brand.primary }}
              testID={testIdWithKey('CredentialTypeName')}
            >
              {credentialTypeName}
            </Text>
          </View>
        )}
      </View>
    )
  }

  // Get the "Issued by" / "Connected with" label based on terminology
  const issuedByLabel = useMemo(() => {
    if (terminology) {
      return t(terminology.issuedByLabel as any) as string
    }
    return t('CredentialDetails.IssuedBy')
  }, [terminology, t])

  const footer = () => {
    if (!credentialDisplay) return null
    return (
      <View style={{ marginBottom: 50 }}>
        <View
          style={{
            backgroundColor: ColorPalette.brand.secondaryBackground,
            marginTop: paddingVertical,
            paddingHorizontal,
            paddingVertical,
          }}
        >
          <Text testID={testIdWithKey('IssuerName')}>
            <Text style={[TextTheme.title]}>{issuedByLabel + ' '}</Text>
            <Text style={[TextTheme.normal]}>
              {credentialDisplay.display.issuer.name || t('ContactDetails.AContact')}
            </Text>
          </Text>
        </View>
        <RecordRemove onRemove={toggleDeclineModalVisible} />
      </View>
    )
  }

  return (
    <ScreenLayout screen={Screens.OpenIDCredentialDetails}>
      <Record fields={displayFields} hideFieldValues={shouldHideFieldValues} header={header} footer={footer} />
      <CommonRemoveModal
        usage={ModalUsage.CredentialRemove}
        visible={isRemoveModalDisplayed}
        onSubmit={handleDeclineTouched}
        onCancel={toggleDeclineModalVisible}
      />
    </ScreenLayout>
  )
}

export default OpenIDCredentialDetails
