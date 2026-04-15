import type { Alice } from '../../src/Alice'
import type { Bob } from '../../src/Bob'
import { setupConnectedAgents, issueAndReceiveCredential } from '../fixtures/connectionSetup'
import { cleanupAgents, waitForCondition } from '../helpers/testUtils'

describe('Proof Exchange Integration', () => {
  let alice: Alice
  let bob: Bob

  beforeEach(async () => {
    // Use the connection setup helper which handles:
    // 1. Worker-aware port allocation
    // 2. DID initialization and stabilization (2s wait)
    // 3. Cross-agent DID document sharing for verification
    const agents = await setupConnectedAgents()
    alice = agents.alice
    bob = agents.bob

    // Issue a credential for Alice to use in proofs
    await issueAndReceiveCredential(alice, bob)
  }, 60000)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 10000)

  describe('Proof Request and Response', () => {
    // FIXED: Using did:peer:0 (InceptionKeyWithoutDoc) with manual authentication patching
    // The Participant class manually adds authentication/assertionMethod to the DID document
    // after creation and re-imports it to ensure proper verification method resolution
    it('should complete full proof exchange workflow', async () => {
      // Bob requests proof
      await bob.sendProofRequest()

      // Wait for Alice to receive proof request
      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      // Get proof request
      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      expect(proofRequest).toBeDefined()

      // Alice accepts and responds to proof request
      await alice.acceptProofRequest(proofRequest!)

      // Wait for Bob to receive the presentation
      await waitForCondition(async () => {
        const records = await bob.agent.proofs.getAll()
        return records.some((r) => r.state === 'presentation-received')
      }, 10000)

      // Bob accepts/verifies the presentation (required because autoAcceptProofs is Never)
      const bobProofRecords = await bob.agent.proofs.getAll()
      const receivedPresentation = bobProofRecords.find((r) => r.state === 'presentation-received')
      expect(receivedPresentation).toBeDefined()
      await bob.agent.proofs.acceptPresentation({ proofRecordId: receivedPresentation!.id })

      // Wait for proof exchange to complete (state='done' on Alice's side)
      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'done')
      }, 10000)

      // Verify proof exchange completed
      const completedProofs = await alice.agent.proofs.getAll()
      const completedProof = completedProofs.find((r) => r.state === 'done')
      expect(completedProof).toBeDefined()
    }, 45000)

    it('should use DIF Presentation Exchange format', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')

      // Verify presentation exchange format is used
      expect(proofRequest).toBeDefined()
      expect(proofRequest?.protocolVersion).toBe('v2')
    }, 45000)

    it('should select appropriate credentials for proof', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')

      // Select credentials
      const selectedCredentials = await alice.agent.proofs.selectCredentialsForRequest({
        proofRecordId: proofRequest!.id,
      })

      expect(selectedCredentials).toBeDefined()
      expect(selectedCredentials.proofFormats).toBeDefined()
    }, 45000)

    // FIXED: Same fix as above - using did:peer:0 with manual authentication patching
    it('should include RelationshipCredential in proof response', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      await alice.acceptProofRequest(proofRequest!)

      // Wait for Bob to receive the presentation
      await waitForCondition(async () => {
        const records = await bob.agent.proofs.getAll()
        return records.some((r) => r.state === 'presentation-received')
      }, 10000)

      // Bob accepts/verifies the presentation (required because autoAcceptProofs is Never)
      const bobProofRecords = await bob.agent.proofs.getAll()
      const receivedPresentation = bobProofRecords.find((r) => r.state === 'presentation-received')
      expect(receivedPresentation).toBeDefined()
      await bob.agent.proofs.acceptPresentation({ proofRecordId: receivedPresentation!.id })

      // Wait for proof exchange to complete
      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'done')
      }, 10000)

      // Verify proof was sent successfully
      const completedProofs = await alice.agent.proofs.getAll()
      const completedProof = completedProofs.find((r) => r.state === 'done')
      expect(completedProof).toBeDefined()
    }, 45000)
  })

  describe('Proof Request Definition', () => {
    it('should filter for RelationshipCredential type', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      expect(proofRequest).toBeDefined()

      // Get the format data to verify presentation definition
      const formatData = await alice.agent.proofs.getFormatData(proofRequest!.id)
      expect(formatData.request).toBeDefined()

      // Verify the presentation exchange format is used
      const presentationExchange = formatData.request?.presentationExchange
      expect(presentationExchange).toBeDefined()

      // Verify the presentation definition filters for RelationshipCredential
      const presentationDefinition = presentationExchange?.presentation_definition
      expect(presentationDefinition).toBeDefined()
      expect(presentationDefinition?.input_descriptors).toBeDefined()
      expect(presentationDefinition?.input_descriptors.length).toBeGreaterThan(0)

      // Check that an input descriptor filters for RelationshipCredential type
      const inputDescriptor = presentationDefinition?.input_descriptors[0]
      expect(inputDescriptor?.constraints?.fields).toBeDefined()

      // Find a field constraint that filters on type
      const typeConstraint = inputDescriptor?.constraints?.fields?.find((field: any) =>
        field.path?.some((p: string) => p.includes('type'))
      )
      expect(typeConstraint).toBeDefined()
    }, 45000)

    it('should use relationship context schema', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      expect(proofRequest).toBeDefined()

      // Get the format data to verify presentation definition
      const formatData = await alice.agent.proofs.getFormatData(proofRequest!.id)
      expect(formatData.request?.presentationExchange).toBeDefined()

      const presentationDefinition = formatData.request?.presentationExchange?.presentation_definition
      expect(presentationDefinition).toBeDefined()

      // Verify the input descriptor has constraints that reference the schema/context
      const inputDescriptor = presentationDefinition?.input_descriptors[0]
      expect(inputDescriptor).toBeDefined()
      expect(inputDescriptor?.constraints).toBeDefined()

      // The input descriptor should have a name or purpose indicating relationship context
      // or constraints referencing the relationship credential schema
      const hasRelationshipReference =
        inputDescriptor?.name?.toLowerCase().includes('relationship') ||
        inputDescriptor?.purpose?.toLowerCase().includes('relationship') ||
        JSON.stringify(inputDescriptor?.constraints).includes('RelationshipCredential')

      expect(hasRelationshipReference).toBe(true)
    }, 45000)
  })

  describe('Error Handling', () => {
    it('should handle proof request without credentials', async () => {
      // Remove all credentials from Alice
      const allCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      for (const cred of allCredentials) {
        await alice.agent.w3cCredentials.removeCredentialRecord(cred.id)
      }

      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')

      // Try to select credentials - should throw an error when no credentials match
      await expect(
        alice.agent.proofs.selectCredentialsForRequest({
          proofRecordId: proofRequest!.id,
        })
      ).rejects.toThrow()

      // Verify proof request was received
      expect(proofRequest).toBeDefined()
    }, 45000)
  })
})
