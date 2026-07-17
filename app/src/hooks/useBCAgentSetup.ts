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
import { useCallback, useRef, useState } from 'react'
import { CachesDirectoryPath } from 'react-native-fs'
// DISABLED: Push notifications disabled — no server backend yet
// import { activate } from '@/utils/PushNotificationsHelper'
import { getBCAgentModules } from '@/utils/bc-agent-modules'
import { BCState, BCLocalStorageKeys } from '@/store'

const loadCachedLedgers = async (): Promise<IndyVdrPoolConfig[] | undefined> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedTransactions = await PersistentStorage.fetchValueForKey<any>(BCLocalStorageKeys.GenesisTransactions)
  if (cachedTransactions) {
    const { timestamp, transactions } = cachedTransactions
    return moment().diff(moment(timestamp), 'days') >= 1 ? undefined : transactions
  }
}

// Live mode holds a WebSocket open to the mediator, which pushes messages as
// they arrive (upstream bc-wallet-mobile approach). This replaced the previous
// batch-pickup + 5s trust-ping polling loop; our hosted mediator advertises a
// wss endpoint so the socket-based delivery works without polling.
const configureMessagePickup = async (agent: Agent): Promise<void> => {
  await agent.modules.didcomm.mediationRecipient.initiateMessagePickup(
    undefined,
    DidCommMediatorPickupStrategy.PickUpV2LiveMode
  )
}

const useBCAgentSetup = () => {
  const [agent, setAgent] = useState<Agent | null>(null)
  const agentInstanceRef = useRef<Agent | null>(null)
  const [store, dispatch] = useStore<BCState>()
  const [logger, indyLedgers, attestationMonitor, credDefs, schemas] = useServices([
    TOKENS.UTIL_LOGGER,
    TOKENS.UTIL_LEDGERS,
    TOKENS.UTIL_ATTESTATION_MONITOR,
    TOKENS.CACHE_CRED_DEFS,
    TOKENS.CACHE_SCHEMAS,
  ])

  const refreshAttestationMonitor = useCallback(
    (agent: Agent) => {
      attestationMonitor?.stop()
      attestationMonitor?.start(agent)
    },
    [attestationMonitor]
  )

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
      const httpTransport = new DidCommHttpOutboundTransport()

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
          refreshAttestationMonitor(restartedAgent)
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

      // In case the old attestationMonitor is still active, stop it and start a new one
      logger.info('Starting attestation monitor...')
      refreshAttestationMonitor(newAgent)

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
      refreshAttestationMonitor,
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

  return { agent, initializeAgent, shutdownAndClearAgentIfExists }
}

export default useBCAgentSetup
