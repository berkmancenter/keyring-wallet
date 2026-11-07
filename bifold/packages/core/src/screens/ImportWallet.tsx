import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'
import { pick, types } from 'react-native-document-picker'
import RNFS from 'react-native-fs'

import { useAgent } from '@bifold/react-hooks'
import { TOKENS, useServices } from '../container-api'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import { createPickWatcher, IMPORT_PICKER_SLOW_MS } from './importPickerWatch'
import { ThemedText } from '../components/texts/ThemedText'
import Button from '../components/buttons/Button'
import { KeyboardSpace } from '../components/views/KeyboardPaddedView'
import { ButtonType } from '../components/buttons/Button-api'

interface ImportWalletProps {
  navigation: any
}

const exitApp = () => {
  if (Platform.OS === 'android') {
    BackHandler.exitApp()
  }
}

const ImportWallet: React.FC<ImportWalletProps> = () => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const [logger] = useServices([TOKENS.UTIL_LOGGER])
  const { ColorPalette, TextTheme, Inputs, Assets, Spacing } = useTheme()
  const [password, setPassword] = useState('')
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [isImporting, setIsImporting] = useState(false)
  // IN-537: if the picker hasn't settled in IMPORT_PICKER_SLOW_MS, say what to do
  // instead of staying silent (see importPickerWatch.ts).
  const [pickerSlow, setPickerSlow] = useState(false)
  const [pickWatcher] = useState(() =>
    createPickWatcher(IMPORT_PICKER_SLOW_MS, setPickerSlow, (ms) =>
      logger.warn(`ImportWallet: the file picker had not settled ${ms} ms after the tap`)
    )
  )
  useEffect(() => () => pickWatcher.dispose(), [pickWatcher])

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
    fileSelector: {
      ...Inputs.textInput,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    fileSelectorText: {
      flex: 1,
      fontSize: 16,
      color: ColorPalette.grayscale.darkGrey,
    },
    fileSelectorPlaceholder: {
      color: ColorPalette.grayscale.mediumGrey,
    },
    fileHelp: {
      ...TextTheme.caption,
      color: ColorPalette.grayscale.mediumGrey,
      marginTop: Spacing.xs,
    },
    buttonContainer: {
      marginTop: Spacing.xl,
    },
    warningCard: {
      backgroundColor: ColorPalette.notification.error,
      borderWidth: 1,
      borderColor: ColorPalette.notification.errorBorder,
      borderRadius: 8,
      padding: Spacing.md,
      marginTop: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'flex-start',
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
    cardIcon: {
      marginRight: Spacing.sm,
      marginTop: 2,
    },
    cardText: {
      flex: 1,
    },
  })

  const handleSelectFile = async () => {
    const { isCurrent, settle } = pickWatcher.start()

    try {
      const result = await pick({
        type: [types.allFiles],
        allowMultiSelection: true,
        copyTo: 'cachesDirectory',
      })

      if (!isCurrent()) return
      settle()

      if (result && result.length > 0) {
        const mainDbFile = result.find((f) => {
          const name = f.name || ''
          return name.endsWith('.db') && !name.endsWith('.db-shm') && !name.endsWith('.db-wal')
        })

        if (!mainDbFile) {
          Alert.alert(
            String(t('Settings.ImportWalletInvalidFileTitle')),
            String(t('Settings.ImportWalletInvalidFile')),
            [{ text: String(t('Settings.WalletBackupOK')) }]
          )
          return
        }

        const importDir = `${RNFS.CachesDirectoryPath}/wallet-import`
        const dbFileName = mainDbFile.name || 'wallet.db'
        const targetDbPath = `${importDir}/${dbFileName}`

        if (await RNFS.exists(importDir)) {
          await RNFS.unlink(importDir)
        }
        await RNFS.mkdir(importDir)

        for (const file of result) {
          let sourcePath = file.fileCopyUri || file.uri
          if (sourcePath.startsWith('file://')) {
            sourcePath = decodeURIComponent(sourcePath.replace('file://', ''))
          }

          const fileName = file.name || ''
          const targetPath = `${importDir}/${fileName}`
          await RNFS.copyFile(sourcePath, targetPath)
        }

        if (result.length === 1) {
          Alert.alert(String(t('Settings.ImportWalletWalMissingTitle')), String(t('Settings.ImportWalletWalMissing')), [
            { text: String(t('Global.Cancel')), style: 'cancel' },
            { text: String(t('Settings.ImportWalletContinueAnyway')), onPress: () => setSelectedFile(targetDbPath) },
          ])
          return
        }

        setSelectedFile(targetDbPath)
      }
    } catch (err: any) {
      if (!isCurrent()) return
      settle()
      if (err?.code !== 'DOCUMENT_PICKER_CANCELED') {
        // eslint-disable-next-line no-console
        console.error('Document picker error:', err)
        Alert.alert(String(t('Settings.ImportWalletPickErrorTitle')), String(t('Settings.ImportWalletPickError')), [
          { text: String(t('Settings.WalletBackupOK')) },
        ])
      }
    }
  }

  const confirmImport = async () => {
    Alert.alert(String(t('Settings.ImportWalletConfirmTitle')), String(t('Settings.ImportWalletConfirmMessage')), [
      { text: String(t('Global.Cancel')), style: 'cancel' },
      {
        text: String(t('Settings.ImportWalletConfirm')),
        style: 'destructive',
        onPress: () => performImport(),
      },
    ])
  }

  const performImport = async () => {
    if (!password || password.length === 0) {
      Alert.alert(String(t('Error.Problem')), String(t('Settings.ImportWalletPasswordPlaceholder')))
      return
    }

    if (!selectedFile) {
      Alert.alert(String(t('Error.Problem')), String(t('Settings.ImportWalletSelectFile')))
      return
    }

    if (!agent) {
      Alert.alert(String(t('Error.Problem')), String(t('Settings.WalletBackupAgentUnavailable')))
      return
    }

    if (!agent.isInitialized) {
      Alert.alert(String(t('Error.Problem')), String(t('Settings.WalletBackupAgentInitializing')))
      return
    }

    Keyboard.dismiss()
    setIsImporting(true)

    try {
      // Close the current store, delete it, then import from the backup file (credo 0.6 askar API)
      if (agent.modules.askar.isStoreOpen) {
        await agent.modules.askar.closeStore()
      }

      try {
        await agent.modules.askar.deleteStore()
      } catch (deleteError) {
        // Store may not exist yet; import can proceed
        agent.config.logger.warn(`ImportWallet: deleteStore failed: ${(deleteError as Error).message}`)
      }

      await agent.modules.askar.importStore({
        importFromStore: {
          id: `import-${Date.now()}`,
          key: password,
          database: { type: 'sqlite', config: { path: selectedFile } },
        },
      })

      const successMsg =
        Platform.OS === 'ios'
          ? String(t('Settings.ImportWalletImportedIos'))
          : String(t('Settings.ImportWalletImportedAndroid'))

      Alert.alert(String(t('Global.Success')), successMsg, [
        {
          text: String(t('Settings.WalletBackupOK')),
          onPress: () => exitApp(),
        },
      ])
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error('Import wallet error:', error)

      let errorMessage = error?.message || String(t('Settings.ImportWalletError'))

      if (errorMessage.includes('wallet already exists') || errorMessage.includes('WalletDuplicateError')) {
        errorMessage = String(t('Settings.ImportWalletErrorExists'))
      } else if (errorMessage.includes('database path was not found') || errorMessage.includes('WalletNotFoundError')) {
        errorMessage = String(t('Settings.ImportWalletErrorNotFound'))
      } else if (errorMessage.includes('invalid key') || errorMessage.includes('WalletInvalidKeyError')) {
        errorMessage = String(t('Settings.ImportWalletErrorBadPassword'))
      } else if (errorMessage.includes('Permission denied') || errorMessage.includes('EACCES')) {
        errorMessage = String(t('Settings.ImportWalletErrorNoAccess'))
      } else if (errorMessage.includes('no such table')) {
        errorMessage = String(t('Settings.ImportWalletErrorIncomplete'))
      }

      // Joined here rather than interpolated: the error text can be anything, and
      // i18next escapes interpolated values by default.
      const restartMsg = `${errorMessage}\n\n${String(
        t(Platform.OS === 'ios' ? 'Settings.WalletBackupRestartIos' : 'Settings.WalletBackupRestartAndroid')
      )}`

      Alert.alert(String(t('Error.Problem')), restartMsg, [
        {
          text: String(t('Settings.WalletBackupOK')),
          onPress: () => exitApp(),
        },
      ])
    } finally {
      setIsImporting(false)
    }
  }

  const isButtonDisabled = !password || !selectedFile || isImporting

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <KeyboardSpace style={{ flex: 1 }} android={{ behavior: 'height', keyboardVerticalOffset: 20 }}>
        <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.iconContainer}>
            <Assets.svg.walletImport width={80} height={80} fill={ColorPalette.brand.primary} />
          </View>

          <View style={styles.description}>
            <ThemedText>{String(t('Settings.ImportWalletDescription'))}</ThemedText>
          </View>

          <ThemedText style={styles.fieldLabel}>{String(t('Settings.ImportWalletSelectFile'))}</ThemedText>
          <TouchableOpacity style={styles.fileSelector} onPress={handleSelectFile}>
            <ThemedText style={[styles.fileSelectorText, !selectedFile && styles.fileSelectorPlaceholder]}>
              {selectedFile ? selectedFile.split('/').pop() : String(t('Settings.ImportWalletNoFileSelected'))}
            </ThemedText>
            <Icon name="folder-open" size={22} color={ColorPalette.brand.primary} />
          </TouchableOpacity>
          <ThemedText style={styles.fileHelp}>{String(t('Settings.ImportWalletFileHelp'))}</ThemedText>
          {pickerSlow && (
            <View
              style={styles.infoCard}
              testID={testIdWithKey('ImportPickerNotOpened')}
              accessibilityLiveRegion="polite"
            >
              <Icon name="info-outline" size={22} color={ColorPalette.notification.infoIcon} style={styles.cardIcon} />
              <ThemedText style={[styles.cardText, { color: ColorPalette.notification.infoText }]}>
                {String(t('Settings.ImportWalletPickerNotOpened'))}
              </ThemedText>
            </View>
          )}

          <ThemedText style={[styles.fieldLabel, { marginTop: Spacing.lg }]}>
            {String(t('Settings.ImportWalletPasswordLabel'))}
          </ThemedText>
          <TextInput
            style={styles.textInput}
            value={password}
            onChangeText={setPassword}
            placeholder={String(t('Settings.ImportWalletPasswordPlaceholder'))}
            placeholderTextColor={ColorPalette.grayscale.mediumGrey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            testID={testIdWithKey('ImportPassword')}
          />

          <View style={styles.warningCard}>
            <Icon name="warning" size={22} color={ColorPalette.notification.errorIcon} style={styles.cardIcon} />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.errorText }]}>
              {String(t('Settings.ImportWalletReplaceWarning'))}
            </ThemedText>
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title={
                isImporting ? String(t('Settings.ImportWalletImporting')) : String(t('Settings.ImportWalletConfirm'))
              }
              buttonType={ButtonType.Primary}
              accessibilityLabel={String(t('Settings.ImportWalletConfirm'))}
              testID={testIdWithKey('ImportButton')}
              onPress={confirmImport}
              disabled={isButtonDisabled}
            />
          </View>

          <View style={[styles.infoCard, { marginBottom: Spacing.xl }]}>
            <Icon name="info-outline" size={22} color={ColorPalette.notification.infoIcon} style={styles.cardIcon} />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.infoText }]}>
              {String(t('Settings.ImportWalletPasswordHint'))}
            </ThemedText>
          </View>
        </ScrollView>
      </KeyboardSpace>
    </SafeAreaView>
  )
}

export default ImportWallet
