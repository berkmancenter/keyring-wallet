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
 */
class RetryingHttpOutboundTransport extends DidCommHttpOutboundTransport {
  public async sendMessage(outboundPackage: Parameters<DidCommHttpOutboundTransport['sendMessage']>[0]) {
    try {
      return await super.sendMessage(outboundPackage)
    } catch {
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

// Pickup V2 periodic polling (10s, set in bc-agent-modules). Live mode held a
// WebSocket open for mediator push, but a socket that dies silently (NAT/proxy
// idle reaping) leaves the wallet deaf for minutes AND the mediator live-pushes
// into the dead socket without requeueing — the message is lost outright
// (measured 2026-08-18: mediator reported message_count:0 after such a window;
// docs/spikes/e2e-vrc-connect-findings.md). Polling makes every delivery
// request/ack'd against the mediator's queue and each poll self-heals a dead
// socket. Revisit live mode once the mediator requeues unacked live deliveries.
const configureMessagePickup = async (agent: Agent): Promise<void> => {
  // Stop the pickup credo already started during agent.initialize() before
  // starting ours. initiateMessagePickup SUBSCRIBES A NEW polling interval on
  // every call — it does not replace the previous one — so without this we run
  // two concurrent loops and double this wallet's request rate against the
  // shared mediator (at the 1s interval below, ~172k requests/day per idle
  // wallet instead of ~86k). Observed on the witness-server 2026-08-31.
  await agent.modules.didcomm.mediationRecipient.stopMessagePickup()

  // Pass the strategy EXPLICITLY: credo otherwise resolves it as
  // `mediationRecord.pickupStrategy ?? moduleConfig`, and a value persisted in
  // the wallet outranks the config — which is how the same code ends up
  // receiving messages on one wallet and deaf on another.
  await agent.modules.didcomm.mediationRecipient.initiateMessagePickup(
    undefined,
    DidCommMediatorPickupStrategy.PickUpV2
  )
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
    [logger]
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
      await newAgent.initialize()

      // Fix up R-Card template records stored by pre-credo-0.6 versions (no
      // proof) before any UI provider reads W3C credential records
      await migrateRCardTemplateProofs(newAgent)

      logger.info(`configuring message pickup for ${mediatorUrl}`)
      await configureMessagePickup(newAgent)

      logger.info('Warming up cache...')
      await warmUpCache(newAgent, cachedLedgers)

      logger.info('Creating link secret if required...')
      await createLinkSecretIfRequired(newAgent)

      logger.info('Setting up VRC connection handler...')
      setupVrcConnectionHandler(newAgent)

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
