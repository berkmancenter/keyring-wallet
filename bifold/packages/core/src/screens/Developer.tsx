import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, Pressable, Switch, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAgent } from '@credo-ts/react-hooks'

import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import { ThemedText } from '../components/texts/ThemedText'
import { seedTestContacts, clearTestContacts } from '../utils/seedTestCredentials'

const Developer: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const { agent } = useAgent()
  const [useVerifierCapability, setUseVerifierCapability] = useState(!!store.preferences.useVerifierCapability)
  const [useConnectionInviterCapability, setConnectionInviterCapability] = useState(
    !!store.preferences.useConnectionInviterCapability
  )
  const [acceptDevCredentials, setAcceptDevCredentials] = useState(!!store.preferences.acceptDevCredentials)
  const [useDevVerifierTemplates, setDevVerifierTemplates] = useState(!!store.preferences.useDevVerifierTemplates)
  const [enableWalletNaming, setEnableWalletNaming] = useState(!!store.preferences.enableWalletNaming)
  const [enableShareableLink, setEnableShareableLink] = useState(!!store.preferences.enableShareableLink)
  const [preventAutoLock, setPreventAutoLock] = useState(!!store.preferences.preventAutoLock)
  const [isSeedingContacts, setIsSeedingContacts] = useState(false)
  const [isClearingContacts, setIsClearingContacts] = useState(false)

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingTop: 10,
      paddingHorizontal: 10,
    },
    settingContainer: {
      flexDirection: 'row',
      marginVertical: 10,
      marginHorizontal: 10,
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    settingLabelText: {
      marginRight: 10,
      textAlign: 'left',
    },
    settingSwitchContainer: {
      justifyContent: 'center',
    },
    buttonContainer: {
      marginVertical: 10,
      marginHorizontal: 10,
    },
    button: {
      backgroundColor: ColorPalette.brand.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    buttonDisabled: {
      backgroundColor: ColorPalette.brand.primaryDisabled,
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },
    buttonSecondary: {
      backgroundColor: ColorPalette.grayscale.mediumGrey,
    },
  })

  const toggleVerifierCapabilitySwitch = () => {
    // if verifier feature is switched off then also turn off the dev templates
    if (useVerifierCapability) {
      dispatch({
        type: DispatchAction.USE_DEV_VERIFIER_TEMPLATES,
        payload: [false],
      })
      setDevVerifierTemplates(false)
    }
    dispatch({
      type: DispatchAction.USE_VERIFIER_CAPABILITY,
      payload: [!useVerifierCapability],
    })
    setUseVerifierCapability((previousState) => !previousState)
  }

  const toggleAcceptDevCredentialsSwitch = () => {
    dispatch({
      type: DispatchAction.ACCEPT_DEV_CREDENTIALS,
      payload: [!acceptDevCredentials],
    })
    setAcceptDevCredentials((previousState) => !previousState)
  }

  const toggleConnectionInviterCapabilitySwitch = () => {
    dispatch({
      type: DispatchAction.USE_CONNECTION_INVITER_CAPABILITY,
      payload: [!useConnectionInviterCapability],
    })
    setConnectionInviterCapability((previousState) => !previousState)
  }

  const toggleDevVerifierTemplatesSwitch = () => {
    // if we switch on dev templates we can assume the user also wants to enable the verifier capability
    if (!useDevVerifierTemplates) {
      dispatch({
        type: DispatchAction.USE_VERIFIER_CAPABILITY,
        payload: [true],
      })
      setUseVerifierCapability(true)
    }
    dispatch({
      type: DispatchAction.USE_DEV_VERIFIER_TEMPLATES,
      payload: [!useDevVerifierTemplates],
    })
    setDevVerifierTemplates((previousState) => !previousState)
  }

  const toggleWalletNamingSwitch = () => {
    dispatch({
      type: DispatchAction.ENABLE_WALLET_NAMING,
      payload: [!enableWalletNaming],
    })
    setEnableWalletNaming((previousState) => !previousState)
  }

  const togglePreventAutoLockSwitch = () => {
    dispatch({
      type: DispatchAction.PREVENT_AUTO_LOCK,
      payload: [!preventAutoLock],
    })
    setPreventAutoLock((previousState) => !previousState)
  }

  const toggleShareableLinkSwitch = () => {
    dispatch({
      type: DispatchAction.USE_SHAREABLE_LINK,
      payload: [!enableShareableLink],
    })
    setEnableShareableLink((previousState) => !previousState)
  }

  const handleSeedTestContacts = async () => {
    if (!agent) {
      Alert.alert('Error', 'Agent not initialized')
      return
    }

    setIsSeedingContacts(true)
    try {
      const count = await seedTestContacts(agent)
      Alert.alert('Success', `Seeded ${count} test contacts. Navigate to Contacts to view them.`)
    } catch (error) {
      Alert.alert('Error', `Failed to seed test contacts: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSeedingContacts(false)
    }
  }

  const handleClearTestContacts = async () => {
    if (!agent) {
      Alert.alert('Error', 'Agent not initialized')
      return
    }

    Alert.alert('Clear Test Contacts', 'Are you sure you want to clear all test contacts?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          setIsClearingContacts(true)
          try {
            const count = await clearTestContacts(agent)
            Alert.alert('Success', `Cleared ${count} test contacts`)
          } catch (error) {
            Alert.alert(
              'Error',
              `Failed to clear test contacts: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          } finally {
            setIsClearingContacts(false)
          }
        },
      },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
      <ScrollView style={styles.container}>
        <ThemedText style={{ margin: 10 }}>
          Place content here you would like to make available to developers when developer mode is enabled.
        </ThemedText>
        <View style={styles.buttonContainer}>
          <Pressable
            style={[styles.button, isSeedingContacts && styles.buttonDisabled]}
            onPress={handleSeedTestContacts}
            disabled={isSeedingContacts}
            testID={testIdWithKey('SeedTestContactsButton')}
          >
            {isSeedingContacts ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <ThemedText style={styles.buttonText}>Seed Test Contacts</ThemedText>
            )}
          </Pressable>
        </View>
        <View style={styles.buttonContainer}>
          <Pressable
            style={[styles.button, styles.buttonSecondary, isClearingContacts && styles.buttonDisabled]}
            onPress={handleClearTestContacts}
            disabled={isClearingContacts}
            testID={testIdWithKey('ClearTestContactsButton')}
          >
            {isClearingContacts ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <ThemedText style={styles.buttonText}>Clear Test Contacts</ThemedText>
            )}
          </Pressable>
        </View>
        <View style={styles.settingContainer}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="bold" accessible={false} style={styles.settingLabelText}>
              {t('Verifier.UseVerifierCapability')}
            </ThemedText>
          </View>
          <Pressable
            style={styles.settingSwitchContainer}
            accessibilityLabel={t('Verifier.Toggle')}
            accessibilityRole={'switch'}
            testID={testIdWithKey('ToggleVerifierCapability')}
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={useVerifierCapability ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={toggleVerifierCapabilitySwitch}
              testID={testIdWithKey('VerifierCapabilitySwitchElement')}
              value={useVerifierCapability}
            />
          </Pressable>
        </View>
        <View style={styles.settingContainer}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="bold" accessible={false} style={styles.settingLabelText}>
              {t('Verifier.AcceptDevCredentials')}
            </ThemedText>
          </View>
          <Pressable
            style={styles.settingSwitchContainer}
            accessibilityLabel={t('Verifier.Toggle')}
            accessibilityRole={'switch'}
            testID={testIdWithKey('ToggleAcceptDevCredentials')}
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={acceptDevCredentials ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={toggleAcceptDevCredentialsSwitch}
              testID={testIdWithKey('AcceptDevCredentialsSwitchElement')}
              value={acceptDevCredentials}
            />
          </Pressable>
        </View>
        <View style={styles.settingContainer}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="bold" style={styles.settingLabelText}>
              {t('Connection.UseConnectionInviterCapability')}
            </ThemedText>
          </View>
          <Pressable
            style={styles.settingSwitchContainer}
            accessibilityLabel={t('Connection.Toggle')}
            accessibilityRole={'switch'}
            testID={testIdWithKey('ToggleConnectionInviterCapabilitySwitch')}
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={
                useConnectionInviterCapability ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey
              }
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={toggleConnectionInviterCapabilitySwitch}
              testID={testIdWithKey('ConnectionInviterCapabilitySwitchElement')}
              value={useConnectionInviterCapability}
            />
          </Pressable>
        </View>
        <View style={styles.settingContainer}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="bold" style={styles.settingLabelText}>
              {t('Verifier.UseDevVerifierTemplates')}
            </ThemedText>
          </View>
          <Pressable
            style={styles.settingSwitchContainer}
            accessibilityLabel={t('Verifier.ToggleDevTemplates')}
            accessibilityRole={'switch'}
            testID={testIdWithKey('ToggleDevVerifierTemplatesSwitch')}
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={useDevVerifierTemplates ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={toggleDevVerifierTemplatesSwitch}
              testID={testIdWithKey('DevVerifierTemplatesSwitchElement')}
              value={useDevVerifierTemplates}
            />
          </Pressable>
        </View>
        {!store.onboarding.didCreatePIN && (
          <View style={styles.settingContainer}>
            <View style={{ flex: 1 }}>
              <ThemedText variant="bold" style={styles.settingLabelText}>
                {t('NameWallet.EnableWalletNaming')}
              </ThemedText>
            </View>
            <Pressable
              style={styles.settingSwitchContainer}
              accessibilityLabel={t('NameWallet.ToggleWalletNaming')}
              accessibilityRole={'switch'}
              testID={testIdWithKey('ToggleEnableWalletNamingSwitch')}
            >
              <Switch
                trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
                thumbColor={enableWalletNaming ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
                ios_backgroundColor={ColorPalette.grayscale.lightGrey}
                onValueChange={toggleWalletNamingSwitch}
                testID={testIdWithKey('EnableWalletNamingSwitchElement')}
                value={enableWalletNaming}
              />
            </Pressable>
          </View>
        )}
        <View style={styles.settingContainer}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="bold" style={styles.settingLabelText}>
              {t('Settings.PreventAutoLock')}
            </ThemedText>
          </View>
          <Pressable
            style={styles.settingSwitchContainer}
            accessibilityLabel={t('Settings.TogglePreventAutoLock')}
            accessibilityRole={'switch'}
            testID={testIdWithKey('TogglePreventAutoLockSwitch')}
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={preventAutoLock ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={togglePreventAutoLockSwitch}
              testID={testIdWithKey('PreventAutoLockSwitchElement')}
              value={preventAutoLock}
            />
          </Pressable>
        </View>
        <View style={styles.settingContainer}>
          <View style={{ flex: 1 }}>
            <ThemedText variant="bold" style={styles.settingLabelText}>
              {t('PasteUrl.UseShareableLink')}
            </ThemedText>
          </View>
          <Pressable
            style={styles.settingSwitchContainer}
            accessibilityLabel={t('PasteUrl.UseShareableLink')}
            accessibilityRole={'switch'}
            testID={testIdWithKey('ToggleUseShareableLink')}
          >
            <Switch
              trackColor={{ false: ColorPalette.grayscale.lightGrey, true: ColorPalette.brand.primaryDisabled }}
              thumbColor={enableShareableLink ? ColorPalette.brand.primary : ColorPalette.grayscale.mediumGrey}
              ios_backgroundColor={ColorPalette.grayscale.lightGrey}
              onValueChange={toggleShareableLinkSwitch}
              testID={testIdWithKey('ShareableLinkSwitchElement')}
              value={enableShareableLink}
            />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export default Developer
