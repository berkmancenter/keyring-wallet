// Dont remove the following import line or the pin check will fail when opening askar waller
import '@hyperledger/aries-askar-react-native'

import 'reflect-metadata'
import { DeviceEventEmitter } from 'react-native'
import { AskarWallet } from '@credo-ts/askar'
import { Agent, ConsoleLogger, LogLevel, SigningProviderRegistry } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/react-native'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DispatchAction } from './reducers/store'
import { useStore } from './store'
import {
  isBiometricsActive,
  loadWalletKey,
  loadWalletSalt,
  loadWalletSecret,
  secretForPIN,
  storeWalletSecret,
  wipeWalletKey,
} from '../services/keychain'
import { WalletSecret } from '../types/security'
import { hashPIN } from '../utils/crypto'
import { migrateToAskar } from '../utils/migration'
import { BifoldError } from '../types/error'
import { EventTypes } from '../constants'

export interface AuthContext {
  lockOutUser: (reason: LockoutReason) => void
  checkWalletPIN: (PIN: string) => Promise<boolean>
  getWalletSecret: () => Promise<WalletSecret | undefined>
  walletSecret?: WalletSecret
  removeSavedWalletSecret: () => void
  disableBiometrics: () => Promise<void>
  setPIN: (PIN: string) => Promise<void>
  commitWalletToKeychain: (useBiometry: boolean) => Promise<boolean>
  isBiometricsActive: () => Promise<boolean>
  verifyPIN: (PIN: string) => Promise<boolean>
  rekeyWallet: (agent: Agent, oldPin: string, newPin: string, useBiometry?: boolean) => Promise<boolean>
}

export const AuthContext = createContext<AuthContext>(null as unknown as AuthContext)
export enum LockoutReason {
  Timeout = 'Timeout',
  Logout = 'Logout',
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [walletSecret, setWalletSecret] = useState<WalletSecret>()
  const [store, dispatch] = useStore()
  const { t } = useTranslation()

  const setPIN = useCallback(async (PIN: string): Promise<void> => {
    const secret = await secretForPIN(PIN)
    await storeWalletSecret(secret)
  }, [])

  const getWalletSecret = useCallback(async (): Promise<WalletSecret | undefined> => {
    if (walletSecret) {
      return walletSecret
    }

    const secret = await loadWalletSecret(t('Biometry.UnlockPromptTitle'), t('Biometry.UnlockPromptDescription'))

    setWalletSecret(secret)

    return secret
  }, [t, walletSecret])

  const commitWalletToKeychain = useCallback(
    async (useBiometry: boolean): Promise<boolean> => {
      const secret = await getWalletSecret()
      if (!secret) {
        return false
      }

      // set did authenticate to true if we can get wallet credentials
      dispatch({
        type: DispatchAction.DID_AUTHENTICATE,
      })
      if (useBiometry) {
        await storeWalletSecret(secret, useBiometry)
      } else if (store.onboarding.didCompleteOnboarding) {
        // Only wipe the key after onboarding is complete (wallet exists).
        // During initial onboarding the Askar wallet hasn't been created yet,
        // so we keep the key in the keychain to allow PIN verification if the
        // app is force-closed before the wallet is created.
        await wipeWalletKey(useBiometry)
      }

      return true
    },
    [dispatch, getWalletSecret, store.onboarding.didCompleteOnboarding]
  )

  const checkWalletPIN = useCallback(
    async (PIN: string): Promise<boolean> => {
      try {
        const secret = await loadWalletSalt()

        if (!secret?.salt) {
          return false
        }

        const hash = await hashPIN(PIN, secret.salt)

        if (!store.migration.didMigrateToAskar) {
          await migrateToAskar(secret.id, hash)
          dispatch({
            type: DispatchAction.DID_MIGRATE_TO_ASKAR,
          })
        }

        // NOTE: We create an instance of AskarWallet, which is the underlying wallet that powers the app
        // we then open that instance with the provided id and key to verify their integrity
        const askarWallet = new AskarWallet(
          new ConsoleLogger(LogLevel.off),
          new agentDependencies.FileSystem(),
          new SigningProviderRegistry([])
        )

        try {
          await askarWallet.open({
            id: secret.id,
            key: hash,
          })
          await askarWallet.close()
        } catch (openError) {
          // The Askar wallet is only created during agent initialization (Splash).
          // If the user force-closed the app during onboarding before Splash ran,
          // the wallet doesn't exist yet and open() will fail for any PIN.
          // Verify the PIN against the stored key in the keychain instead.
          if (!store.onboarding.didCompleteOnboarding) {
            const storedKey = await loadWalletKey()
            if (!storedKey || storedKey.key !== hash) {
              return false
            }
            setWalletSecret({ id: secret.id, key: hash, salt: secret.salt })
            // Now that we've verified, wipe the key (biometrics-disabled behavior)
            if (!store.preferences.useBiometry) {
              await wipeWalletKey(false)
            }
            return true
          }
          throw openError
        }

        setWalletSecret({ id: secret.id, key: hash, salt: secret.salt })
        return true
      } catch (e) {
        return false
      }
    },
    [dispatch, store.migration.didMigrateToAskar, store.onboarding.didCompleteOnboarding, store.preferences.useBiometry]
  )

  const removeSavedWalletSecret = useCallback(() => {
    setWalletSecret(undefined)
  }, [])

  const lockOutUser = useCallback(
    (reason: LockoutReason) => {
      removeSavedWalletSecret()
      dispatch({
        type: DispatchAction.DID_AUTHENTICATE,
        payload: [false],
      })
      dispatch({
        type: DispatchAction.LOCKOUT_UPDATED,
        payload: [{ displayNotification: reason === LockoutReason.Timeout }],
      })
    },
    [removeSavedWalletSecret, dispatch]
  )

  const disableBiometrics = useCallback(async () => {
    await wipeWalletKey(true)
  }, [])

  const rekeyWallet = useCallback(
    async (agent: Agent, oldPin: string, newPin: string, useBiometry?: boolean): Promise<boolean> => {
      try {
        if (!agent) {
          // no agent set, cannot rekey the wallet
          return false
        }
        // argon2.hash can sometimes generate an error
        const secret = await loadWalletSalt()
        if (!secret) {
          return false
        }

        const oldHash = await hashPIN(oldPin, secret.salt)
        const newSecret = await secretForPIN(newPin)
        const newHash = await hashPIN(newPin, newSecret.salt)
        if (!newSecret.key) {
          return false
        }

        await agent.wallet.close()
        // wallet.rotateKey calls open under the hood
        await agent.wallet.rotateKey({ id: secret.id, key: oldHash, rekey: newHash })

        await storeWalletSecret(newSecret, useBiometry)
        setWalletSecret(newSecret)
      } catch {
        return false
      }
      return true
    },
    []
  )

  const verifyPIN = useCallback(
    async (PIN: string) => {
      try {
        const credentials = await getWalletSecret()
        if (!credentials) {
          throw new Error('Get wallet credentials error')
        }

        const key = await hashPIN(PIN, credentials.salt)
        if (credentials.key !== key) {
          return false
        }

        return true
      } catch (err: unknown) {
        const error = new BifoldError(
          t('Error.Title1042'),
          t('Error.Message1042'),
          (err as Error)?.message ?? err,
          1042
        )
        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
        return false
      }
    },
    [getWalletSecret, t]
  )

  // During initial onboarding we keep the wallet key in the keychain so that
  // PIN verification still works if the app is force-closed before the wallet
  // is created.  Once onboarding completes (wallet exists) and biometrics is
  // disabled, wipe the key so that only the salt remains (normal behavior).
  const prevOnboardingComplete = useRef(store.onboarding.didCompleteOnboarding)
  useEffect(() => {
    if (!prevOnboardingComplete.current && store.onboarding.didCompleteOnboarding && !store.preferences.useBiometry) {
      wipeWalletKey(false)
    }
    prevOnboardingComplete.current = store.onboarding.didCompleteOnboarding
  }, [store.onboarding.didCompleteOnboarding, store.preferences.useBiometry])

  return (
    <AuthContext.Provider
      value={{
        lockOutUser,
        checkWalletPIN,
        getWalletSecret,
        removeSavedWalletSecret,
        disableBiometrics,
        commitWalletToKeychain,
        setPIN,
        isBiometricsActive,
        rekeyWallet,
        walletSecret,
        verifyPIN,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
