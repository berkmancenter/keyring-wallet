import { BrandingOverlay } from '@bifold/oca'
import { CredentialOverlay, Field } from '@bifold/oca/build/legacy'
import { W3cCredentialRecord } from '@credo-ts/core'
import { useAgent } from '@credo-ts/react-hooks'
import { StackScreenProps } from '@react-navigation/stack'
import { useIsFocused } from '@react-navigation/native'
import React, { useEffect, useMemo, useState, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter, StyleSheet, Text, View } from 'react-native'
import Button, { ButtonType } from '../../../components/buttons/Button'
import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import Record from '../../../components/record/Record'
import { EventTypes } from '../../../constants'
import { useTheme } from '../../../contexts/theme'
import { useStore } from '../../../contexts/store'
import { DispatchAction } from '../../../contexts/reducers/store'
import { useTour } from '../../../contexts/tour/tour-context'
import ScreenLayout from '../../../layout/ScreenLayout'
import CredentialOfferAccept from '../../../screens/CredentialOfferAccept'
import { BifoldError } from '../../../types/error'
import { DeliveryStackParams, Screens, Stacks } from '../../../types/navigators'
import { ModalUsage } from '../../../types/remove'
import { BaseTourID } from '../../../types/tour'
import { testIdWithKey } from '../../../utils/testable'
import OpenIDCredentialCard from '../components/OpenIDCredentialCard'
import { useOpenIDCredentials } from '../context/OpenIDCredentialRecordProvider'
import { getCredentialForDisplay } from '../display'
import { TOKENS, useContainer, useServices } from '../../../container-api'
import { W3cCredentialJsonForDisplay, isDTGCredentialType } from '../../../types/credential-display'

type OpenIDCredentialOfferProps = StackScreenProps<DeliveryStackParams, Screens.OpenIDCredentialOffer>

const OpenIDCredentialOffer: React.FC<OpenIDCredentialOfferProps> = ({ navigation, route }) => {
  // FIXME: change params to accept credential id to avoid 'non-serializable' warnings
  const { credential } = route.params
  const credentialDisplay = getCredentialForDisplay(credential)
  const { display } = credentialDisplay

  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const { storeCredential, resolveBundleForCredential } = useOpenIDCredentials()
  const [store, dispatch] = useStore()
  const { start } = useTour()
  const screenIsFocused = useIsFocused()
  const [{ enableTours: enableToursConfig }] = useServices([TOKENS.CONFIG])

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
  const [buttonsVisible, setButtonsVisible] = useState(true)
  const [acceptModalVisible, setAcceptModalVisible] = useState(false)

  // Extract the raw credential JSON for display handler matching
  const credentialJson = useMemo((): W3cCredentialJsonForDisplay | null => {
    try {
      const cred = credential as any
      if (cred?.credential && typeof cred.credential === 'object') {
        return cred.credential as W3cCredentialJsonForDisplay
      }
    } catch {
      // ignore
    }
    return null
  }, [credential])

  // Check if this is a DTGCredential (for custom display handling)
  const isDTGCred = useMemo(() => {
    if (!credentialJson) {
      return false
    }
    return isDTGCredentialType(credentialJson)
  }, [credentialJson])

  // Get custom display info from the handler if available
  const customDisplayInfo = useMemo(() => {
    if (!credentialJson || !isDTGCred || !credentialDisplayRegistry) {
      return null
    }
    return credentialDisplayRegistry.getDisplayInfo(credentialJson)
  }, [credentialJson, isDTGCred, credentialDisplayRegistry])

  // Get terminology from the handler (for screen titles, messages, etc.)
  const terminology = useMemo(() => {
    if (credentialJson && credentialDisplayRegistry) {
      return credentialDisplayRegistry.getTerminology(credentialJson)
    }
    return null
  }, [credentialJson, credentialDisplayRegistry])

  // Set dynamic header title based on credential type
  useLayoutEffect(() => {
    if (terminology && isDTGCred) {
      const customTitle = t(terminology.offerScreenTitle as any) as string
      navigation.setOptions({
        title: customTitle,
      })
    }
  }, [terminology, isDTGCred, navigation, t])

  // Check if this is a relationship credential (DTGCredential/RelationshipCredential)
  // These should navigate to Contacts after acceptance, not the Wallet
  // Using duck typing since credential from route params may not be an actual class instance
  const isRelationshipCredential = useMemo(() => {
    try {
      const cred = credential as any

      // Check if it has a 'credential' property (W3cCredentialRecord structure)
      if (cred?.credential && typeof cred.credential === 'object') {
        const credentialData = cred.credential
        if ('type' in credentialData) {
          const types = Array.isArray(credentialData.type) ? credentialData.type : [credentialData.type]
          return types.some(
            (type: unknown) =>
              typeof type === 'string' && (type.includes('DTGCredential') || type.includes('RelationshipCredential'))
          )
        }
      }
    } catch {
      // If any error occurs, default to false
    }
    return false
  }, [credential])

  const [overlay, setOverlay] = useState<CredentialOverlay<BrandingOverlay>>({
    bundle: undefined,
    presentationFields: [],
    metaOverlay: undefined,
    brandingOverlay: undefined,
  })

  useEffect(() => {
    if (!credential) {
      return
    }

    const resolveOverlay = async () => {
      const brandingOverlay = await resolveBundleForCredential(credential)
      setOverlay(brandingOverlay)
    }

    resolveOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential])

  // Tour logic - show contact offer tour for VRC credentials, credential offer tour for others
  useEffect(() => {
    if (isRelationshipCredential) {
      // Show contact offer tour for VRC/relationship credentials
      const shouldShowContactTour = enableToursConfig && store.tours.enableTours && !store.tours.seenContactOfferTour
      if (shouldShowContactTour && screenIsFocused) {
        start(BaseTourID.ContactOfferTour)
        dispatch({
          type: DispatchAction.UPDATE_SEEN_CONTACT_OFFER_TOUR,
          payload: [true],
        })
      }
    } else {
      // Show regular credential offer tour for non-VRC credentials
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
    isRelationshipCredential,
  ])

  // Get the fields to display - use custom handler fields for DTGCredentials, otherwise use overlay fields
  const displayFields = useMemo((): Field[] => {
    if (customDisplayInfo?.matched && customDisplayInfo.fields.length > 0) {
      return customDisplayInfo.fields
    }
    return overlay.presentationFields || []
  }, [customDisplayInfo, overlay.presentationFields])

  // Get button text - use custom text for DTGCredentials
  const buttonText = useMemo(() => {
    if (customDisplayInfo?.matched) {
      return {
        // Use type assertion since translation keys come from handlers dynamically
        accept: t(customDisplayInfo.buttonText.accept as any) as string,
        decline: t(customDisplayInfo.buttonText.decline as any) as string,
      }
    }
    return {
      accept: t('Global.Accept'),
      decline: t('Global.Decline'),
    }
  }, [customDisplayInfo, t])

  const styles = StyleSheet.create({
    headerTextContainer: {
      paddingHorizontal: 25,
      paddingVertical: 16,
    },
    headerText: {
      ...TextTheme.normal,
      flexShrink: 1,
    },
    footerButton: {
      paddingTop: 10,
    },
  })

  const toggleDeclineModalVisible = () => setIsRemoveModalDisplayed(!isRemoveModalDisplayed)

  const handleDeclineTouched = async () => {
    toggleDeclineModalVisible()
    navigation.getParent()?.navigate(Stacks.TabStack)
  }

  const handleAcceptTouched = async () => {
    if (!agent) {
      return
    }
    try {
      await storeCredential(credential)
      setAcceptModalVisible(true)
    } catch (err: unknown) {
      setButtonsVisible(true)
      const error = new BifoldError(t('Error.Title1024'), t('Error.Message1024'), (err as Error)?.message ?? err, 1024)
      DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
    }
  }

  const footerButton = (
    title: string,
    buttonPress: () => void,
    buttonType: ButtonType,
    testID: string,
    accessibilityLabel: string
  ) => {
    return (
      <View style={styles.footerButton}>
        <Button
          title={title}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          buttonType={buttonType}
          onPress={buttonPress}
          disabled={!buttonsVisible}
        />
      </View>
    )
  }

  const renderOpenIdCard = () => {
    if (!credentialDisplay || !credential) return null
    return (
      <OpenIDCredentialCard
        credentialDisplay={credentialDisplay}
        credentialRecord={credential as W3cCredentialRecord}
      />
    )
  }

  // Get the "is offering you a..." message based on credential type
  const isOfferingYouMessage = useMemo(() => {
    if (terminology && isDTGCred) {
      return t(terminology.isOfferingYou as any) as string
    }
    return t('CredentialOffer.IsOfferingYouACredential')
  }, [terminology, isDTGCred, t])

  const header = () => {
    return (
      <>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerText} testID={testIdWithKey('HeaderText')}>
            <Text>{display.issuer.name || t('ContactDetails.AContact')}</Text> {isOfferingYouMessage}
          </Text>
        </View>
        {credential && <View style={{ marginHorizontal: 15, marginBottom: 16 }}>{renderOpenIdCard()}</View>}
      </>
    )
  }

  const footer = () => {
    const paddingHorizontal = 24
    const paddingVertical = 16
    const paddingBottom = 26
    return (
      <View style={{ marginBottom: 50 }}>
        <View
          style={{
            paddingHorizontal: paddingHorizontal,
            paddingVertical: paddingVertical,
            paddingBottom: paddingBottom,
            backgroundColor: ColorPalette.brand.secondaryBackground,
          }}
        >
          {footerButton(
            buttonText.accept,
            handleAcceptTouched,
            ButtonType.Primary,
            testIdWithKey('AcceptCredentialOffer'),
            buttonText.accept
          )}
          {footerButton(
            buttonText.decline,
            toggleDeclineModalVisible,
            ButtonType.Secondary,
            testIdWithKey('DeclineCredentialOffer'),
            buttonText.decline
          )}
        </View>
      </View>
    )
  }

  return (
    <ScreenLayout screen={Screens.OpenIDCredentialDetails}>
      <Record fields={displayFields} hideFieldValues header={header} footer={footer} />
      <CredentialOfferAccept
        visible={acceptModalVisible}
        credentialId={''}
        confirmationOnly={true}
        navigateToContacts={isRelationshipCredential}
      />
      <CommonRemoveModal
        usage={ModalUsage.CredentialOfferDecline}
        visible={isRemoveModalDisplayed}
        onSubmit={handleDeclineTouched}
        onCancel={toggleDeclineModalVisible}
        extraDetails={display.issuer.name}
      />
    </ScreenLayout>
  )
}

export default OpenIDCredentialOffer
