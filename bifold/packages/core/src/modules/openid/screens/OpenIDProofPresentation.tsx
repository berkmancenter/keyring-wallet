import { useAgent } from '@bifold/react-hooks'
import { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, DeviceEventEmitter, View, StyleSheet, Text } from 'react-native'

import CommonRemoveModal from '../../../components/modals/CommonRemoveModal'
import { EventTypes } from '../../../constants'
import ScreenLayout from '../../../layout/ScreenLayout'
import ProofRequestAccept from '../../../screens/ProofRequestAccept'
import { BifoldError } from '../../../types/error'
import { DeliveryStackParams, Screens, TabStacks } from '../../../types/navigators'
import { ModalUsage } from '../../../types/remove'
import { useOpenIDCredentials } from '../context/OpenIDCredentialRecordProvider'
import OpenIdProofRequestDisplay from '../features/OpenIDProofPresentation/OpenIDProofRequestDisplay'
import { useTheme } from '../../../contexts/theme'
import { formatOpenIdProofRequest } from '../displayProof'
import { shareProof } from '../resolverProof'
import { OpenIDCredentialRecord } from '../credentialRecord'

type OpenIDProofPresentationProps = StackScreenProps<DeliveryStackParams, Screens.OpenIDProofPresentation>

type SatisfiedCredentialsFormat = {
  [inputDescriptorId: string]: {
    id: string
    claimFormat: string
  }[]
}

type SelectedCredentialsFormat = {
  [inputDescriptorId: string]: {
    id: string
    claimFormat: string
  }
}

const OpenIDProofPresentation: React.FC<OpenIDProofPresentationProps> = ({
  navigation,
  route: {
    params: { credential },
  },
}: OpenIDProofPresentationProps) => {
  const { TextTheme, ColorPalette } = useTheme()
  const [declineModalVisible, setDeclineModalVisible] = useState(false)
  const [buttonsVisible, setButtonsVisible] = useState(true)
  const [acceptModalVisible, setAcceptModalVisible] = useState(false)
  // The credentials that satisfy the request, read from the wallet: undefined until read. Shown as none
  // before they were, the request read as one this wallet cannot answer (only "Dismiss"), and then gained Send.
  const [credentialsRequested, setCredentialsRequested] = useState<Array<OpenIDCredentialRecord>>()
  // The credentials the person chose instead of the first, by input descriptor. The rest are the first of each.
  const [chosen, setChosen] = useState<SelectedCredentialsFormat>({})

  const { getCredentialById } = useOpenIDCredentials()

  const { t } = useTranslation()
  const { agent } = useAgent()

  const toggleDeclineModalVisible = () => setDeclineModalVisible(!declineModalVisible)

  const submission = useMemo(() => (credential ? formatOpenIdProofRequest(credential) : undefined), [credential])

  // What satisfies each input descriptor, from the request itself.
  const satistfiedCredentialsSubmission = useMemo<SatisfiedCredentialsFormat | undefined>(
    () =>
      submission?.entries.reduce((acc: SatisfiedCredentialsFormat, entry) => {
        acc[entry.inputDescriptorId] = entry.credentials.map((cred) => ({
          id: cred.id,
          claimFormat: cred.claimFormat,
        }))
        return acc
      }, {}),
    [submission]
  )

  //Fetch all credentials satisfying the proof
  useEffect(() => {
    if (!satistfiedCredentialsSubmission) return
    let live = true
    async function fetchCreds() {
      if (!satistfiedCredentialsSubmission) return
      const creds: Array<OpenIDCredentialRecord> = []

      for (const [inputDescriptorID, credIDs] of Object.entries(satistfiedCredentialsSubmission)) {
        for (const { id } of credIDs) {
          const credential = await getCredentialById(id)

          if (credential && inputDescriptorID) {
            creds.push(credential)
          }
        }
      }
      if (live) setCredentialsRequested(creds)
    }
    fetchCreds()
    return () => {
      live = false
    }
  }, [satistfiedCredentialsSubmission, getCredentialById])

  // Once the credentials are read: the first of each input descriptor, unless the person chose another. A read
  // again (a new `getCredentialById`) keeps what they chose.
  const selectedCredentialsSubmission = useMemo<SelectedCredentialsFormat | undefined>(() => {
    if (!satistfiedCredentialsSubmission || !credentialsRequested?.length) return undefined
    return Object.entries(satistfiedCredentialsSubmission).reduce(
      (acc: SelectedCredentialsFormat, [inputDescriptorId, credentials]) => {
        acc[inputDescriptorId] = chosen[inputDescriptorId] ?? {
          id: credentials[0]?.id,
          claimFormat: credentials?.[0]?.claimFormat,
        }
        return acc
      },
      {}
    )
  }, [satistfiedCredentialsSubmission, credentialsRequested, chosen])

  const { verifierName } = useMemo(() => {
    return { verifierName: credential?.verifierHostName }
  }, [credential])

  const handleAcceptTouched = async () => {
    try {
      if (!agent || !selectedCredentialsSubmission) {
        return
      }
      await shareProof({
        agent,
        requestRecord: credential,
        selectedProofCredentials: selectedCredentialsSubmission,
      })
      setAcceptModalVisible(true)
    } catch (err: unknown) {
      setButtonsVisible(true)
      const error = new BifoldError(t('Error.Title1027'), t('Error.Message1027'), (err as Error)?.message ?? err, 1027)
      DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
    }
  }

  const handleDeclineTouched = async () => {
    toggleDeclineModalVisible()
  }

  const handleDismiss = async () => {
    toggleDeclineModalVisible()
    navigation.getParent()?.navigate(TabStacks.HomeStack, { screen: Screens.Home })
  }

  // Re-construct the selected credentials object based on user alt credential
  const onCredChange = ({
    inputDescriptorID,
    id,
    claimFormat,
  }: {
    inputDescriptorID: string
    id: string
    claimFormat: string
  }) => {
    setChosen((prev) => ({
      ...prev,
      [inputDescriptorID]: {
        id,
        claimFormat,
      },
    }))
  }

  const handleAltCredChange = useCallback(
    (inputDescriptorID: string, selectedCredID: string) => {
      const submissionEntries = submission?.entries.find((entry) => {
        return entry.inputDescriptorId === inputDescriptorID
      })
      const credsForEntry = submissionEntries?.credentials

      if (!credsForEntry) return

      navigation.navigate(Screens.OpenIDProofCredentialSelect, {
        inputDescriptorID: inputDescriptorID,
        selectedCredID: selectedCredID,
        altCredIDs: credsForEntry.map((cred) => {
          return {
            id: cred.id,
            claimFormat: cred.claimFormat,
          }
        }),
        onCredChange: onCredChange,
      })
    },
    [submission, navigation]
  )

  const styles = StyleSheet.create({
    headerContainer: {
      paddingVertical: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
  })

  return (
    <ScreenLayout screen={Screens.OpenIDProofPresentation}>
      <View style={styles.headerContainer}>
        <Text style={TextTheme.headerTitle}>{t('ProofRequest.OID4VCTitle')}</Text>
      </View>
      {credential && credentialsRequested === undefined ? (
        <ActivityIndicator color={ColorPalette.brand.primary} style={{ marginTop: 40 }} />
      ) : (
        <OpenIdProofRequestDisplay
          buttonsVisible={buttonsVisible}
          credential={credential}
          // Read by here, unless there is no request (the display then shows nothing).
          credentialsRequested={credentialsRequested ?? []}
          onPressAltCredChange={handleAltCredChange}
          onPressAccept={handleAcceptTouched}
          onPressDecline={handleDeclineTouched}
          onPressDismiss={handleDismiss}
          selectedCredentialsSubmission={selectedCredentialsSubmission}
          submission={submission}
          verifierName={verifierName}
        />
      )}
      <ProofRequestAccept visible={acceptModalVisible} proofId={''} confirmationOnly={true} />
      <CommonRemoveModal
        usage={ModalUsage.ProofRequestDecline}
        visible={declineModalVisible}
        onSubmit={handleDismiss}
        onCancel={toggleDeclineModalVisible}
      />
    </ScreenLayout>
  )
}

export default OpenIDProofPresentation
