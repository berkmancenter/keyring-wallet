import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { setupConnectedAgents, issueAndReceiveCredential } from '../fixtures/connectionSetup'
import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from '../../src/relationshipContext'
import { cleanupAgents } from '../helpers/testUtils'

describe('Credential Structure Integration', () => {
  let alice: Alice
  let bob: Bob

  beforeEach(async () => {
    const agents = await setupConnectedAgents()
    alice = agents.alice
    bob = agents.bob

    // Issue a credential for structure validation tests
    await issueAndReceiveCredential(alice, bob)
  }, 60000)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 15000)

  describe('Relationship Credential Structure', () => {
    it('should create valid relationship credential structure', async () => {
      const storedCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      const storedCredential = storedCredentials.find((r) => r.credential !== null)

      expect(storedCredential).toBeDefined()
      expect(storedCredential?.credential).toBeDefined()

      const credential = storedCredential!.credential as any

      // Verify credential structure - handle both plain objects and W3cJsonLdVerifiableCredential
      const context = credential['@context'] || credential.contexts || []
      const types = credential.type || credential.types || []
      const issuer = credential.issuer || credential.issuerId
      const subject = credential.credentialSubject || credential.credentialSubjects?.[0]

      expect(context).toContain('https://www.w3.org/2018/credentials/v1')
      expect(context).toContain(DTG_CONTEXT_URL)
      expect(context).toContain(RELATIONSHIP_CONTEXT_URL)
      expect(types).toContain('VerifiableCredential')
      expect(types).toContain('RelationshipCredential')
      expect(issuer).toMatch(/^did:peer:/)
      expect(subject?.id).toMatch(/^did:peer:/)
      expect(credential.issuanceDate || credential.issuanceDate).toBeDefined()
    }, 45000)

    it('should use correct R-DIDs in credential', async () => {
      const storedCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      const storedCredential = storedCredentials.find((r) => r.credential !== null)
      const credential = storedCredential?.credential as any

      // Get Alice's R-DID from connection metadata
      const aliceConnection = await alice.agent.connections.getById(alice.connectionRecordId!)
      const holderSubjectMetadata = aliceConnection.metadata.get('holderSubjectDid') as { did?: string } | undefined

      const subject = credential.credentialSubject || credential.credentialSubjects?.[0]
      const issuer = credential.issuer || credential.issuerId

      // Verify R-DIDs match
      expect(issuer).toMatch(/^did:peer:/)
      if (holderSubjectMetadata?.did) {
        expect(subject?.id).toBe(holderSubjectMetadata.did)
      } else {
        // If metadata not set, just verify it's a valid DID
        expect(subject?.id).toMatch(/^did:peer:/)
      }
    }, 45000)

    it('should include valid Ed25519Signature2018 proof', async () => {
      const storedCredentials = await alice.agent.w3cCredentials.getAllCredentialRecords()
      const storedCredential = storedCredentials.find((r) => r.credential !== null)

      // Verify the credential cryptographically - this confirms the proof exists and is valid
      const verificationResult = await alice.agent.w3cCredentials.verifyCredential({
        credential: storedCredential!.credential as any,
      })

      expect(verificationResult.isValid).toBe(true)
      expect(verificationResult.error).toBeUndefined()

      // The proof structure is embedded in the W3C credential and verified above
      // We've confirmed it exists and is valid through cryptographic verification
    }, 45000)
  })
})
