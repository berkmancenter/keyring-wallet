import { Platform } from 'react-native'
import Keychain, {
  getSupportedBiometryType,
  ACCESSIBLE,
  ACCESS_CONTROL,
  SECURITY_LEVEL,
  STORAGE_TYPE,
  type SetOptions,
  type GetOptions,
} from 'react-native-keychain'
import uuid from 'react-native-uuid'

import { walletId, KeychainServices } from '../constants'
import { WalletSecret } from '../types/security'
import { LoginAttempt } from '../types/state'

const keyFauxUserName = 'WalletFauxPINUserName'
const saltFauxUserName = 'WalletFauxSaltUserName'
const loginAttemptFauxUserName = 'WalletFauxLoginAttemptUserName'
// TODO: consider combing WalletSalt, WalletKey all into Wallet Secret, then using partials when required
export interface WalletSalt {
  id: string
  salt: string
}

export interface WalletKey {
  key: string
}

export const optionsForKeychainAccess = (service: KeychainServices, useBiometrics = false): SetOptions => {
  const opts: SetOptions = {
    accessible: useBiometrics ? ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY : ACCESSIBLE.ALWAYS,
    service,
  }

  if (useBiometrics) {
    opts.accessControl = ACCESS_CONTROL.BIOMETRY_ANY
  }

  if (Platform.OS === 'android') {
    opts.securityLevel = SECURITY_LEVEL.ANY
    if (!useBiometrics) {
      opts.storage = STORAGE_TYPE.AES_GCM_NO_AUTH
    } else {
      opts.storage = STORAGE_TYPE.RSA
    }
  }

  return opts
}

export const secretForPIN = async (
  PIN: string,
  hashAlgorithm: (PIN: string, salt: string) => Promise<string>,
  salt?: string
): Promise<WalletSecret> => {
  const mySalt = salt ?? uuid.v4().toString()
  const myKey = await hashAlgorithm(PIN, mySalt)
  const secret: WalletSecret = {
    id: walletId,
    key: myKey,
    salt: mySalt,
  }

  return secret
}

export const wipeWalletKey = async (useBiometrics: boolean) => {
  const opts = optionsForKeychainAccess(KeychainServices.Key, useBiometrics)
  await Keychain.resetGenericPassword(opts)
}

export const storeWalletKey = async (secret: WalletKey, useBiometrics = false): Promise<boolean> => {
  const opts = optionsForKeychainAccess(KeychainServices.Key, useBiometrics)
  const secretAsString = JSON.stringify(secret)
  await wipeWalletKey(useBiometrics)
  const result = await Keychain.setGenericPassword(keyFauxUserName, secretAsString, opts)
  return Boolean(result)
}

export const storeWalletSalt = async (secret: WalletSalt): Promise<boolean> => {
  const opts = optionsForKeychainAccess(KeychainServices.Salt, false)
  const secretAsString = JSON.stringify(secret)
  const result = await Keychain.setGenericPassword(saltFauxUserName, secretAsString, opts)
  return Boolean(result)
}

export const storeLoginAttempt = async (loginAttempt: LoginAttempt): Promise<boolean> => {
  const opts = optionsForKeychainAccess(KeychainServices.LoginAttempt, false)
  const loginAttemptAsString = JSON.stringify(loginAttempt)
  const result = await Keychain.setGenericPassword(loginAttemptFauxUserName, loginAttemptAsString, opts)
  return Boolean(result)
}

export const storeWalletSecret = async (secret: WalletSecret, useBiometrics = false): Promise<boolean> => {
  let keyResult = false
  if (secret.key) {
    keyResult = await storeWalletKey({ key: secret.key }, useBiometrics)
  }

  const saltResult = await storeWalletSalt({ id: secret.id, salt: secret.salt })

  return keyResult && saltResult
}

export const loadWalletSalt = async (): Promise<WalletSalt | undefined> => {
  let salt: WalletSalt | undefined = undefined
  const opts: GetOptions = {
    service: KeychainServices.Salt,
  }
  const result = await Keychain.getGenericPassword(opts)
  if (!result) {
    return
  }

  // salt data is stored and returned as a string and needs to be parsed
  const parsedSalt = JSON.parse(result.password)
  if (!parsedSalt.id || !parsedSalt.salt) {
    throw new Error('Wallet salt failed to load')
  }

  salt = {
    id: parsedSalt.id,
    salt: parsedSalt.salt,
  }

  return salt
}

export const loadLoginAttempt = async (): Promise<LoginAttempt | undefined> => {
  const opts: GetOptions = {
    service: KeychainServices.LoginAttempt,
  }

  const result = await Keychain.getGenericPassword(opts)
  if (!result) {
    return
  }

  return JSON.parse(result.password) as LoginAttempt
}

export const loadWalletKey = async (title?: string, description?: string): Promise<WalletKey | undefined> => {
  let opts: GetOptions = {
    service: KeychainServices.Key,
  }

  if (title && description) {
    opts = {
      ...opts,
      authenticationPrompt: {
        title,
        description,
      },
    }
  }
  const result = await Keychain.getGenericPassword(opts)

  if (!result) {
    return
  }

  return JSON.parse(result.password) as WalletKey
}

export const loadWalletSecret = async (title?: string, description?: string): Promise<WalletSecret | undefined> => {
  let salt: WalletSalt | undefined
  let key: WalletKey | undefined
  let secret: WalletSecret | undefined = undefined
  try {
    salt = await loadWalletSalt()
    key = await loadWalletKey(title, description)
  } catch (e: any) {
    throw new Error(e?.message ?? e)
  }

  if (!salt?.id || !salt?.salt || !key) {
    throw new Error('Wallet secret is missing key property')
  }

  secret = {
    id: salt.id,
    key: key.key,
    salt: salt.salt,
  }
  return secret
}

const biometryProbeFauxUserName = 'WalletFauxBiometryProbeUserName'
export const BIOMETRY_PROBE_TIMEOUT_MS = 60_000

const removeBiometryProbe = async (): Promise<void> => {
  try {
    await Keychain.resetGenericPassword({ service: KeychainServices.BiometryProbe })
  } catch {
    // Nothing to remove, or nothing we can do: the item never holds a secret.
  }
}

/**
 * Confirms that Face ID / Touch ID can open a keychain item protected the same
 * way as the wallet key (BIOMETRY_ANY, this device only), before Biometric
 * Unlock is turned on. It writes a throwaway value under its own service,
 * reads it back (this is what shows iOS's Face ID permission alert the first
 * time, then a scan), and deletes it. It never touches the wallet key's items.
 *
 * Resolves true only when the read returns the value it wrote. A decline, a
 * cancel, a failed scan, a keychain error, or no answer within `timeoutMs`
 * resolves false: the wallet key must never be stored behind biometrics that
 * cannot open it, because a PIN path reads that key too (checkWalletPIN's
 * onboarding fallback). The timeout matters because the bug this replaces was
 * a permission request that never resolved.
 */
export const confirmBiometricKeychainAccess = async (
  title: string,
  description: string,
  timeoutMs: number = BIOMETRY_PROBE_TIMEOUT_MS
): Promise<boolean> => {
  const service = KeychainServices.BiometryProbe
  const value = String(uuid.v4())

  // A probe left behind by an attempt the app was killed during.
  await removeBiometryProbe()

  const probe = async (): Promise<boolean> => {
    try {
      const stored = await Keychain.setGenericPassword(
        biometryProbeFauxUserName,
        value,
        optionsForKeychainAccess(service, true)
      )
      if (!stored) {
        return false
      }
      const result = await Keychain.getGenericPassword({ service, authenticationPrompt: { title, description } })
      return result !== false && result.password === value
    } catch {
      return false
    } finally {
      await removeBiometryProbe()
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([probe(), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

// This function checks if the biometrics on a device have been configured
// If fingerprints or a face scan is setup, this will return true
// If the device supports biometrics but they have not been configured, it will return false
export const isBiometricsActive = async (): Promise<boolean> => {
  const result = await getSupportedBiometryType()
  return Boolean(result)
}
