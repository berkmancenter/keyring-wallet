import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { buildMediatedAlice, buildMediatedBob, cleanupAgents, isMediatorConfigured, getMediatorUrl } from '../helpers/testUtils'

/**
 * Mediated Connection Flow Integration Tests
 * 
 * These tests verify that agents can establish connections through a mediator.
 * The tests are designed to reproduce and diagnose the WebSocket/DIDComm issues
 * documented in MEDIATOR_WEBSOCKET_ISSUE.md
 * 
 * Requirements:
 * - MEDIATOR_INVITATION_URL must be set in environment
 * - Tests use 30-second timeouts to distinguish "slow" from "broken"
 */

// Skip entire suite if mediator is not configured
const describeIfMediator = isMediatorConfigured() ? describe : describe.skip

describeIfMediator('Mediated Connection Flow Integration', () => {
  let alice: Alice
  let bob: Bob

  beforeAll(() => {
    if (isMediatorConfigured()) {
      console.log('\n========================================')
      console.log('MEDIATED CONNECTION FLOW TESTS')
      console.log('========================================')
      console.log('Mediator URL:', getMediatorUrl()?.substring(0, 60) + '...')
      console.log('Using 30-second timeouts to distinguish slow vs broken')
      console.log('========================================\n')
    }
  })

  beforeEach(async () => {
    console.log('\n📋 Building mediated agents (Alice and Bob)...')
    
    // Build agents with mediated transport
    // These will connect to the mediator during initialization
    alice = await buildMediatedAlice(0, 'mediated-test')
    bob = await buildMediatedBob(0, 'mediated-test')
    
    console.log('✓ Mediated agents initialized\n')
  }, 60000) // 60s timeout for agent initialization (includes mediator connection)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 15000)

  describe('Out-of-Band Connection via Mediator', () => {
    it('should establish connection between Alice and Bob through mediator', async () => {
      console.log('🔗 Testing mediated connection establishment...\n')
      
      // Bob creates invitation
      console.log('[Bob] Creating invitation...')
      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id
      expect(bob.outOfBandId).toBeDefined()
      console.log('[Bob] ✓ Invitation created\n')

      // Get the invitation URL
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })
      console.log('Invitation URL:', invitationUrl.substring(0, 80) + '...\n')

      // Alice accepts the invitation
      console.log('[Alice] Accepting invitation...')
      const aliceConnectionPromise = alice.acceptConnection(invitationUrl)

      // Bob waits for connection
      console.log('[Bob] Waiting for connection...')
      const bobConnectionPromise = (async () => {
        let connectionRecord
        for (let i = 0; i < 300; i++) { // 30 seconds (300 * 100ms)
          const [record] = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
          if (record) {
            connectionRecord = record
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!connectionRecord) {
          throw new Error('Bob connection record not found after 30 seconds')
        }
        console.log('[Bob] ✓ Connection record found, waiting for completion...')
        await bob.agent.connections.returnWhenIsConnected(connectionRecord.id)
        console.log('[Bob] ✓ Connection completed')
      })()

      // Wait for both sides with 30-second timeout
      console.log('\n⏱️  Waiting for connection (30s timeout)...\n')
      await Promise.race([
        Promise.all([aliceConnectionPromise, bobConnectionPromise]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
        ),
      ])

      console.log('\n✅ Connection established through mediator!\n')

      // Verify connection established
      expect(alice.connected).toBe(true)
      expect(alice.connectionRecordId).toBeDefined()

      // Verify connection records exist
      const aliceConnection = await alice.agent.connections.getById(alice.connectionRecordId!)
      expect(aliceConnection.state).toBe('completed')

      const [bobConnection] = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
      expect(bobConnection.state).toBe('completed')

      console.log('✓ Alice connection state:', aliceConnection.state)
      console.log('✓ Bob connection state:', bobConnection.state)
      console.log('')
    }, 45000) // 45s total test timeout (30s for connection + buffer)

    it('should exchange did:peer identifiers during mediated connection', async () => {
      console.log('🔑 Testing DID exchange through mediator...\n')
      
      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      const aliceConnectionPromise = alice.acceptConnection(invitationUrl)
      const bobConnectionPromise = (async () => {
        let connectionRecord
        for (let i = 0; i < 300; i++) {
          const [record] = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
          if (record) {
            connectionRecord = record
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!connectionRecord) throw new Error('Bob connection record not found')
        await bob.agent.connections.returnWhenIsConnected(connectionRecord.id)
      })()

      await Promise.race([
        Promise.all([aliceConnectionPromise, bobConnectionPromise]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 30000)),
      ])

      const aliceConnection = await alice.agent.connections.getById(alice.connectionRecordId!)
      const [bobConnection] = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)

      // Verify did:peer identifiers (typically did:peer:1 for DIDComm connections)
      expect(aliceConnection.did).toMatch(/^did:peer:/)
      expect(aliceConnection.theirDid).toMatch(/^did:peer:/)
      expect(bobConnection.did).toMatch(/^did:peer:/)
      expect(bobConnection.theirDid).toMatch(/^did:peer:/)

      console.log('✓ Alice DID:', aliceConnection.did)
      console.log('✓ Alice sees Bob as:', aliceConnection.theirDid)
      console.log('✓ Bob DID:', bobConnection.did)
      console.log('✓ Bob sees Alice as:', bobConnection.theirDid)
      console.log('')
    }, 45000)
  })

  describe('Mediator-Specific Diagnostics', () => {
    it('should log mediator connection state', async () => {
      console.log('🔍 Checking mediator connection state...\n')
      
      // Check if agents have mediator module
      const aliceHasMediator = 'mediationRecipient' in alice.agent.dependencyManager.registeredModules
      const bobHasMediator = 'mediationRecipient' in bob.agent.dependencyManager.registeredModules
      
      console.log('Alice has MediationRecipientModule:', aliceHasMediator)
      console.log('Bob has MediationRecipientModule:', bobHasMediator)
      
      expect(aliceHasMediator).toBe(true)
      expect(bobHasMediator).toBe(true)
      
      // Log transport configuration
      console.log('\nAlice mediator URL:', alice.mediatorInvitationUrl?.substring(0, 60) + '...')
      console.log('Bob mediator URL:', bob.mediatorInvitationUrl?.substring(0, 60) + '...')
      console.log('')
    }, 10000)

    it('should measure mediator connection initialization time', async () => {
      console.log('⏱️  Measuring mediator initialization time...\n')
      
      const startTime = Date.now()
      const testAlice = await buildMediatedAlice(1, 'timing-test')
      const initTime = Date.now() - startTime
      
      console.log(`Mediator connection established in ${initTime}ms`)
      console.log('(Expected: < 10000ms for healthy mediator)')
      
      await cleanupAgents(testAlice)
      
      // This is informational - we don't fail the test on slow connection
      // but we log it for analysis
      if (initTime > 10000) {
        console.warn('⚠️  WARNING: Slow mediator connection (>10s)')
      }
      
      expect(initTime).toBeLessThan(30000) // Should complete within 30s
      console.log('')
    }, 45000)
  })

  describe('Error Scenarios', () => {
    it('should handle connection timeout gracefully', async () => {
      console.log('🚫 Testing timeout handling...\n')
      
      // Create invitation but don't accept it
      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id

      // Verify Bob's agent doesn't crash
      expect(bob.agent).toBeDefined()
      expect(bob.outOfBandId).toBeDefined()
      
      console.log('✓ Agent remains stable with unaccepted invitation')
      console.log('')
    }, 10000)
  })
})

// Export test metadata for CI
export const testMetadata = {
  requiresMediator: true,
  mediatorUrl: getMediatorUrl(),
  timeout: 30000,
  description: 'Tests DIDComm connection establishment through a mediator',
}