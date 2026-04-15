import {
  Agent,
  ConnectionRecord,
  CredentialExchangeRecord,
  CredentialState,
  ProofExchangeRecord,
  W3cCredentialRecord,
  utils,
} from '@credo-ts/core'
import type { Alice } from '../../src/Alice'
import type { Bob } from '../../src/Bob'
import type { Witness } from '../../src/Witness'
import { AgentType, getPortForAgent, generateUniqueAgentId, getPortAllocationInfo } from './portManager'

/**
 * Get mediator invitation URL from environment
 * Returns undefined if not configured
 */
export function getMediatorUrl(): string | undefined {
  return process.env.MEDIATOR_INVITATION_URL
}

/**
 * Check if mediator is configured for testing
 */
export function isMediatorConfigured(): boolean {
  return !!getMediatorUrl()
}

/**
 * Generate a unique wallet ID for testing
 * @deprecated Use generateUniqueAgentId from portManager instead
 */
export function generateWalletId(): string {
  return `test-wallet-${Date.now()}-${Math.random().toString(36).substring(7)}`
}

/**
 * Build an Alice agent with worker-aware port allocation
 * This ensures no port conflicts when running tests in parallel
 *
 * @param instanceIndex - Optional instance number (default: 0) for multiple Alice agents in same test
 * @param suffix - Optional suffix to add to agent name for extra uniqueness
 * @returns Initialized Alice agent
 */
export async function buildAlice(instanceIndex: number = 0, suffix?: string): Promise<Alice> {
  const { Alice } = await import('../../src/Alice')
  const port = getPortForAgent(AgentType.ALICE, instanceIndex)
  const agentId = generateUniqueAgentId('alice', suffix)

  const info = getPortAllocationInfo()
  console.log(
    `[Worker ${info.workerId}] Building Alice on port ${port} (range: ${info.aliceRange}) with ID: ${agentId}`
  )

  return await Alice.build(port, agentId)
}

/**
 * Build a Bob agent with worker-aware port allocation
 * This ensures no port conflicts when running tests in parallel
 *
 * @param instanceIndex - Optional instance number (default: 0) for multiple Bob agents in same test
 * @param suffix - Optional suffix to add to agent name for extra uniqueness
 * @returns Initialized Bob agent
 */
export async function buildBob(instanceIndex: number = 0, suffix?: string): Promise<Bob> {
  const { Bob } = await import('../../src/Bob')
  const port = getPortForAgent(AgentType.BOB, instanceIndex)
  const agentId = generateUniqueAgentId('bob', suffix)

  const info = getPortAllocationInfo()
  console.log(`[Worker ${info.workerId}] Building Bob on port ${port} (range: ${info.bobRange}) with ID: ${agentId}`)

  return await Bob.build(port, agentId)
}

/**
 * Build a Witness agent with worker-aware port allocation
 * This ensures no port conflicts when running tests in parallel
 *
 * @param instanceIndex - Optional instance number (default: 0) for multiple Witness agents in same test
 * @param suffix - Optional suffix to add to agent name for extra uniqueness
 * @returns Initialized Witness agent
 */
export async function buildWitness(instanceIndex: number = 0, suffix?: string): Promise<Witness> {
  const { Witness } = await import('../../src/Witness')
  const port = getPortForAgent(AgentType.WITNESS, instanceIndex)
  const agentId = generateUniqueAgentId('witness', suffix)

  const info = getPortAllocationInfo()
  console.log(
    `[Worker ${info.workerId}] Building Witness on port ${port} (range: ${info.witnessRange}) with ID: ${agentId}`
  )

  return await Witness.build(port, agentId)
}

/**
 * Build an Alice agent with mediated transport
 * Uses the mediator URL from MEDIATOR_INVITATION_URL environment variable
 *
 * @param instanceIndex - Optional instance number (default: 0) for multiple Alice agents in same test
 * @param suffix - Optional suffix to add to agent name for extra uniqueness
 * @returns Initialized Alice agent with mediated transport
 */
export async function buildMediatedAlice(instanceIndex: number = 0, suffix?: string): Promise<Alice> {
  const { Alice } = await import('../../src/Alice')
  const port = getPortForAgent(AgentType.ALICE, instanceIndex)
  const agentId = generateUniqueAgentId('alice-mediated', suffix)
  const mediatorUrl = getMediatorUrl()

  if (!mediatorUrl) {
    throw new Error('MEDIATOR_INVITATION_URL not configured. Cannot build mediated agent.')
  }

  const info = getPortAllocationInfo()
  console.log(
    `[Worker ${info.workerId}] Building MEDIATED Alice on port ${port} (range: ${info.aliceRange}) with ID: ${agentId}`
  )

  return await Alice.build(port, agentId, mediatorUrl)
}

/**
 * Build a Bob agent with mediated transport
 * Uses the mediator URL from MEDIATOR_INVITATION_URL environment variable
 *
 * @param instanceIndex - Optional instance number (default: 0) for multiple Bob agents in same test
 * @param suffix - Optional suffix to add to agent name for extra uniqueness
 * @returns Initialized Bob agent with mediated transport
 */
export async function buildMediatedBob(instanceIndex: number = 0, suffix?: string): Promise<Bob> {
  const { Bob } = await import('../../src/Bob')
  const port = getPortForAgent(AgentType.BOB, instanceIndex)
  const agentId = generateUniqueAgentId('bob-mediated', suffix)
  const mediatorUrl = getMediatorUrl()

  if (!mediatorUrl) {
    throw new Error('MEDIATOR_INVITATION_URL not configured. Cannot build mediated agent.')
  }

  const info = getPortAllocationInfo()
  console.log(
    `[Worker ${info.workerId}] Building MEDIATED Bob on port ${port} (range: ${info.bobRange}) with ID: ${agentId}`
  )

  return await Bob.build(port, agentId, mediatorUrl)
}

/**
 * Generate a test DID
 */
export function generateTestDid(prefix = 'did:peer:0'): string {
  return `${prefix}:z${utils.uuid().replace(/-/g, '')}`
}

/**
 * Create a mock connection record
 */
export function createMockConnectionRecord(overrides?: Partial<ConnectionRecord>): ConnectionRecord {
  return {
    id: utils.uuid(),
    createdAt: new Date(),
    did: generateTestDid('did:peer:4'),
    theirDid: generateTestDid('did:peer:4'),
    state: 'completed' as any,
    role: 'responder' as any,
    outOfBandId: utils.uuid(),
    metadata: {
      get: jest.fn(),
      set: jest.fn(),
    },
    ...overrides,
  } as unknown as ConnectionRecord
}

/**
 * Create a mock credential exchange record
 */
export function createMockCredentialExchangeRecord(
  overrides?: Partial<CredentialExchangeRecord>
): CredentialExchangeRecord {
  return {
    id: utils.uuid(),
    createdAt: new Date(),
    state: CredentialState.OfferReceived,
    role: 'holder' as any,
    connectionId: utils.uuid(),
    threadId: utils.uuid(),
    protocolVersion: 'v2',
    credentials: [],
    ...overrides,
  } as unknown as CredentialExchangeRecord
}

/**
 * Create a mock W3C credential record
 */
export function createMockW3cCredentialRecord(overrides?: Partial<W3cCredentialRecord>): W3cCredentialRecord {
  const issuerDid = generateTestDid()
  const subjectDid = generateTestDid()

  return {
    id: utils.uuid(),
    createdAt: new Date(),
    credential: {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://credojs.org/relationship/v1'],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: subjectDid,
      },
      proof: {
        type: 'Ed25519Signature2018',
        created: new Date().toISOString(),
        verificationMethod: `${issuerDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: 'mock-signature',
      },
    },
    ...overrides,
  } as unknown as W3cCredentialRecord
}

/**
 * Create a mock proof exchange record
 */
export function createMockProofExchangeRecord(overrides?: Partial<ProofExchangeRecord>): ProofExchangeRecord {
  return {
    id: utils.uuid(),
    createdAt: new Date(),
    state: 'request-received' as any,
    role: 'prover' as any,
    connectionId: utils.uuid(),
    threadId: utils.uuid(),
    protocolVersion: 'v2',
    ...overrides,
  } as unknown as ProofExchangeRecord
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  checkInterval = 100
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval))
  }
  throw new Error('Condition not met within timeout')
}

/**
 * Create a test relationship credential
 */
export function createTestRelationshipCredential(issuerDid: string, subjectDid: string) {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://credojs.org/relationship/v1'],
    type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
    issuer: issuerDid,
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: subjectDid,
    },
  }
}

/**
 * Cleanup agent instance
 */
export async function cleanupAgent(agent: Alice | Bob | Witness | Agent<any>): Promise<void> {
  try {
    if (agent && 'shutdown' in agent) {
      // Add timeout to prevent hanging shutdowns
      await Promise.race([
        agent.shutdown(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), 10000))
      ])
    }
  } catch (error) {
    // Ignore cleanup errors but log them for debugging
    console.error('Error during agent cleanup:', error)
  }
}

/**
 * Cleanup multiple agents
 */
export async function cleanupAgents(...agents: (Alice | Bob | Witness | Agent<any> | undefined)[]): Promise<void> {
  // Shut down agents sequentially to avoid port conflicts
  for (const agent of agents.filter(Boolean)) {
    await cleanupAgent(agent!)
  }

  // Give more time for HTTP servers to fully close and ports to be released
  // This is critical for preventing "address already in use" errors in subsequent tests
  // Increased to 1000ms for parallel execution reliability
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
