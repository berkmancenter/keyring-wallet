import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { setupConnectedAgents, issueAndReceiveCredential } from '../fixtures/connectionSetup'
import { cleanupAgents } from '../helpers/testUtils'

describe('Credential Storage Integration', () => {
  let alice: Alice
  let bob: Bob

  beforeEach(async () => {
    const agents = await setupConnectedAgents()
    alice = agents.alice
    bob = agents.bob

    // Issue a credential for storage tests
    await issueAndReceiveCredential(alice, bob)
  }, 60000)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 15000)

  describe('Storage and Retrieval', () => {
    it('should store and list credentials', async () => {
      // List stored credentials (should not throw)
      await alice.listStoredCredentials()

      const storedCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      expect(storedCredentials.length).toBeGreaterThan(0)
    }, 45000)
  })
})
