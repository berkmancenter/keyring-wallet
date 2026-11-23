import { useCredentialById, useAgent } from '@bifold/react-hooks'
import { DidCommCredentialState } from '@credo-ts/didcomm'
import { useNavigation, CommonActions } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../components/buttons/Button'
import SafeAreaModal from '../components/modals/SafeAreaModal'
import { useAnimatedComponents } from '../contexts/animated-components'
import { useTheme } from '../contexts/theme'
import { Screens, Stacks, TabStacks } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'
import { TOKENS, useServices } from '../container-api'
import { ThemedText } from '../components/texts/ThemedText'
import { ensureCredentialMetadata } from '../utils/credential'
import ScreenWrapper from '../components/views/ScreenWrapper'

enum DeliveryStatus {
  Pending,
  Completed,
  Declined,
}

export interface CredentialOfferAcceptProps {
  visible: boolean
  credentialId: string
  confirmationOnly?: boolean
  /**
   * If true, navigate to Contacts screen instead of Credentials screen after accepting.
   * Used for relationship credentials (VRC) that should show in Contacts, not Wallet.
   */
  navigateToContacts?: boolean
}

const CredentialOfferAccept: React.FC<CredentialOfferAcceptProps> = ({
  visible,
  credentialId,
  confirmationOnly,
  navigateToContacts,
}) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const [shouldShowDelayMessage, setShouldShowDelayMessage] = useState<boolean>(false)
  const [credentialDeliveryStatus, setCredentialDeliveryStatus] = useState<DeliveryStatus>(DeliveryStatus.Pending)
  const [timerDidFire, setTimerDidFire] = useState<boolean>(false)
  const [timer, setTimer] = useState<NodeJS.Timeout>()
  const credential = useCredentialById(credentialId)
  const navigation = useNavigation()
  const { ListItems } = useTheme()
  const { CredentialAdded, CredentialPending } = useAnimatedComponents()
  const [{ connectionTimerDelay }, logger] = useServices([TOKENS.CONFIG, TOKENS.UTIL_LOGGER])
  const connTimerDelay = connectionTimerDelay ?? 10000 // in ms
  const styles = StyleSheet.create({
    image: {
      marginTop: 20,
    },
    messageContainer: {
      alignItems: 'center',
    },
    messageText: {
      textAlign: 'center',
      marginTop: 30,
    },
    delayMessageText: {
      textAlign: 'center',
      marginTop: 20,
    },
  })

  if (!credential && !confirmationOnly) {
    throw new Error('Unable to fetch credential from Credo')
  }

  const onBackToHomeTouched = useCallback(() => {
    navigation.getParent()?.navigate(TabStacks.HomeStack, { screen: Screens.Home })
  }, [navigation])

  const onDoneTouched = useCallback(() => {
    if (navigateToContacts) {
      // Navigate to Contacts tab for relationship credentials (VRC)
      // Use TabStacks.ContactStack to navigate within the TabStack, preserving bottom tabs
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: Stacks.TabStack,
              state: {
                routes: [{ name: TabStacks.ContactStack }],
              },
            },
          ],
        })
      )
    } else {
      navigation.getParent()?.navigate(TabStacks.CredentialStack, { screen: Screens.Credentials })
    }
  }, [navigation, navigateToContacts])

  useEffect(() => {
    if (!credential) {
      return
    }
    if (credential.state === DidCommCredentialState.CredentialReceived || credential.state === DidCommCredentialState.Done) {
      timer && clearTimeout(timer)
      setCredentialDeliveryStatus(DeliveryStatus.Completed)

      const restoreMetadata = async () => {
        if (agent) {
          try {
            await ensureCredentialMetadata(credential, agent, undefined, logger)
          } catch (error) {
            logger?.warn('Failed to restore credential metadata', { error: error as Error })
          }
        }
      }
      restoreMetadata()
    }
  }, [credential, timer, agent, logger])

  useEffect(() => {
    if (confirmationOnly) {
      timer && clearTimeout(timer)
      setCredentialDeliveryStatus(DeliveryStatus.Completed)
    }
  }, [confirmationOnly, timer])

  useEffect(() => {
    if (timerDidFire || credentialDeliveryStatus !== DeliveryStatus.Pending || !visible) {
      return
    }

    const timer = setTimeout(() => {
      setShouldShowDelayMessage(true)
      setTimerDidFire(true)
    }, connTimerDelay)

    setTimer(timer)

    return () => {
      timer && clearTimeout(timer)
    }
  }, [timerDidFire, credentialDeliveryStatus, visible, connTimerDelay])

  useEffect(() => {
    if (shouldShowDelayMessage && credentialDeliveryStatus !== DeliveryStatus.Completed) {
      AccessibilityInfo.announceForAccessibility(t('Connection.TakingTooLong'))
    }
  }, [shouldShowDelayMessage, credentialDeliveryStatus, t])

  const controls = (
    <>
      {credentialDeliveryStatus === DeliveryStatus.Pending && (
        <Button
          title={t('Loading.BackToHome')}
          accessibilityLabel={t('Loading.BackToHome')}
          testID={testIdWithKey('BackToHome')}
          onPress={onBackToHomeTouched}
          buttonType={ButtonType.ModalSecondary}
        />
      )}

      {credentialDeliveryStatus === DeliveryStatus.Completed && (
        <Button
          title={t('Global.Done')}
          accessibilityLabel={t('Global.Done')}
          testID={testIdWithKey('Done')}
          onPress={onDoneTouched}
          buttonType={ButtonType.ModalPrimary}
        />
      )}
    </>
  )

  return (
    <SafeAreaModal visible={visible} transparent animationType="none">
      <ScreenWrapper edges={['bottom', 'top', 'left', 'right']} controls={controls}>
        <View style={styles.messageContainer}>
          {credentialDeliveryStatus === DeliveryStatus.Pending && (
            <ThemedText
              style={[ListItems.credentialOfferTitle, styles.messageText]}
              testID={testIdWithKey(navigateToContacts ? 'ContactOnTheWay' : 'CredentialOnTheWay')}
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {t((navigateToContacts ? 'Contacts.ContactOnTheWay' : 'CredentialOffer.CredentialOnTheWay') as any)}
            </ThemedText>
          )}

          {credentialDeliveryStatus === DeliveryStatus.Completed && (
            <ThemedText
              style={[ListItems.credentialOfferTitle, styles.messageText]}
              testID={testIdWithKey(navigateToContacts ? 'ContactAddedToYourWallet' : 'CredentialAddedToYourWallet')}
            >
              {t(
                (navigateToContacts
                  ? 'Contacts.ContactAddedToYourWallet'
                  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    'CredentialOffer.CredentialAddedToYourWallet') as any
              )}
            </ThemedText>
          )}
        </View>

        <View style={[styles.image, { minHeight: 250, alignItems: 'center', justifyContent: 'flex-end' }]}>
          {credentialDeliveryStatus === DeliveryStatus.Completed && <CredentialAdded />}
          {credentialDeliveryStatus === DeliveryStatus.Pending && <CredentialPending />}
        </View>

        {shouldShowDelayMessage && credentialDeliveryStatus === DeliveryStatus.Pending && (
          <ThemedText
            style={[ListItems.credentialOfferDetails, styles.delayMessageText]}
            testID={testIdWithKey('TakingTooLong')}
          >
            {t('Connection.TakingTooLong')}
          </ThemedText>
        )}
      </ScreenWrapper>
    </SafeAreaModal>
  )
}

export default CredentialOfferAccept
