import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialIcons'
import { pick, types } from 'react-native-document-picker'
import RNFS from 'react-native-fs'

import { useAgent } from '@credo-ts/react-hooks'
import { useTheme } from '../contexts/theme'
import { testIdWithKey } from '../utils/testable'
import { ThemedText } from '../components/texts/ThemedText'
import Button from '../components/buttons/Button'
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
  const { ColorPalette, TextTheme, Inputs, Assets, Spacing } = useTheme()
  const [password, setPassword] = useState('')
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [isImporting, setIsImporting] = useState(false)

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
    try {
      const result = await pick({
        type: [types.allFiles],
        allowMultiSelection: true,
        copyTo: 'cachesDirectory',
      })

      if (result && result.length > 0) {
        const mainDbFile = result.find((f) => {
          const name = f.name || ''
          return name.endsWith('.db') && !name.endsWith('.db-shm') && !name.endsWith('.db-wal')
        })

        if (!mainDbFile) {
          Alert.alert(
            'Invalid File',
            'Please select a wallet backup file (.db extension).',
            [{ text: 'OK' }]
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
          Alert.alert(
            'WAL Files Missing',
            'You only selected the .db file. For a complete backup, please also select the .db-shm and .db-wal files if they exist.\n\nDo you want to continue with just the .db file?',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Continue Anyway', onPress: () => setSelectedFile(targetDbPath) }
            ]
          )
          return
        }

        setSelectedFile(targetDbPath)
      }
    } catch (err: any) {
      if (err?.code !== 'DOCUMENT_PICKER_CANCELED') {
        console.error('Document picker error:', err)
        Alert.alert('Error', 'Failed to select file. Please try again.', [{ text: 'OK' }])
      }
    }
  }

  const confirmImport = async () => {
    Alert.alert(
      'Confirm Import',
      'Importing a wallet backup will replace ALL current wallet data with the backup. This action cannot be undone.\n\nAfter import, you must fully close the app and reopen it.\n\nAre you sure you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: 'destructive',
          onPress: () => performImport()
        }
      ]
    )
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
      Alert.alert(String(t('Error.Problem')), 'Agent is not available. Please restart the app.')
      return
    }

    if (!agent.isInitialized) {
      Alert.alert(String(t('Error.Problem')), 'Agent is still initializing. Please wait and try again.')
      return
    }

    Keyboard.dismiss()
    setIsImporting(true)

    try {
      if (!agent.config.walletConfig) {
        throw new Error('Wallet configuration not found. Please restart the app.')
      }

      await agent.shutdown()

      if (agent.wallet.isProvisioned) {
        await agent.wallet.delete()
      }

      await agent.wallet.import(agent.config.walletConfig, {
        path: selectedFile,
        key: password,
      })

      const successMsg = Platform.OS === 'ios'
        ? 'Wallet imported successfully!\n\nPlease swipe this app closed from the App Switcher and reopen it to use your imported wallet.'
        : 'Wallet imported successfully!\n\nThe app will close now. Please reopen it to use your imported wallet.'

      Alert.alert(
        String(t('Global.Success')),
        successMsg,
        [
          {
            text: 'OK',
            onPress: () => exitApp(),
          }
        ]
      )
    } catch (error: any) {
      console.error('Import wallet error:', error)

      let errorMessage = error?.message || String(t('Settings.ImportWalletError'))

      if (errorMessage.includes('wallet already exists') || errorMessage.includes('WalletDuplicateError')) {
        errorMessage = 'A wallet already exists. Please delete the current wallet before importing.'
      } else if (errorMessage.includes('database path was not found') || errorMessage.includes('WalletNotFoundError')) {
        errorMessage = 'Backup file not found or could not be accessed. Please ensure you selected all 3 backup files (.db, .db-shm, .db-wal).'
      } else if (errorMessage.includes('invalid key') || errorMessage.includes('WalletInvalidKeyError')) {
        errorMessage = 'Invalid password. Please enter the correct backup password.'
      } else if (errorMessage.includes('Permission denied') || errorMessage.includes('EACCES')) {
        errorMessage = 'Cannot access the backup file. Please ensure you have the necessary permissions.'
      } else if (errorMessage.includes('no such table')) {
        errorMessage = 'The backup file appears incomplete. Please ensure you selected all 3 backup files (.db, .db-shm, .db-wal).'
      }

      const restartMsg = Platform.OS === 'ios'
        ? `${errorMessage}\n\nPlease swipe this app closed from the App Switcher and reopen it to try again.`
        : `${errorMessage}\n\nThe app will close now. Please reopen it to try again.`

      Alert.alert(
        String(t('Error.Problem')),
        restartMsg,
        [
          {
            text: 'OK',
            onPress: () => exitApp(),
          }
        ]
      )
    } finally {
      setIsImporting(false)
    }
  }

  const isButtonDisabled = !password || !selectedFile || isImporting

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.iconContainer}>
            <Assets.svg.walletImport width={80} height={80} fill={ColorPalette.brand.primary} />
          </View>

          <View style={styles.description}>
            <ThemedText>{String(t('Settings.ImportWalletDescription'))}</ThemedText>
          </View>

          <ThemedText style={styles.fieldLabel}>{String(t('Settings.ImportWalletSelectFile'))}</ThemedText>
          <TouchableOpacity style={styles.fileSelector} onPress={handleSelectFile}>
            <ThemedText
              style={[
                styles.fileSelectorText,
                !selectedFile && styles.fileSelectorPlaceholder,
              ]}
            >
              {selectedFile ? selectedFile.split('/').pop() : String(t('Settings.ImportWalletNoFileSelected'))}
            </ThemedText>
            <Icon name="folder-open" size={22} color={ColorPalette.brand.primary} />
          </TouchableOpacity>
          <ThemedText style={styles.fileHelp}>
            Select all 3 backup files: .db, .db-shm, and .db-wal (hold to multi-select)
          </ThemedText>

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
            <Icon
              name="warning"
              size={22}
              color={ColorPalette.notification.errorIcon}
              style={styles.cardIcon}
            />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.errorText }]}>
              Warning: Importing will replace ALL current wallet data with the backup. This action cannot be undone.
            </ThemedText>
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title={isImporting ? 'Importing...' : String(t('Settings.ImportWalletConfirm'))}
              buttonType={ButtonType.Primary}
              accessibilityLabel={String(t('Settings.ImportWalletConfirm'))}
              testID={testIdWithKey('ImportButton')}
              onPress={confirmImport}
              disabled={isButtonDisabled}
            />
          </View>

          <View style={[styles.infoCard, { marginBottom: Spacing.xl }]}>
            <Icon
              name="info-outline"
              size={22}
              color={ColorPalette.notification.infoIcon}
              style={styles.cardIcon}
            />
            <ThemedText style={[styles.cardText, { color: ColorPalette.notification.infoText }]}>
              You will need the password that was used when creating the backup.
            </ThemedText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default ImportWallet
