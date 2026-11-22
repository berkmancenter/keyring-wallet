import { Agent, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'
import {
  TEST_CONTACTS,
  createDTGCredential,
  createRCardCredential,
  generateTestDid,
} from '../modules/vrc/fixtures/testContacts'

/**
 * Seed test relationship credentials into the wallet for QA testing
 * Creates credentials from preset test contacts (Alice, Bob, Charlie, Diana, Faber, BestBC)
 *
 * Each contact gets TWO credentials, the same pair a real exchange leaves
 * behind: the DTG relationship credential, which is what lists them in
 * Contacts, and a received RelationshipCard, which is what carries their
 * name, organisation and photo. Seeding only the first leaves every contact
 * resolving through `resolveContactDisplayInfo`'s legacy branch, which has no
 * photo — so the contact card renders its placeholder and a card design can't
 * be judged.
 *
 * @param agent - The Credo agent instance
 * @returns The number of contacts seeded
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

    const params = {
      issuer: contacts[i].issuer,
      credentialSubject: { id: holderDid },
      validFrom: date.toISOString(),
    }

    for (const credential of [createDTGCredential(params), createRCardCredential(params)]) {
      // Tag as test data for easy identification and cleanup
      credential.setTags({ isTestData: true })
      credentials.push(credential)
    }
  }

  // Save credentials to the wallet
  const w3cCredentialRepository = agent.dependencyManager.resolve(W3cCredentialRepository)

  for (const credential of credentials) {
    await w3cCredentialRepository.save(agent.context, credential)
  }

  agent.config.logger.info(`[Test Data] Seeded ${contacts.length} test contacts (${credentials.length} credentials)`)

  return contacts.length
}

/**
 * Clear all test relationship credentials from the wallet
 * Only removes credentials tagged with isTestData=true
 *
 * Each seeded contact owns two of these (its DTG credential and its
 * RelationshipCard), so the count returned is credentials, not contacts.
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
