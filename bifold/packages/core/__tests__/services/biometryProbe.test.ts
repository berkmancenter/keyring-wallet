import Keychain from 'react-native-keychain'

import { KeychainServices } from '../../src/constants'
import { confirmBiometricKeychainAccess } from '../../src/services/keychain'

// Uses the package's __mocks__/react-native-keychain.ts.
const setGenericPassword = Keychain.setGenericPassword as jest.Mock
const getGenericPassword = Keychain.getGenericPassword as jest.Mock
const resetGenericPassword = Keychain.resetGenericPassword as jest.Mock

const PROBE = KeychainServices.BiometryProbe

/** The value the probe wrote, so a read can hand it back. */
const writtenValue = (): string => setGenericPassword.mock.calls[0][1]

/** Every service any keychain call in this run named. */
const servicesTouched = (): string[] =>
  [
    ...setGenericPassword.mock.calls.map((c) => c[2]?.service),
    ...getGenericPassword.mock.calls.map((c) => c[0]?.service),
    ...resetGenericPassword.mock.calls.map((c) => c[0]?.service),
  ].filter((s) => s !== undefined)

describe('confirmBiometricKeychainAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setGenericPassword.mockResolvedValue(true)
    resetGenericPassword.mockResolvedValue(true)
    getGenericPassword.mockImplementation(async () => ({ username: 'u', password: writtenValue(), service: PROBE }))
  })

  test('true when Face ID opens the item: written under its own service with BIOMETRY_ANY, read with a prompt, removed before and after', async () => {
    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(true)

    expect(setGenericPassword).toHaveBeenCalledTimes(1)
    expect(setGenericPassword.mock.calls[0][2]).toEqual({
      service: PROBE,
      accessible: 'WhenUnlockedThisDeviceOnly',
      accessControl: 'BiometryAny',
    })
    expect(getGenericPassword).toHaveBeenCalledWith({
      service: PROBE,
      authenticationPrompt: { title: 'Title', description: 'Desc' },
    })
    // Once before the write (a probe left by a killed attempt) and once after.
    expect(resetGenericPassword).toHaveBeenCalledTimes(2)
    expect(resetGenericPassword.mock.invocationCallOrder[0]).toBeLessThan(
      setGenericPassword.mock.invocationCallOrder[0]
    )
    expect(resetGenericPassword.mock.invocationCallOrder[1]).toBeGreaterThan(
      getGenericPassword.mock.invocationCallOrder[0]
    )
    expect(new Set(servicesTouched())).toEqual(new Set([PROBE]))
  })

  test('false when the read throws (a decline, a cancel, a failed scan), and the wallet key is not touched', async () => {
    getGenericPassword.mockRejectedValue(new Error('User canceled the operation.'))

    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(false)

    expect(resetGenericPassword).toHaveBeenCalledTimes(2)
    expect(servicesTouched()).not.toContain(KeychainServices.Key)
    expect(servicesTouched()).not.toContain(KeychainServices.Salt)
    expect(new Set(servicesTouched())).toEqual(new Set([PROBE]))
  })

  test('false when the read finds nothing', async () => {
    getGenericPassword.mockResolvedValue(false)
    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(false)
  })

  test('false when the read returns a different value', async () => {
    getGenericPassword.mockResolvedValue({ username: 'u', password: 'something else', service: PROBE })
    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(false)
  })

  test('false without reading when the write fails', async () => {
    setGenericPassword.mockResolvedValue(false)
    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(false)
    expect(getGenericPassword).not.toHaveBeenCalled()
  })

  test('false when the write throws', async () => {
    setGenericPassword.mockRejectedValue(new Error('write failed'))
    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(false)
    expect(getGenericPassword).not.toHaveBeenCalled()
  })

  test('false after the timeout when the read never answers, instead of waiting forever', async () => {
    getGenericPassword.mockImplementation(() => new Promise(() => {}))
    await expect(confirmBiometricKeychainAccess('Title', 'Desc', 20)).resolves.toBe(false)
  })

  test('still runs when removing an old probe throws', async () => {
    resetGenericPassword.mockRejectedValueOnce(new Error('nothing to reset'))
    await expect(confirmBiometricKeychainAccess('Title', 'Desc')).resolves.toBe(true)
  })
})
