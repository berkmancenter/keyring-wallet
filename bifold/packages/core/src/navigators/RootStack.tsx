import AgentProvider from '@bifold/react-hooks'
import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DeviceEventEmitter } from 'react-native'

import { OpenIDCredentialRecordProvider } from '../modules/openid/context/OpenIDCredentialRecordProvider'
import { VrcNameCacheProvider } from '../modules/vrc/context/VrcNameCacheProvider'
import { WitnessConnectionProvider } from '../modules/vrc/context/WitnessConnectionProvider'
import { EventTypes } from '../constants'
import { TOKENS, useServices } from '../container-api'
import { ActivityProvider } from '../contexts/activity'
import { BiometricConfirmationProvider } from '../contexts/biometric-confirmation'
import RelationshipProposalModal from '../modules/vrc/components/RelationshipProposalModal'
import ContinuityCheckModal from '../modules/vrc/components/ContinuityCheckModal'
import LocalityPreflightModal from '../modules/vrc/components/LocalityPreflightModal'
import CredentialExchangeQueryModal from '../modules/trust-tasks/components/CredentialExchangeQueryModal'
import { useStore } from '../contexts/store'
import { afterChatDrafts } from '../modules/chat/draft'
import { BifoldError } from '../types/error'
import { LockShutdown, oldStoreClosed } from '../utils/lockShutdown'
import MainStack from './MainStack'

const RootStack: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const [useAgentSetup, OnboardingStack, loadState] = useServices([
    TOKENS.HOOK_USE_AGENT_SETUP,
    TOKENS.STACK_ONBOARDING,
    TOKENS.LOAD_STATE,
  ])
  const { agent, initializeAgent, shutdownAndClearAgentIfExists } = useAgentSetup()
  // The agent a lock-out shuts down, and that shutdown; a new start waits for it (initializeAgentAfterLockShutdown).
  const agentRef = useRef(agent)
  agentRef.current = agent
  const lockShutdownRef = useRef<LockShutdown | null>(null)
  const [onboardingComplete, setOnboardingComplete] = useState(false)

  const shouldRenderMainStack = useMemo(
    () => onboardingComplete && store.authentication.didAuthenticate,
    [onboardingComplete, store.authentication.didAuthenticate]
  )

  useEffect(() => {
    // if user gets locked out, erase agent: once a chat's last draft save is written, since locking unmounts the chat
    // in this same moment (chat/draft.ts)
    if (!store.authentication.didAuthenticate) {
      lockShutdownRef.current = { agent: agentRef.current, done: afterChatDrafts(shutdownAndClearAgentIfExists) }
    }
  }, [store.authentication.didAuthenticate, shutdownAndClearAgentIfExists])

  // A fast re-unlock (biometrics in under a second) could otherwise start a new agent while the lock-out's shutdown
  // of the old one is still running: two agents on one Askar store. The start waits for that shutdown, and proceeds
  // only once the old store is known closed (utils/lockShutdown.ts); otherwise it fails into the start's error, and a
  // relaunch, or a retry once the shutdown has finished, gets past it.
  const initializeAgentAfterLockShutdown = useCallback(
    async (walletSecret: Parameters<typeof initializeAgent>[0]) => {
      const lockShutdown = lockShutdownRef.current
      if (lockShutdown) {
        // The start's error card shows this text, and it is what the person can act on.
        if (!(await oldStoreClosed(lockShutdown))) throw new Error(t('RootStack.LastSessionNotClosed'))
        lockShutdownRef.current = null
      }
      return initializeAgent(walletSecret)
    },
    [initializeAgent, t]
  )

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EventTypes.DID_COMPLETE_ONBOARDING, () => {
      setOnboardingComplete(true)
    })

    return sub.remove
  }, [])

  useEffect(() => {
    // Load state only if it hasn't been loaded yet
    if (store.stateLoaded) return

    loadState(dispatch).catch((err: unknown) => {
      const error = new BifoldError(t('Error.Title1044'), t('Error.Message1044'), (err as Error).message, 1001)

      DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
    })
  }, [dispatch, loadState, t, store.stateLoaded])

  if (shouldRenderMainStack && agent) {
    return (
      <AgentProvider agent={agent}>
        <BiometricConfirmationProvider>
          <OpenIDCredentialRecordProvider>
            <VrcNameCacheProvider>
              <WitnessConnectionProvider agent={agent}>
                <ActivityProvider>
                  <MainStack />
                  <RelationshipProposalModal />
                  <ContinuityCheckModal />
                  <LocalityPreflightModal />
                  <CredentialExchangeQueryModal />
                </ActivityProvider>
              </WitnessConnectionProvider>
            </VrcNameCacheProvider>
          </OpenIDCredentialRecordProvider>
        </BiometricConfirmationProvider>
      </AgentProvider>
    )
  }

  return <OnboardingStack agent={agent} initializeAgent={initializeAgentAfterLockShutdown} />
}

export default RootStack
