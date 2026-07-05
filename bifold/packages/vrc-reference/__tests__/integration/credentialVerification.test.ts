import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { setupConnectedAgents, issueAndReceiveCredential } from '../fixtures/connectionSetup'
import { cleanupAgents } from '../helpers/testUtils'

describe('Credential Verification Integration', () => {
  let alice: Alice
  let bob: Bob

  beforeEach(async () => {
    const agents = await setupConnectedAgents()
    alice = agents.alice
    bob = agents.bob

    // Issue a credential for verification tests
    await issueAndReceiveCredential(alice, bob)
  }, 60000)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 15000)

  describe('Cryptographic Verification', () => {
    // Helper to get the most recently created credential (not stale ones from previous runs)
    const getNewestCredential = async (agent: typeof alice.agent) => {
      const records = await agent.w3cCredentials.getAllCredentialRecords()
      const sorted = records
        .filter((r) => r.credential !== null)
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      return sorted[0]
    }

    it('should cryptographically verify the issued credential', async () => {
      const storedCredential = await getNewestCredential(alice.agent)

      // Explicitly verify the credential signature
      const verificationResult = await alice.agent.w3cCredentials.verifyCredential({
        credential: storedCredential!.credential as any,
      })

      // Log verification result for debugging
      if (!verificationResult.isValid) {
        console.log('Verification failed:', JSON.stringify(verificationResult, null, 2))
      }

      expect(verificationResult.isValid).toBe(true)
      expect(verificationResult.error).toBeUndefined()
    }, 45000)

    it('should verify credential using Bob agent (issuer verification)', async () => {
      const storedCredential = await getNewestCredential(alice.agent)

      // Bob (issuer) should also be able to verify the credential
      const verificationResult = await bob.agent.w3cCredentials.verifyCredential({
        credential: storedCredential!.credential as any,
      })

      expect(verificationResult.isValid).toBe(true)
    }, 45000)

    it('should detect tampered credential (modified subject)', async () => {
      const storedCredential = await getNewestCredential(alice.agent)

      // First verify the original is valid
      const originalVerification = await alice.agent.w3cCredentials.verifyCredential({
        credential: storedCredential!.credential as any,
      })
      expect(originalVerification.isValid).toBe(true)

      // Create a deep copy of the credential and tamper with the subject
      const { JsonTransformer, W3cJsonLdVerifiableCredential } = await import('@credo-ts/core')
      const credentialJson = JsonTransformer.toJSON(storedCredential!.credential)
      const tamperedJson = JSON.parse(JSON.stringify(credentialJson))

      // Modify the subject ID to simulate tampering
      if (tamperedJson.credentialSubject) {
        tamperedJson.credentialSubject.id = 'did:peer:tampered-subject-id'
      } else if (tamperedJson.credentialSubjects?.[0]) {
        tamperedJson.credentialSubjects[0].id = 'did:peer:tampered-subject-id'
      }

      // Convert back to W3cJsonLdVerifiableCredential instance (required by verifyCredential API)
      const tamperedCredential = JsonTransformer.fromJSON(tamperedJson, W3cJsonLdVerifiableCredential)

      // Verify tampered credential fails verification
      const tamperedVerification = await alice.agent.w3cCredentials.verifyCredential({
        credential: tamperedCredential,
      })
      expect(tamperedVerification.isValid).toBe(false)
    }, 45000)

    it('should detect tampered credential (modified issuance date)', async () => {
      const storedCredential = await getNewestCredential(alice.agent)

      // Verify the credential is valid when unmodified
      const originalVerification = await alice.agent.w3cCredentials.verifyCredential({
        credential: storedCredential!.credential as any,
      })
      expect(originalVerification.isValid).toBe(true)

      // Create a deep copy of the credential and tamper with the issuance date
      const { JsonTransformer, W3cJsonLdVerifiableCredential } = await import('@credo-ts/core')
      const credentialJson = JsonTransformer.toJSON(storedCredential!.credential)
      const tamperedJson = JSON.parse(JSON.stringify(credentialJson))

      // Modify the issuance date to simulate tampering
      tamperedJson.issuanceDate = '2020-01-01T00:00:00Z'

      // Convert back to W3cJsonLdVerifiableCredential instance (required by verifyCredential API)
      const tamperedCredential = JsonTransformer.fromJSON(tamperedJson, W3cJsonLdVerifiableCredential)

      // Verify tampered credential fails verification
      const tamperedVerification = await alice.agent.w3cCredentials.verifyCredential({
        credential: tamperedCredential,
      })
      expect(tamperedVerification.isValid).toBe(false)
    }, 45000)

    it('should verify credential has valid proof signature', async () => {
      const storedCredential = await getNewestCredential(alice.agent)
      const credential = storedCredential?.credential as any

      // Get proof and issuer - handle both plain object and W3cCredential structure
      const proof = credential.proof || credential.proofs?.[0]
      const issuer = credential.issuer || credential.issuerId

      // Verify the proof is properly linked to the issuer's verification method
      if (issuer && proof?.verificationMethod) {
        expect(proof.verificationMethod).toMatch(new RegExp(`^${issuer}#`))
      }

      // Verify the credential cryptographically
      const verificationResult = await alice.agent.w3cCredentials.verifyCredential({
        credential: storedCredential!.credential as any,
      })

      expect(verificationResult.isValid).toBe(true)

      // The proof should resolve to a valid verification method
      if (proof?.proofValue) {
        expect(proof.proofValue).toMatch(/^[A-Za-z0-9+/]+=*$/) // Base64 pattern
      }
    }, 45000)
  })
})
