import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'
import RNFS from 'react-native-fs'

import { useAgent } from '@credo-ts/react-hooks'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import { ThemedText } from '../components/texts/ThemedText'
import Button from '../components/buttons/Button'
import { ButtonType } from '../components/buttons/Button-api'

interface ExportWalletProps {
  navigation: any
}

const ExportWallet: React.FC<ExportWalletProps> = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette, TextTheme, Inputs, Assets, Spacing } = useTheme()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    scrollContent: {
      padding: 20,
    },
    iconContainer: {
      alignItems: 'center',
      marginBottom: Spacing.xl,
    },
    description: {
      marginBottom: Spacing.lg,
    },
    fieldLabel: {
      ...TextTheme.bold,
      marginBottom: Spacing.xs,
      marginTop: Spacing.md,
    },
    textInput: {
      ...Inputs.textInput,
    },
    buttonContainer: {
      marginTop: Spacing.xl,
    },
    infoCard: {
      backgroundColor: ColorPalette.notification.info,
      borderWidth: 1,
      borderColor: ColorPalette.notification.infoBorder,
      borderRadius: 8,
      padding: Spacing.md,
      marginTop: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    warningCard: {
      backgroundColor: ColorPalette.notification.warn,
      borderWidth: 1,
      borderColor: ColorPalette.notification.warnBorder,
      borderRadius: 8,
      padding: Spacing.md,
      marginTop: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    cardIcon: {
      marginRight: Spacing.sm,
      marginTop: 2,
    },
    cardText: {
      flex: 1,
    },
  })

  const handleExport = async () => {
    if (password !== confirmPassword) {
      Alert.alert(String(t('Error.Problem')), String(t('PINCreate.PINsDoNotMatch')))
      return
    }

    if (!password || password.length === 0) {
      Alert.alert(String(t('Error.Problem')), String(t('Settings.ExportWalletPasswordPlaceholder')))
      return
    }

    if (!agent) {
      Alert.alert(String(t('Error.Problem')), 'Agent is not available. Please restart the app.')
      return
    }

    if (!agent.isInitialized) {
      Alert.alert(String(t('Error.Problem')), 'Agent is still initializing. Please wait and try again.')
      return
    }

    Keyboard.dismiss()
    setIsExporting(true)

    try {
      const backupFileName = `wallet-backup-${Date.now()}.db`
      const baseDir = Platform.OS === 'android' ? RNFS.DownloadDirectoryPath : RNFS.DocumentDirectoryPath
      const backupPath = `${baseDir}/${backupFileName}`

      await agent.wallet.export({
        path: backupPath,
        key: password,
      })

      const shmPath = `${backupPath}-shm`
      const walPath = `${backupPath}-wal`
      let fileCount = 1
      if (await RNFS.exists(shmPath)) fileCount++
      if (await RNFS.exists(walPath)) fileCount++

      const locationMsg = Platform.OS === 'ios'
        ? `You can find your ${fileCount} backup files in the Files app under:\n\nOn My iPhone → Keyring`
        : `You can find your ${fileCount} backup files in your Downloads folder.`

      Alert.alert(
        String(t('Global.Success')),
        `Wallet exported successfully!\n\n${locationMsg}\n\nKeep all files together — you'll need them to restore.`,
        [{ text: 'OK' }]
      )
      setPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      console.error('Export wallet error:', error)
      const errorMessage = error?.message || String(t('Settings.ExportWalletError'))
      Alert.alert(String(t('Error.Problem')), errorMessage)
    } finally {
      setIsExporting(false)
    }
  }

  const isButtonDisabled = !password || !confirmPassword || password !== confirmPassword || isExporting

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.iconContainer}>
            <Assets.svg.walletExport width={80} height={80} fill={ColorPalette.brand.primary} />
          </View>

          <View style={styles.description}>
            <ThemedText>{String(t('Settings.ExportWalletDescription'))}</ThemedText>
          </View>

          <ThemedText style={styles.fieldLabel}>{String(t('Settings.ExportWalletPasswordLabel'))}</ThemedText>
          <TextInput
            style={styles.textInput}
            value={password}
            onChangeText={setPassword}
            placeholder={String(t('Settings.ExportWalletPasswordPlaceholder'))}
            placeholderTextColor={ColorPalette.grayscale.mediumGrey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID={testIdWithKey('ExportPassword')}
          />

          <ThemedText style={styles.fieldLabel}>{String(t('Settings.ExportWalletPasswordConfirmLabel'))}</ThemedText>
          <TextInput
            style={styles.textInput}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder={String(t('Settings.ExportWalletPasswordPlaceholder'))}
            placeholderTextColor={ColorPalette.grayscale.mediumGrey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID={testIdWithKey('ExportPasswordConfirm')}
          />

          <View style={styles.buttonContainer}>
            <Button
              title={isExporting ? '...' : String(t('Settings.ExportWalletConfirm'))}
              buttonType={ButtonType.Primary}
              accessibilityLabel={String(t('Settings.ExportWalletConfirm'))}
              testID={testIdWithKey('ExportButton')}
              onPress={handleExport}
              disabled={isButtonDisabled}
            />
          </View>

          <View style={styles.warningCard}>
            <Icon
              name="warning"
              size={22}
              color={ColorPalette.notification.warnIcon}
              style={styles.cardIcon}
            />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.warnText }]}>
              {String(t('Settings.ExportWalletWarning'))}
            </ThemedText>
          </View>

          <View style={styles.infoCard}>
            <Icon
              name="info-outline"
              size={22}
              color={ColorPalette.notification.infoIcon}
              style={styles.cardIcon}
            />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.infoText }]}>
              {String(t('Settings.ExportWalletInfo'))}
            </ThemedText>
          </View>

          <View style={[styles.infoCard, { marginBottom: Spacing.xl }]}>
            <Icon
              name="storage"
              size={22}
              color={ColorPalette.notification.infoIcon}
              style={styles.cardIcon}
            />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.infoText }]}>
              3 files will be created (.db, .db-shm, .db-wal). Keep all files together for import.
            </ThemedText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default ExportWallet
