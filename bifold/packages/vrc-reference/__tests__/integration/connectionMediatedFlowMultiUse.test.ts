import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { buildMediatedAlice, buildMediatedBob, cleanupAgents, isMediatorConfigured, getMediatorUrl } from '../helpers/testUtils'

/**
 * Mediated Connection Flow Integration Tests - Multi-Use Invitations
 * 
 * These tests verify that agents can establish connections through a mediator
 * using multi-use invite codes. Unlike single-use invitations, a multi-use
 * invitation can be used by multiple agents to connect to the same inviter.
 * 
 * Requirements:
 * - MEDIATOR_INVITATION_URL must be set in environment
 * - Tests use 30-second timeouts to distinguish "slow" from "broken"
 */

// Skip entire suite if mediator is not configured
const describeIfMediator = isMediatorConfigured() ? describe : describe.skip

describeIfMediator('Mediated Connection Flow Integration - Multi-Use Invitations', () => {
  let alice1: Alice
  let alice2: Alice
  let bob: Bob

  beforeAll(() => {
    if (isMediatorConfigured()) {
      console.log('\n========================================')
      console.log('MEDIATED MULTI-USE INVITATION TESTS')
      console.log('========================================')
      console.log('Mediator URL:', getMediatorUrl()?.substring(0, 60) + '...')
      console.log('Testing multi-use invitation functionality')
      console.log('========================================\n')
    }
  })

  beforeEach(async () => {
    console.log('\n📋 Building mediated agents (Alice #1, Alice #2, and Bob)...')
    
    // Build agents with mediated transport
    alice1 = await buildMediatedAlice(0, 'mediated-multiuse-test-1')
    alice2 = await buildMediatedAlice(1, 'mediated-multiuse-test-2')
    bob = await buildMediatedBob(0, 'mediated-multiuse-test')
    
    console.log('✓ Mediated agents initialized\n')
  }, 90000) // 90s timeout for agent initialization (3 agents with mediator connections)

  afterEach(async () => {
    await cleanupAgents(alice1, alice2, bob)
  }, 15000)

  describe('Multi-Use Out-of-Band Invitation via Mediator', () => {
    it('should allow multiple agents to connect using the same multi-use invitation', async () => {
      console.log('🔗 Testing multi-use mediated invitation...\n')
      
      // Bob creates a MULTI-USE invitation
      console.log('[Bob] Creating multi-use invitation...')
      const outOfBand = await bob.agent.oob.createInvitation({
        multiUseInvitation: true,
      })
      bob.outOfBandId = outOfBand.id
      expect(bob.outOfBandId).toBeDefined()
      console.log('[Bob] ✓ Multi-use invitation created\n')

      // Get the invitation URL
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })
      console.log('Multi-use Invitation URL:', invitationUrl.substring(0, 80) + '...\n')

      // Alice #1 accepts the invitation
      console.log('[Alice #1] Accepting invitation...')
      const alice1ConnectionPromise = alice1.acceptConnection(invitationUrl)

      // Bob waits for first connection
      console.log('[Bob] Waiting for connection from Alice #1...')
      const bobConnection1Promise = (async () => {
        let connectionRecord
        for (let i = 0; i < 300; i++) { // 30 seconds (300 * 100ms)
          const records = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
          if (records.length > 0) {
            connectionRecord = records[0]
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!connectionRecord) {
          throw new Error('Bob connection record #1 not found after 30 seconds')
        }
        console.log('[Bob] ✓ Connection record #1 found (ID: ' + connectionRecord.id + '), waiting for completion...')
        await bob.agent.connections.returnWhenIsConnected(connectionRecord.id)
        console.log('[Bob] ✓ Connection #1 completed')
        // Fetch the updated connection record to get the latest state
        return await bob.agent.connections.getById(connectionRecord.id)
      })()

      // Wait for first connection with 30-second timeout
      console.log('\n⏱️  Waiting for first connection (30s timeout)...\n')
      const [, bobConnection1] = await Promise.race([
        Promise.all([alice1ConnectionPromise, bobConnection1Promise]),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('First connection timeout after 30 seconds')), 30000)
        ),
      ])

      console.log('\n✅ First connection established through mediator!\n')

      // Verify first connection established
      expect(alice1.connected).toBe(true)
      expect(alice1.connectionRecordId).toBeDefined()

      const alice1Connection = await alice1.agent.connections.getById(alice1.connectionRecordId!)
      expect(alice1Connection.state).toBe('completed')
      expect(bobConnection1.state).toBe('completed')

      console.log('✓ Alice #1 connection state:', alice1Connection.state)
      console.log('✓ Bob connection #1 state:', bobConnection1.state)
      console.log('')

      // Now Alice #2 uses the SAME invitation URL
      console.log('[Alice #2] Accepting the same multi-use invitation...')
      const alice2ConnectionPromise = alice2.acceptConnection(invitationUrl)

      // Bob waits for second connection (must be different from first)
      console.log('[Bob] Waiting for connection from Alice #2...')
      const bobConnection2Promise = (async () => {
        const firstConnectionId = bobConnection1.id
        let connectionRecord
        for (let i = 0; i < 300; i++) { // 30 seconds
          const records = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
          // Find a connection that's NOT the first one
          const newConnection = records.find(r => r.id !== firstConnectionId)
          if (newConnection) {
            connectionRecord = newConnection
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (!connectionRecord) {
          throw new Error('Bob connection record #2 not found after 30 seconds')
        }
        console.log('[Bob] ✓ Connection record #2 found (ID: ' + connectionRecord.id + '), waiting for completion...')
        await bob.agent.connections.returnWhenIsConnected(connectionRecord.id)
        console.log('[Bob] ✓ Connection #2 completed')
        // Fetch the updated connection record to get the latest state
        return await bob.agent.connections.getById(connectionRecord.id)
      })()

      // Wait for second connection with 30-second timeout
      console.log('\n⏱️  Waiting for second connection (30s timeout)...\n')
      const [, bobConnection2] = await Promise.race([
        Promise.all([alice2ConnectionPromise, bobConnection2Promise]),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Second connection timeout after 30 seconds')), 30000)
        ),
      ])

      console.log('\n✅ Second connection established through mediator using same invitation!\n')

      // Verify second connection established
      expect(alice2.connected).toBe(true)
      expect(alice2.connectionRecordId).toBeDefined()

      const alice2Connection = await alice2.agent.connections.getById(alice2.connectionRecordId!)
      expect(alice2Connection.state).toBe('completed')
      expect(bobConnection2.state).toBe('completed')

      console.log('✓ Alice #2 connection state:', alice2Connection.state)
      console.log('✓ Bob connection #2 state:', bobConnection2.state)
      console.log('')

      // Verify both connections are different
      expect(alice1.connectionRecordId).not.toBe(alice2.connectionRecordId)
      expect(bobConnection1.id).not.toBe(bobConnection2.id)

      // Verify Bob's connections share the same outOfBandId (his invitation)
      expect(bobConnection1.outOfBandId).toBe(bob.outOfBandId)
      expect(bobConnection2.outOfBandId).toBe(bob.outOfBandId)

      // Alice's connections have their own outOfBandIds (from receiving the invitation)
      expect(alice1Connection.outOfBandId).toBeDefined()
      expect(alice2Connection.outOfBandId).toBeDefined()
      expect(alice1Connection.outOfBandId).not.toBe(alice2Connection.outOfBandId)

      console.log('✓ Bob\'s connections share the same outOfBandId:', bob.outOfBandId)
      console.log('✓ Alice\'s connections have unique outOfBandIds (as expected)')
      console.log('✓ Multi-use invitation test successful!\n')
    }, 90000) // 90s total test timeout (2 connections, each up to 30s + buffer)

    it('should create separate connection records for each agent using multi-use invitation', async () => {
      console.log('🔍 Testing separate connection records for multi-use invitation...\n')
      
      // Bob creates a multi-use invitation
      const outOfBand = await bob.agent.oob.createInvitation({
        multiUseInvitation: true,
      })
      bob.outOfBandId = outOfBand.id
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      // Both Alices accept the invitation
      const alice1ConnectionPromise = alice1.acceptConnection(invitationUrl)
      const alice2ConnectionPromise = alice2.acceptConnection(invitationUrl)

      // Wait for both connections
      await Promise.race([
        Promise.all([alice1ConnectionPromise, alice2ConnectionPromise]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 45000)),
      ])

      // Get all Bob's connections for this invitation
      const bobConnections = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
      
      expect(bobConnections).toHaveLength(2)
      expect(bobConnections[0].id).not.toBe(bobConnections[1].id)
      expect(bobConnections[0].state).toBe('completed')
      expect(bobConnections[1].state).toBe('completed')

      console.log('✓ Bob has 2 separate connection records')
      console.log('✓ Connection #1 ID:', bobConnections[0].id)
      console.log('✓ Connection #2 ID:', bobConnections[1].id)
      console.log('')
    }, 60000)

    it('should exchange unique did:peer identifiers for each connection from multi-use invitation', async () => {
      console.log('🔑 Testing unique DIDs for each multi-use invitation connection...\n')
      
      const outOfBand = await bob.agent.oob.createInvitation({
        multiUseInvitation: true,
      })
      bob.outOfBandId = outOfBand.id
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      // Both Alices accept
      await Promise.race([
        Promise.all([
          alice1.acceptConnection(invitationUrl),
          alice2.acceptConnection(invitationUrl),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 45000)),
      ])

      // Get connection records
      const alice1Connection = await alice1.agent.connections.getById(alice1.connectionRecordId!)
      const alice2Connection = await alice2.agent.connections.getById(alice2.connectionRecordId!)
      const bobConnections = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)

      // Verify all DIDs are did:peer
      expect(alice1Connection.did).toMatch(/^did:peer:/)
      expect(alice1Connection.theirDid).toMatch(/^did:peer:/)
      expect(alice2Connection.did).toMatch(/^did:peer:/)
      expect(alice2Connection.theirDid).toMatch(/^did:peer:/)
      expect(bobConnections[0].did).toMatch(/^did:peer:/)
      expect(bobConnections[0].theirDid).toMatch(/^did:peer:/)
      expect(bobConnections[1].did).toMatch(/^did:peer:/)
      expect(bobConnections[1].theirDid).toMatch(/^did:peer:/)

      // Verify DIDs are unique for each connection
      expect(alice1Connection.did).not.toBe(alice2Connection.did)
      expect(bobConnections[0].did).not.toBe(bobConnections[1].did)

      console.log('✓ Alice #1 DID:', alice1Connection.did)
      console.log('✓ Alice #2 DID:', alice2Connection.did)
      console.log('✓ Bob DID for connection #1:', bobConnections[0].did)
      console.log('✓ Bob DID for connection #2:', bobConnections[1].did)
      console.log('✓ All DIDs are unique per connection\n')
    }, 60000)
  })

  describe('Multi-Use Invitation Behavior', () => {
    it('should maintain invitation availability after first connection', async () => {
      console.log('🔄 Testing invitation reusability...\n')
      
      const outOfBand = await bob.agent.oob.createInvitation({
        multiUseInvitation: true,
      })
      bob.outOfBandId = outOfBand.id
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      // First connection
      await alice1.acceptConnection(invitationUrl)
      
      // Wait a bit to ensure first connection is fully established
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Invitation should still be valid for second connection
      await alice2.acceptConnection(invitationUrl)
      
      const bobConnections = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
      expect(bobConnections).toHaveLength(2)
      
      console.log('✓ Invitation remained valid after first use')
      console.log('✓ Successfully created 2 connections from same invitation\n')
    }, 60000)

    it('should retrieve out-of-band record marked as reusable', async () => {
      console.log('📝 Testing out-of-band record reusable flag...\n')
      
      const outOfBand = await bob.agent.oob.createInvitation({
        multiUseInvitation: true,
      })
      
      // Retrieve the out-of-band record
      const oobRecord = await bob.agent.oob.findById(outOfBand.id)
      
      expect(oobRecord).toBeDefined()
      expect(oobRecord?.reusable).toBe(true)
      
      console.log('✓ Out-of-band record marked as reusable')
      console.log('✓ Record ID:', oobRecord?.id)
      console.log('')
    }, 10000)
  })

  describe('Comparison with Single-Use Invitations', () => {
    it('should demonstrate difference between single-use and multi-use invitations', async () => {
      console.log('🔀 Comparing single-use vs multi-use invitations...\n')
      
      // Create single-use invitation
      console.log('[Bob] Creating single-use invitation...')
      const singleUseOob = await bob.agent.oob.createInvitation({
        multiUseInvitation: false, // or omit, as false is default
      })
      
      // Create multi-use invitation  
      console.log('[Bob] Creating multi-use invitation...')
      const multiUseOob = await bob.agent.oob.createInvitation({
        multiUseInvitation: true,
      })
      bob.outOfBandId = multiUseOob.id
      const multiUseUrl = multiUseOob.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })
      
      // Check reusable flags
      const singleUseRecord = await bob.agent.oob.findById(singleUseOob.id)
      const multiUseRecord = await bob.agent.oob.findById(multiUseOob.id)
      
      expect(singleUseRecord?.reusable).toBe(false)
      expect(multiUseRecord?.reusable).toBe(true)
      
      console.log('✓ Single-use record reusable:', singleUseRecord?.reusable)
      console.log('✓ Multi-use record reusable:', multiUseRecord?.reusable)
      
      // Use multi-use invitation twice
      await alice1.acceptConnection(multiUseUrl)
      await alice2.acceptConnection(multiUseUrl)
      
      const multiUseConnections = await bob.agent.connections.findAllByOutOfBandId(multiUseOob.id)
      expect(multiUseConnections).toHaveLength(2)
      
      console.log('✓ Multi-use invitation created 2 connections')
      console.log('✓ Demonstration complete\n')
    }, 60000)
  })
})

// Export test metadata for CI
export const testMetadata = {
  requiresMediator: true,
  mediatorUrl: getMediatorUrl(),
  timeout: 60000,
  description: 'Tests DIDComm connection establishment through a mediator using multi-use invitations',
}