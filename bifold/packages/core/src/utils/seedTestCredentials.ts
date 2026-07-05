import { Agent, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'
import { TEST_CONTACTS, createDTGCredential, generateTestDid } from '../modules/vrc/fixtures/testContacts'

/**
 * Seed test relationship credentials into the wallet for QA testing
 * Creates credentials from preset test contacts (Alice, Bob, Charlie, Diana, Faber, BestBC)
 *
 * @param agent - The Credo agent instance
 * @returns The number of credentials seeded
 */
export async function seedTestContacts(agent: Agent): Promise<number> {
  if (!agent) {
    throw new Error('Agent not initialized')
  }

  // Generate a holder DID for this wallet
  const holderDid = generateTestDid('holder')

  // Get all preset test contacts
  const contacts = [
    TEST_CONTACTS.alice,
    TEST_CONTACTS.bob,
    TEST_CONTACTS.charlie,
    TEST_CONTACTS.diana,
    TEST_CONTACTS.faber,
    TEST_CONTACTS.bestbc,
  ]

  // Create credentials with staggered dates for realistic testing
  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() - 30) // Start 30 days ago

  const credentials: W3cCredentialRecord[] = []

  for (let i = 0; i < contacts.length; i++) {
    const date = new Date(baseDate)
    date.setDate(date.getDate() + i * 5) // 5 days apart

    const credential = createDTGCredential({
      issuer: contacts[i].issuer,
      credentialSubject: { id: holderDid },
      validFrom: date.toISOString(),
    })

    // Tag as test data for easy identification and cleanup
    credential.setTag('isTestData', true)

    credentials.push(credential)
  }

  // Save credentials to the wallet
  const w3cCredentialRepository = agent.dependencyManager.resolve(W3cCredentialRepository)

  for (const credential of credentials) {
    await w3cCredentialRepository.save(agent.context, credential)
  }

  agent.config.logger.info(`[Test Data] Seeded ${credentials.length} test contacts`)

  return credentials.length
}

/**
 * Clear all test relationship credentials from the wallet
 * Only removes credentials tagged with isTestData=true
 *
 * @param agent - The Credo agent instance
 * @returns The number of credentials removed
 */
export async function clearTestContacts(agent: Agent): Promise<number> {
  if (!agent) {
    throw new Error('Agent not initialized')
  }

  const w3cCredentialRepository = agent.dependencyManager.resolve(W3cCredentialRepository)

  // Find all credentials tagged as test data
  const testCredentials = await w3cCredentialRepository.findByQuery(agent.context, {
    isTestData: true,
  })

  // Remove each test credential
  for (const credential of testCredentials) {
    await w3cCredentialRepository.delete(agent.context, credential)
  }

  agent.config.logger.info(`[Test Data] Cleared ${testCredentials.length} test contacts`)

  return testCredentials.length
}
