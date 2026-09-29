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
    //
    // KNOWN, UNRESOLVED BUG (as of the vsc-migration diagnosis, 2026-09-29): this
    // test currently fails with `jsonld.SyntaxError: Invalid JSON-LD syntax; tried
    // to redefine a protected term`, thrown from
    // DifPresentationExchangeService -> W3cCredentialService.signPresentation.
    // Root cause: credo's own DIF-Presentation-Exchange path builds its
    // outgoing VP via W3cCredentialService.createPresentation(), which
    // hardcodes `@context: [CREDENTIALS_CONTEXT_V1_URL]` — a VC1.1 (v1) VP
    // wrapping this VRC's VC2.0 (v2) `@context` triggers the exact "v1 VP
    // around a v2 VC" JSON-LD conflict that diConformance.test.ts documents
    // and that G14/G22 already fixed for the hand-rolled witnessed-exchange
    // VP path (see docs/plans/vsc-migration-plan/2026-09-29-bm.md). That fix
    // does not reach this path because the VP here is built internally by
    // credo's DIF-PE library, not by this migration's own code. Not patched
    // mechanically — needs a real design decision (e.g. whether VC2.0 VRCs
    // should ever flow through the generic present-proof/DIF-PE protocol at
    // all, vs. only the hand-built witnessed-exchange VP path).
    it('should complete full proof exchange workflow', async () => {
      // Bob requests proof
      await bob.sendProofRequest()

      // Wait for Alice to receive proof request
      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      // Get proof request
      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      expect(proofRequest).toBeDefined()

      // Alice accepts and responds to proof request
      await alice.acceptProofRequest(proofRequest!)

      // Wait for Bob to receive the presentation
      await waitForCondition(async () => {
        const records = await bob.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'presentation-received')
      }, 10000)

      // Bob accepts/verifies the presentation (required because autoAcceptProofs is Never)
      const bobProofRecords = await bob.agent.modules.didcomm.proofs.getAll()
      const receivedPresentation = bobProofRecords.find((r) => r.state === 'presentation-received')
      expect(receivedPresentation).toBeDefined()
      await bob.agent.modules.didcomm.proofs.acceptPresentation({ proofExchangeRecordId: receivedPresentation!.id })

      // Wait for proof exchange to complete (state='done' on Alice's side)
      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'done')
      }, 10000)

      // Verify proof exchange completed
      const completedProofs = await alice.agent.modules.didcomm.proofs.getAll()
      const completedProof = completedProofs.find((r) => r.state === 'done')
      expect(completedProof).toBeDefined()
    }, 45000)

    it('should use DIF Presentation Exchange format', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')

      // Verify presentation exchange format is used
      expect(proofRequest).toBeDefined()
      expect(proofRequest?.protocolVersion).toBe('v2')
    }, 45000)

    it('should select appropriate credentials for proof', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')

      // Select credentials
      const selectedCredentials = await alice.agent.modules.didcomm.proofs.selectCredentialsForRequest({
        proofExchangeRecordId: proofRequest!.id,
      })

      expect(selectedCredentials).toBeDefined()
      expect(selectedCredentials.proofFormats).toBeDefined()
    }, 45000)

    // FIXED: Same fix as above - using did:peer:0 with manual authentication patching
    //
    // KNOWN, UNRESOLVED BUG: same "v1 VP wraps v2 VC" JSON-LD conflict as
    // 'should complete full proof exchange workflow' above (see that test's
    // comment for the full root-cause explanation) — this test exercises the
    // same alice.acceptProofRequest() -> DIF-PE signPresentation path.
    it('should include RelationshipCredential in proof response', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      await alice.acceptProofRequest(proofRequest!)

      // Wait for Bob to receive the presentation
      await waitForCondition(async () => {
        const records = await bob.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'presentation-received')
      }, 10000)

      // Bob accepts/verifies the presentation (required because autoAcceptProofs is Never)
      const bobProofRecords = await bob.agent.modules.didcomm.proofs.getAll()
      const receivedPresentation = bobProofRecords.find((r) => r.state === 'presentation-received')
      expect(receivedPresentation).toBeDefined()
      await bob.agent.modules.didcomm.proofs.acceptPresentation({ proofExchangeRecordId: receivedPresentation!.id })

      // Wait for proof exchange to complete
      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'done')
      }, 10000)

      // Verify proof was sent successfully
      const completedProofs = await alice.agent.modules.didcomm.proofs.getAll()
      const completedProof = completedProofs.find((r) => r.state === 'done')
      expect(completedProof).toBeDefined()
    }, 45000)
  })

  describe('Proof Request Definition', () => {
    it('should filter for RelationshipCredential type', async () => {
      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      expect(proofRequest).toBeDefined()

      // Get the format data to verify presentation definition
      const formatData = await alice.agent.modules.didcomm.proofs.getFormatData(proofRequest!.id)
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
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')
      expect(proofRequest).toBeDefined()

      // Get the format data to verify presentation definition
      const formatData = await alice.agent.modules.didcomm.proofs.getFormatData(proofRequest!.id)
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
      const allCredentials = await alice.agent.w3cCredentials.getAll()
      for (const cred of allCredentials) {
        // removeCredentialRecord is an internal W3cCredentialService method,
        // not on the public W3cCredentialsApi; the public method is deleteById.
        await alice.agent.w3cCredentials.deleteById(cred.id)
      }

      await bob.sendProofRequest()

      await waitForCondition(async () => {
        const records = await alice.agent.modules.didcomm.proofs.getAll()
        return records.some((r) => r.state === 'request-received')
      }, 8000)

      const proofRecords = await alice.agent.modules.didcomm.proofs.getAll()
      const proofRequest = proofRecords.find((r) => r.state === 'request-received')

      // Try to select credentials - should throw an error when no credentials match
      await expect(
        alice.agent.modules.didcomm.proofs.selectCredentialsForRequest({
          proofExchangeRecordId: proofRequest!.id,
        })
      ).rejects.toThrow()

      // Verify proof request was received
      expect(proofRequest).toBeDefined()
    }, 45000)
  })
})
