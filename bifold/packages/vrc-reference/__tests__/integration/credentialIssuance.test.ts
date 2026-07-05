import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { setupConnectedAgents } from '../fixtures/connectionSetup'
import { cleanupAgents, waitForCondition } from '../helpers/testUtils'

describe('Credential Issuance Integration', () => {
  let alice: Alice
  let bob: Bob

  beforeEach(async () => {
    const agents = await setupConnectedAgents()
    alice = agents.alice
    bob = agents.bob
  }, 30000)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 15000)

  describe('Issuance Flow', () => {
    it('should complete full credential issuance workflow', async () => {
      // Bob offers credential
      await bob.issueCredential()

      // Wait for Alice to receive offer
      await waitForCondition(async () => {
        const records = await alice.agent.credentials.getAll()
        return records.some((r) => r.state === 'offer-received')
      }, 8000)

      // Get credential offer
      const credentialRecords = await alice.agent.credentials.getAll()
      const offerRecord = credentialRecords.find((r) => r.state === 'offer-received')
      expect(offerRecord).toBeDefined()

      // Alice accepts offer
      await alice.acceptCredentialOffer(offerRecord!)

      // Wait for credential to be issued and stored
      // This can take longer due to cryptographic signing and storage operations
      await waitForCondition(async () => {
        const records = await alice.agent.w3cCredentials.getAllCredentialRecords()
        return records.some((r) => r.credential !== null)
      }, 15000)

      // Verify credential is stored
      const storedCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      const storedCredential = storedCredentials.find((r) => r.credential !== null)

      expect(storedCredential).toBeDefined()
      expect(storedCredential?.credential).toBeDefined()
    }, 30000)
  })

  describe('Error Handling', () => {
    it('should handle credential offer rejection gracefully', async () => {
      await bob.issueCredential()

      await waitForCondition(async () => {
        const records = await alice.agent.credentials.getAll()
        return records.some((r) => r.state === 'offer-received')
      }, 8000)

      // Get the offer record
      const credentialRecords = await alice.agent.credentials.getAll()
      const offerRecord = credentialRecords.find((r) => r.state === 'offer-received')
      expect(offerRecord).toBeDefined()

      // Alice declines the credential offer
      await alice.agent.credentials.declineOffer(offerRecord!.id)

      // Verify the offer was declined (state should change to 'abandoned' or record deleted)
      const updatedRecords = await alice.agent.credentials.getAll()
      const declinedRecord = updatedRecords.find((r) => r.id === offerRecord!.id)

      // After declining, the record should either be declined or not exist
      if (declinedRecord) {
        expect(declinedRecord.state).toBe('declined')
      } else {
        // Record was deleted after decline, which is also valid
        expect(declinedRecord).toBeUndefined()
      }

      // Verify no W3C credential was stored
      const storedCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      const credentialFromThisOffer = storedCredentials.find(
        (c) => c.createdAt && c.createdAt >= offerRecord!.createdAt
      )
      expect(credentialFromThisOffer).toBeUndefined()
    }, 30000)
  })
})
