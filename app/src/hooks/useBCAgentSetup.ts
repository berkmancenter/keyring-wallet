import {
  createLinkSecretIfRequired,
  DispatchAction,
  migrateRCardTemplateProofs,
  migrateToAskar,
  PersistentStorage,
  runDataIntegritySelfTest,
  TOKENS,
  useServices,
  useStore,
  WalletSecret,
  setupVrcConnectionHandler,
  setupTrustTasksInbound,
  setTspCarriageEnabled,
  setDidCommV2Enabled,
  provisionV2Mediation,
  startV2MessagePickup,
} from '@bifold/core'
import { Agent } from '@credo-ts/core'
import {
  DidCommHttpOutboundTransport,
  DidCommMediatorPickupStrategy,
  DidCommWsOutboundTransport,
} from '@credo-ts/didcomm'
import { IndyVdrPoolConfig, IndyVdrPoolService } from '@credo-ts/indy-vdr'
import { agentDependencies } from '@credo-ts/react-native'
import { GetCredentialDefinitionRequest, GetSchemaRequest } from '@hyperledger/indy-vdr-shared'
import moment from 'moment'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import Config from 'react-native-config'
import { CachesDirectoryPath } from 'react-native-fs'
// DISABLED: Push notifications disabled — no server backend yet
// import { activate } from '@/utils/PushNotificationsHelper'
import { getBCAgentModules } from '@/utils/bc-agent-modules'
import { BCState, BCLocalStorageKeys } from '@/store'

/**
 * NSURLSession (iOS) reuses idle keep-alive sockets the mediator side has
 * already reset (~45-50s idle); the POST then fails with "Network request
 * failed" and CFNetwork never retries non-idempotent requests, so a single
 * stale socket kills a DIDComm exchange. OkHttp on Android retries stale
 * pooled connections transparently — this restores parity by retrying the
 * send once on a fresh connection. See docs/spikes/e2e-vrc-connect-findings.md.
 *
 * Only that specific symptom is retried: CredoError wraps the fetch-layer
 * failure as `cause`, and "Network request failed" is thrown before any
 * response is received, so the POST body was never delivered. Any other
 * failure (including one after a response came back, e.g. a body-parsing
 * error) is rethrown as-is rather than resending an already-delivered,
 * non-idempotent message.
 */
class RetryingHttpOutboundTransport extends DidCommHttpOutboundTransport {
  public async sendMessage(outboundPackage: Parameters<DidCommHttpOutboundTransport['sendMessage']>[0]) {
    try {
      return await super.sendMessage(outboundPackage)
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      const causeMessage = cause instanceof Error ? cause.message : undefined
      if (causeMessage !== 'Network request failed') {
        throw error
      }
      return await super.sendMessage(outboundPackage)
    }
  }
}

const loadCachedLedgers = async (): Promise<IndyVdrPoolConfig[] | undefined> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedTransactions = await PersistentStorage.fetchValueForKey<any>(BCLocalStorageKeys.GenesisTransactions)
  if (cachedTransactions) {
    const { timestamp, transactions } = cachedTransactions
    return moment().diff(moment(timestamp), 'days') >= 1 ? undefined : transactions
  }
}

// Pickup V2 periodic polling (1s, set in bc-agent-modules). Live mode held a
// WebSocket open for mediator push, but a socket that dies silently (NAT/proxy
// idle reaping) leaves the wallet deaf for minutes AND the mediator live-pushes
// into the dead socket without requeueing — the message is lost outright
// (measured 2026-08-18: mediator reported message_count:0 after such a window;
// docs/spikes/e2e-vrc-connect-findings.md). Polling makes every delivery
// request/ack'd against the mediator's queue and each poll self-heals a dead
// socket. Revisit live mode once the mediator requeues unacked live deliveries.
const configureMessagePickup = async (agent: Agent): Promise<void> => {
  // Stop the pickup credo already started during agent.initialize() before
  // starting ours. Stock initiateMessagePickup SUBSCRIBES A NEW polling
  // interval on every call without replacing the previous one — two loops
  // doubled this wallet's request rate against the shared mediator (observed
  // on the witness-server 2026-08-31). Our credo patch now makes
  // initiateMessagePickup stop any running loop itself (guarded by
  // mediatorPickupStrategy.guard.test.ts); the explicit stop stays as the
  // belt to that suspender.
  await agent.modules.didcomm.mediationRecipient.stopMessagePickup()

  // Pass the strategy EXPLICITLY: credo otherwise resolves it as
  // `mediationRecord.pickupStrategy ?? moduleConfig`, and a value persisted in
  // the wallet outranks the config — which is how the same code ends up
  // receiving messages on one wallet and deaf on another.
  await agent.modules.didcomm.mediationRecipient.initiateMessagePickup(
    undefined,
    DidCommMediatorPickupStrategy.PickUpV2
  )

  // Second loop, Pickup 4.0 against the v2 mediator when one is provisioned
  // (didcomm_v2_subtask.md V2 step 4). AFTER the v1 start: that start stops
  // every running loop (the anti-stacking guard in the credo patch), the v4
  // start does not, so this order leaves exactly one loop per mediator.
  await startV2MessagePickup(agent)
}

/**
 * Provision Coordinate Mediation 2.0 with the mediator named by
 * MEDIATOR_V2_URL (a second deployment beside the v1 mediator — §7.1 of the
 * subtask plan; the production v1 mediator is never upgraded in place).
 * Idempotent, and a failure is logged rather than fatal: the wallet keeps
 * working over v1, and v2 invitations fall back to unmediated routing.
 */
const provisionV2MediationIfConfigured = async (agent: Agent, enabled: boolean): Promise<void> => {
  const invitationUrl = Config.MEDIATOR_V2_URL
  if (!enabled || !invitationUrl) {
    // Logged so a device run shows WHY v2 mediation did not start: the flag
    // (persisted developer setting) or the build (MEDIATOR_V2_URL in .env).
    agent.config.logger.info(
      `[TrustTasks:V2Mediation] not provisioning: flag=${enabled ? 'on' : 'off'}, MEDIATOR_V2_URL=${
        invitationUrl ? 'set' : 'unset'
      }`
    )
    return
  }
  try {
    await provisionV2Mediation(agent, invitationUrl)
    await startV2MessagePickup(agent)
  } catch (error) {
    agent.config.logger.warn(
      `[TrustTasks:V2Mediation] provisioning failed, continuing on v1 only: ${(error as Error).message}`
    )
  }
}

const useBCAgentSetup = () => {
  const [agent, setAgent] = useState<Agent | null>(null)
  const agentInstanceRef = useRef<Agent | null>(null)
  const [store, dispatch] = useStore<BCState>()
  const [logger, indyLedgers, credDefs, schemas] = useServices([
    TOKENS.UTIL_LOGGER,
    TOKENS.UTIL_LEDGERS,
    TOKENS.CACHE_CRED_DEFS,
    TOKENS.CACHE_SCHEMAS,
  ])

  const restartExistingAgent = useCallback(
    async (agent: Agent): Promise<Agent | undefined> => {
      try {
        // credo 0.6: the askar store config (id/key) lives on the AskarModule,
        // so re-initializing reopens the wallet
        await agent.initialize()
      } catch (error) {
        logger.warn(`Agent restart failed with error ${error}`)
        // if the existing agents wallet cannot be opened or initialize() fails it was
        // again not a clean shutdown and the agent should be replaced, not restarted
        return
      }

      return agent
    },
    [logger]
  )

  const createNewAgent = useCallback(
    async (ledgers: IndyVdrPoolConfig[], walletSecret: WalletSecret, mediatorUrl: string): Promise<Agent> => {
      const options = {
        config: {
          logger,
          autoUpdateStorageOnStartup: true,
          // credo 0.6: wallet id/key live on the AskarModule store config,
          // mediation + auto-accept live on the DidCommModule (see bc-agent-modules.ts)
          // Document loader is configured in W3cCredentialsModule (see bc-agent-modules.ts)
        },
        dependencies: agentDependencies,
        modules: getBCAgentModules({
          walletSecret,
          indyNetworks: ledgers,
          mediatorInvitationUrl: mediatorUrl,
          enableDidCommV2: !!store.developer.enableDidCommV2,
          txnCache: {
            capacity: 1000,
            expiryOffsetMs: 1000 * 60 * 60 * 24 * 7,
            path: CachesDirectoryPath + '/txn-cache',
          },
        }),
      }

      const newAgent = new Agent(options)
      const wsTransport = new DidCommWsOutboundTransport()
      const httpTransport = new RetryingHttpOutboundTransport()

      newAgent.modules.didcomm.registerOutboundTransport(wsTransport)
      newAgent.modules.didcomm.registerOutboundTransport(httpTransport)

      return newAgent
    },
    [logger, store.developer.enableDidCommV2]
  )

  const migrateIfRequired = useCallback(
    async (newAgent: Agent, walletSecret: WalletSecret) => {
      // If we haven't migrated to Aries Askar yet, we need to do this before we initialize the agent.
      if (!store.migration.didMigrateToAskar) {
        await migrateToAskar(walletSecret.id, walletSecret.key, newAgent)
        dispatch({
          type: DispatchAction.DID_MIGRATE_TO_ASKAR,
        })
      }
    },
    [store.migration.didMigrateToAskar, dispatch]
  )

  const warmUpCache = useCallback(
    async (newAgent: Agent, cachedLedgers?: IndyVdrPoolConfig[]) => {
      const poolService = newAgent.dependencyManager.resolve(IndyVdrPoolService)
      // refreshPoolConnections/getAllPoolTransactions came from the BC indy-vdr
      // patch (credo 0.5); the unpatched 0.6.3 pool service does not have them
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore:next-line
      if (!cachedLedgers && typeof poolService.refreshPoolConnections === 'function') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore:next-line
        await poolService.refreshPoolConnections()
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore:next-line
        const raw_transactions = await poolService.getAllPoolTransactions()
        const transactions = raw_transactions
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore:next-line
          .map((item) => item.value)
          .map(({ config, transactions }) => ({
            ...config,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore:next-line
            genesisTransactions: transactions.reduce((prev, curr) => {
              return prev + JSON.stringify(curr)
            }, ''),
          }))
        if (transactions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await PersistentStorage.storeValueForKey<any>(BCLocalStorageKeys.GenesisTransactions, {
            timestamp: moment().toISOString(),
            transactions,
          })
        }
      }

      credDefs.forEach(async ({ did, id }) => {
        const pool = await poolService.getPoolForDid(newAgent.context, did)
        const credDefRequest = new GetCredentialDefinitionRequest({ credentialDefinitionId: id })
        await pool.pool.submitRequest(credDefRequest)
      })

      schemas.forEach(async ({ did, id }) => {
        const pool = await poolService.getPoolForDid(newAgent.context, did)
        const schemaRequest = new GetSchemaRequest({ schemaId: id })
        await pool.pool.submitRequest(schemaRequest)
      })
    },
    [credDefs, schemas]
  )

  const initializeAgent = useCallback(
    async (walletSecret: WalletSecret): Promise<void> => {
      const mediatorUrl = store.preferences.selectedMediator
      logger.info('Checking for existing agent...')
      if (agentInstanceRef.current) {
        const restartedAgent = await restartExistingAgent(agentInstanceRef.current)
        if (restartedAgent) {
          logger.info('Successfully restarted existing agent...')
          await configureMessagePickup(restartedAgent)
          agentInstanceRef.current = restartedAgent
          setAgent(restartedAgent)
          return
        }
      }

      logger.info('Checking for cached ledgers...')
      const cachedLedgers = await loadCachedLedgers()
      const ledgers = cachedLedgers ?? indyLedgers

      logger.info('Creating new agent...')
      const newAgent = await createNewAgent(ledgers, walletSecret, mediatorUrl)

      logger.info('Migrating agent if required...')
      await migrateIfRequired(newAgent, walletSecret)

      logger.info('Initializing agent...')
      try {
        await newAgent.initialize()
      } catch (error) {
        // Credo wraps module-init failures ("Error during call to
        // 'onInitializeContext' method in module 'didcomm'") and puts the
        // real reason on `cause`. Log the whole chain at info as well: on iOS
        // dev builds console.error is captured by LogBox and never reaches
        // the device log, so an error-only line leaves nothing to read.
        const chain: string[] = []
        let current: unknown = error
        while (current instanceof Error && chain.length < 6) {
          chain.push(`${current.name}: ${current.message}`)
          current = (current as Error & { cause?: unknown }).cause
        }
        logger.error(`Agent initialization failed: ${chain.join(' <- ')}`)
        logger.info(`[AgentInit] failure chain: ${chain.join(' <- ')}`)
        throw error
      }

      // Fix up R-Card template records stored by pre-credo-0.6 versions (no
      // proof) before any UI provider reads W3C credential records
      await migrateRCardTemplateProofs(newAgent)

      logger.info(`configuring message pickup for ${mediatorUrl}`)
      await configureMessagePickup(newAgent)
      await provisionV2MediationIfConfigured(newAgent, !!store.developer.enableDidCommV2)

      logger.info('Warming up cache...')
      await warmUpCache(newAgent, cachedLedgers)

      logger.info('Creating link secret if required...')
      await createLinkSecretIfRequired(newAgent)

      logger.info('Setting up VRC connection handler...')
      setupVrcConnectionHandler(newAgent)

      // Dev/test-only carriage selection (docs/plans/openvtc-integration-plan
      // §5.4's TSP scope correction) — must be set before setupTrustTasksInbound
      // registers the inbound handler(s), since that registration only happens
      // once per agent. Toggling Developer > Enable TSP envelope carriage takes
      // effect on outbound sends immediately, but needs a restart for inbound.
      setTspCarriageEnabled(!!store.developer.enableTspCarriage)
      setDidCommV2Enabled(!!store.developer.enableDidCommV2)

      logger.info('Setting up Trust Tasks inbound handler (binding 0.2)...')
      setupTrustTasksInbound(newAgent)

      if (__DEV__) {
        // Level 2b probe: prove eddsa-rdfc-2022 sign/verify on-device
        // (expo-crypto SHA-256, askar KMS, RDFC on Hermes). Fire-and-forget;
        // results in the agent log (docs/CRYPTO_SUITE_FOLLOWUP.md).
        void runDataIntegritySelfTest(newAgent)
      }

      // DISABLED: Push notifications disabled — no server backend yet
      // if (store.preferences.usePushNotifications) {
      //   logger.info('Activating push notifications...')
      //   activate(newAgent)
      // }

      logger.info('Setting new agent...')
      agentInstanceRef.current = newAgent
      setAgent(newAgent)
    },
    [
      store.preferences.selectedMediator,
      store.developer.enableTspCarriage,
      store.developer.enableDidCommV2,
      // store.preferences.usePushNotifications, // DISABLED: Push notifications disabled
      logger,
      indyLedgers,
      createNewAgent,
      migrateIfRequired,
      warmUpCache,
      restartExistingAgent,
    ]
  )

  const shutdownAndClearAgentIfExists = useCallback(async () => {
    if (agent) {
      try {
        await agent.shutdown()
      } catch (error) {
        logger.error(`Error shutting down agent with shutdownAndClearAgentIfExists: ${error}`)
      } finally {
        setAgent(null)
      }
    }
  }, [agent, logger])

  // Restart message pickup when the app returns to the foreground.
  //
  // configureMessagePickup starts a PickUpV2 polling loop built on JS timers.
  // The OS suspends those while the app is backgrounded, and nothing restarted
  // them on resume — so inbound messages piled up in the mediator's queue and
  // the wallet sat there ("Establishing connection…") until the app was killed
  // and a fresh agent re-initiated pickup. Observed on device 2026-08-26; a
  // 24-minute stall that drained instantly on restart.
  //
  // stopMessagePickup() first so a resumed loop never stacks on a stale one.
  // Note bifold core's ActivityProvider restarts pickup on the same transition
  // (background → foreground); both handlers racing their stop→start once
  // left a Galaxy A03s with two loops and 50 s of inbound lag (2026-09-13).
  // The credo patch (initiateMessagePickup stops the running loop first) is
  // what makes the pair safe — see configureMessagePickup.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState !== 'active') return
      const activeAgent = agentInstanceRef.current
      if (!activeAgent?.isInitialized) return
      try {
        await activeAgent.modules.didcomm.mediationRecipient.stopMessagePickup()
        await configureMessagePickup(activeAgent)
        logger.info('Message pickup restarted after returning to the foreground')
      } catch (error) {
        logger.warn(`Could not restart message pickup on foreground: ${(error as Error).message}`)
      }
    })

    return () => subscription.remove()
  }, [logger])

  return { agent, initializeAgent, shutdownAndClearAgentIfExists }
}

export default useBCAgentSetup
