/**
 * The Import and Export Wallet screens, as a person reads them in each of the app's languages, through real i18next and
 * the real locale files. Every line on the screen and in its alerts comes from the locale: English reads exactly as it
 * did before these strings moved to keys, and French and Portuguese read their own text, not English.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import i18next from 'i18next'
import React from 'react'
import { Alert, Platform, Share } from 'react-native'
import { pick } from 'react-native-document-picker'
import RNFS from 'react-native-fs'

import { translationResources } from '../../src/localization'
import ExportWallet from '../../src/screens/ExportWallet'
import ImportWallet from '../../src/screens/ImportWallet'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'

let mockT: (key: string, options?: Record<string, unknown>) => string
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => mockT(key, options) }),
}))

jest.mock('react-native-document-picker', () => ({
  pick: jest.fn(),
  types: { allFiles: '*/*' },
}))

jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/caches',
  DocumentDirectoryPath: '/documents',
  DownloadDirectoryPath: '/downloads',
  exists: jest.fn(async () => false),
  unlink: jest.fn(async () => undefined),
  mkdir: jest.fn(async () => undefined),
  copyFile: jest.fn(async () => undefined),
  readDir: jest.fn(async () => []),
}))

let mockAgent: any
jest.mock('@bifold/react-hooks', () => ({
  useAgent: () => ({ agent: mockAgent }),
}))

const pickMock = pick as jest.Mock
const i18n = i18next.createInstance()
const tr = (key: string, options?: Record<string, unknown>) => i18n.t(key, options) as string
const s = (key: string) => tr(`Settings.${key}`)

// The English these screens carried as literals before they moved to keys, word for word.
const ENGLISH_BEFORE: Record<string, string> = {
  ImportWalletFileHelp: 'Select all 3 backup files: .db, .db-shm, and .db-wal (hold to multi-select)',
  ImportWalletReplaceWarning:
    'Warning: Importing will replace ALL current wallet data with the backup. This action cannot be undone.',
  ImportWalletPasswordHint: 'You will need the password that was used when creating the backup.',
  ImportWalletImporting: 'Importing...',
  ImportWalletInvalidFileTitle: 'Invalid File',
  ImportWalletInvalidFile: 'Please select a wallet backup file (.db extension).',
  ImportWalletWalMissingTitle: 'WAL Files Missing',
  ImportWalletWalMissing:
    'You only selected the .db file. For a complete backup, please also select the .db-shm and .db-wal files if they exist.\n\nDo you want to continue with just the .db file?',
  ImportWalletContinueAnyway: 'Continue Anyway',
  ImportWalletPickErrorTitle: 'Error',
  ImportWalletPickError: 'Failed to select file. Please try again.',
  ImportWalletConfirmTitle: 'Confirm Import',
  ImportWalletConfirmMessage:
    'Importing a wallet backup will replace ALL current wallet data with the backup. This action cannot be undone.\n\nAfter import, you must fully close the app and reopen it.\n\nAre you sure you want to continue?',
  ImportWalletImportedIos:
    'Wallet imported successfully!\n\nPlease swipe this app closed from the App Switcher and reopen it to use your imported wallet.',
  ImportWalletImportedAndroid:
    'Wallet imported successfully!\n\nThe app will close now. Please reopen it to use your imported wallet.',
  ImportWalletErrorExists: 'A wallet already exists. Please delete the current wallet before importing.',
  ImportWalletErrorNotFound:
    'Backup file not found or could not be accessed. Please ensure you selected all 3 backup files (.db, .db-shm, .db-wal).',
  ImportWalletErrorBadPassword: 'Invalid password. Please enter the correct backup password.',
  ImportWalletErrorNoAccess: 'Cannot access the backup file. Please ensure you have the necessary permissions.',
  ImportWalletErrorIncomplete:
    'The backup file appears incomplete. Please ensure you selected all 3 backup files (.db, .db-shm, .db-wal).',
  WalletBackupOK: 'OK',
  WalletBackupAgentUnavailable: 'Agent is not available. Please restart the app.',
  WalletBackupAgentInitializing: 'Agent is still initializing. Please wait and try again.',
  WalletBackupRestartIos: 'Please swipe this app closed from the App Switcher and reopen it to try again.',
  WalletBackupRestartAndroid: 'The app will close now. Please reopen it to try again.',
}

// Lines on the Import screen itself, before any tap.
const IMPORT_SCREEN = [
  'ImportWalletDescription',
  'ImportWalletSelectFile',
  'ImportWalletNoFileSelected',
  'ImportWalletFileHelp',
  'ImportWalletPasswordLabel',
  'ImportWalletReplaceWarning',
  'ImportWalletConfirm',
  'ImportWalletPasswordHint',
]

const file = (name: string) => ({ name, uri: `file:///picked/${name}` })
const ALL_THREE = [file('wallet.db'), file('wallet.db-shm'), file('wallet.db-wal')]

const renderImport = () =>
  render(
    <BasicAppContext>
      <ImportWallet navigation={{}} />
    </BasicAppContext>
  )

const renderedText = (tree: ReturnType<typeof render>) => {
  const out: string[] = []
  const walk = (node: any) => {
    if (node == null) return
    if (typeof node === 'string') return out.push(node)
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.props?.placeholder) out.push(node.props.placeholder)
    walk(node.children)
  }
  walk(tree.toJSON())
  return out
}

const lastAlert = () => {
  const calls = (Alert.alert as jest.Mock).mock.calls
  return calls[calls.length - 1] as [string, string, any[] | undefined]
}
const buttonTexts = (buttons?: any[]) => (buttons ?? []).map((b) => b.text)

// Type a matching password on Export and tap Export: the alert it ends on is the last one.
const exportWithPassword = async () => {
  const tree = render(<ExportWallet navigation={{}} />)
  fireEvent.changeText(tree.getByTestId(testIdWithKey('ExportPassword')), 'pass phrase')
  fireEvent.changeText(tree.getByTestId(testIdWithKey('ExportPasswordConfirm')), 'pass phrase')
  await act(async () => {
    fireEvent.press(tree.getByTestId(testIdWithKey('ExportButton')))
  })
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
}

// Choose the three files and a password, then tap Import: the confirmation alert is the last one.
const upToConfirm = async () => {
  pickMock.mockResolvedValue(ALL_THREE)
  const tree = renderImport()
  await act(async () => {
    fireEvent.press(tree.getByText(s('ImportWalletNoFileSelected')))
  })
  await waitFor(() => expect(tree.getByText('wallet.db')).toBeTruthy())
  fireEvent.changeText(tree.getByTestId(testIdWithKey('ImportPassword')), 'pass phrase')
  fireEvent.press(tree.getByTestId(testIdWithKey('ImportButton')))
  return tree
}

const pressImportInConfirm = async () => {
  const [, , buttons] = lastAlert()
  await act(async () => {
    await buttons?.[1].onPress()
  })
}

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: translationResources })
  mockT = (key, options) => i18n.t(key, options) as string
})

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => null)
  mockAgent = {
    isInitialized: true,
    config: { logger: { warn: jest.fn() } },
    modules: {
      askar: {
        isStoreOpen: false,
        closeStore: jest.fn(async () => undefined),
        deleteStore: jest.fn(async () => undefined),
        importStore: jest.fn(async () => undefined),
        exportStore: jest.fn(async () => undefined),
      },
    },
  }
})

afterEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
})

test('English reads word for word as the screens did before their strings moved to keys', async () => {
  await i18n.changeLanguage('en')
  for (const [key, english] of Object.entries(ENGLISH_BEFORE)) expect([key, s(key)]).toEqual([key, english])
})

describe.each(['en', 'fr', 'pt-BR'])('the backup screens in %s', (lng) => {
  beforeAll(async () => {
    await i18n.changeLanguage(lng)
  })

  test('the Import screen shows every line in this language, and no English line from before', () => {
    const tree = renderImport()
    for (const key of IMPORT_SCREEN) expect(tree.getByText(s(key))).toBeTruthy()
    expect(tree.getByPlaceholderText(s('ImportWalletPasswordPlaceholder'))).toBeTruthy()

    if (lng !== 'en') {
      const english = new Set(Object.values(ENGLISH_BEFORE).filter((v) => v !== 'OK'))
      const leftover = renderedText(tree).filter((line) => english.has(line))
      expect(leftover).toEqual([])
      for (const key of IMPORT_SCREEN) {
        expect([key, s(key)]).not.toEqual([key, (translationResources.en.translation as any).Settings[key]])
      }
    }
  })

  test('choosing the files and tapping Import asks for confirmation in this language', async () => {
    await upToConfirm()
    const [title, message, buttons] = lastAlert()
    expect([title, message]).toEqual([s('ImportWalletConfirmTitle'), s('ImportWalletConfirmMessage')])
    expect(buttonTexts(buttons)).toEqual([tr('Global.Cancel'), s('ImportWalletConfirm')])
  })

  test('a finished import says so, and how to reopen, in this language', async () => {
    await upToConfirm()
    await pressImportInConfirm()
    const [title, message, buttons] = lastAlert()
    expect([title, message]).toEqual([tr('Global.Success'), s('ImportWalletImportedIos')])
    expect(buttonTexts(buttons)).toEqual([s('WalletBackupOK')])
  })

  test('a wrong password is explained, then the restart, in this language', async () => {
    mockAgent.modules.askar.importStore.mockRejectedValue(new Error('WalletInvalidKeyError: invalid key'))
    await upToConfirm()
    await pressImportInConfirm()
    const [title, message] = lastAlert()
    expect(title).toBe(tr('Error.Problem'))
    expect(message).toBe(`${s('ImportWalletErrorBadPassword')}\n\n${s('WalletBackupRestartIos')}`)
  })

  test('an error text with quotes and slashes reaches the alert as it was, not escaped', async () => {
    mockAgent.modules.askar.importStore.mockRejectedValue(new Error(`can't open "/a/b" <x> & y`))
    await upToConfirm()
    await pressImportInConfirm()
    expect(lastAlert()[1]).toBe(`can't open "/a/b" <x> & y\n\n${s('WalletBackupRestartIos')}`)
  })

  test('with no agent, Import says so in this language', async () => {
    mockAgent = undefined
    await upToConfirm()
    await pressImportInConfirm()
    expect(lastAlert().slice(0, 2)).toEqual([tr('Error.Problem'), s('WalletBackupAgentUnavailable')])
  })

  test('only the .db file chosen: the warning and its buttons are in this language', async () => {
    pickMock.mockResolvedValue([file('wallet.db')])
    const tree = renderImport()
    await act(async () => {
      fireEvent.press(tree.getByText(s('ImportWalletNoFileSelected')))
    })
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
    const [title, message, buttons] = lastAlert()
    expect([title, message]).toEqual([s('ImportWalletWalMissingTitle'), s('ImportWalletWalMissing')])
    expect(buttonTexts(buttons)).toEqual([tr('Global.Cancel'), s('ImportWalletContinueAnyway')])
  })

  test('a file that is not a backup is refused in this language', async () => {
    pickMock.mockResolvedValue([file('notes.txt')])
    const tree = renderImport()
    await act(async () => {
      fireEvent.press(tree.getByText(s('ImportWalletNoFileSelected')))
    })
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
    const [title, message, buttons] = lastAlert()
    expect([title, message]).toEqual([s('ImportWalletInvalidFileTitle'), s('ImportWalletInvalidFile')])
    expect(buttonTexts(buttons)).toEqual([s('WalletBackupOK')])
  })

  test('a picker error is reported in this language', async () => {
    pickMock.mockRejectedValue(Object.assign(new Error('bad'), { code: 'INVALID_DATA_RETURNED' }))
    const tree = renderImport()
    await act(async () => {
      fireEvent.press(tree.getByText(s('ImportWalletNoFileSelected')))
    })
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled())
    expect(lastAlert().slice(0, 2)).toEqual([s('ImportWalletPickErrorTitle'), s('ImportWalletPickError')])
  })

  test("Export's share alert button is in this language", async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction })
    await exportWithPassword()
    expect(buttonTexts(lastAlert()[2])).toEqual([s('WalletBackupOK')])
  })

  test('with no agent, Export says so in this language', async () => {
    mockAgent = undefined
    await exportWithPassword()
    expect(lastAlert().slice(0, 2)).toEqual([tr('Error.Problem'), s('WalletBackupAgentUnavailable')])
  })

  test('with the agent still starting, Export says so in this language', async () => {
    mockAgent.isInitialized = false
    await exportWithPassword()
    expect(lastAlert().slice(0, 2)).toEqual([tr('Error.Problem'), s('WalletBackupAgentInitializing')])
  })

  test('on Android, the Downloads message counts the files in this language', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android')
    try {
      ;(RNFS.exists as jest.Mock).mockResolvedValue(true)
      await exportWithPassword()
      const [title, message, buttons] = lastAlert()
      expect(title).toBe(tr('Global.Success'))
      expect(message).toBe(tr('Settings.ExportWalletSavedToDownloads', { fileCount: 3 }))
      expect(message).not.toContain('{{')
      expect(buttonTexts(buttons)).toEqual([s('WalletBackupOK')])
    } finally {
      os.restore()
      ;(RNFS.exists as jest.Mock).mockImplementation(async () => false)
    }
  })
})
