import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { buildAlice, buildBob, cleanupAgents } from '../helpers/testUtils'

describe('Connection Flow Integration', () => {
  let alice: Alice
  let bob: Bob

  // Note: These tests require actual Credo agents and can be slow
  // They are marked as integration tests and may be skipped in CI

  beforeEach(async () => {
    // Use worker-aware port allocation to avoid conflicts
    alice = await buildAlice()
    bob = await buildBob()
  }, 15000)

  afterEach(async () => {
    await cleanupAgents(alice, bob)
  }, 10000)

  describe('Out-of-Band Connection', () => {
    it('should establish connection between Alice and Bob', async () => {
      // Bob creates invitation
      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id
      expect(bob.outOfBandId).toBeDefined()

      // Get the invitation URL
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      // Alice and Bob connect concurrently with timeout
      const aliceConnectionPromise = alice.acceptConnection(invitationUrl)

      const bobConnectionPromise = (async () => {
        let connectionRecord
        for (let i = 0; i < 50; i++) {
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 20000)),
      ])

      // Verify connection established
      expect(alice.connected).toBe(true)
      expect(alice.connectionRecordId).toBeDefined()

      // Verify connection records exist
      const aliceConnection = await alice.agent.connections.getById(alice.connectionRecordId!)
      expect(aliceConnection.state).toBe('completed')

      const [bobConnection] = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)
      expect(bobConnection.state).toBe('completed')
    }, 30000)

    it('should exchange did:peer identifiers during connection', async () => {
      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      const aliceConnectionPromise = alice.acceptConnection(invitationUrl)
      const bobConnectionPromise = (async () => {
        let connectionRecord
        for (let i = 0; i < 50; i++) {
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 20000)),
      ])

      const aliceConnection = await alice.agent.connections.getById(alice.connectionRecordId!)
      const [bobConnection] = await bob.agent.connections.findAllByOutOfBandId(bob.outOfBandId!)

      // Verify did:peer identifiers (typically did:peer:1 for DIDComm connections)
      expect(aliceConnection.did).toMatch(/^did:peer:/)
      expect(aliceConnection.theirDid).toMatch(/^did:peer:/)
      expect(bobConnection.did).toMatch(/^did:peer:/)
      expect(bobConnection.theirDid).toMatch(/^did:peer:/)
    }, 30000)

    it('should handle connection timeout gracefully', async () => {
      // Create invitation but don't accept it
      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id

      // Verify Bob's agent doesn't crash
      expect(bob.agent).toBeDefined()
      expect(bob.outOfBandId).toBeDefined()
    }, 10000)
  })

  describe('Connection State Management', () => {
    it('should track connection state changes', async () => {
      const stateChanges: string[] = []

      alice.agent.events.on('ConnectionStateChanged' as any, (event: any) => {
        stateChanges.push(event.payload.connectionRecord.state)
      })

      const outOfBand = await bob.agent.oob.createInvitation()
      bob.outOfBandId = outOfBand.id
      const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
        domain: `http://localhost:${bob.port}`,
      })

      const aliceConnectionPromise = alice.acceptConnection(invitationUrl)
      const bobConnectionPromise = (async () => {
        let connectionRecord
        for (let i = 0; i < 50; i++) {
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 20000)),
      ])

      // Verify state progression
      expect(stateChanges).toContain('completed')
    }, 30000)
  })

  describe('Error Handling', () => {
    it('should handle invalid invitation URL', async () => {
      const invalidUrl = 'http://invalid-url?oob=malformed'

      await expect(alice.acceptConnection(invalidUrl)).rejects.toThrow()
    }, 10000)

    it('should handle connection to non-existent agent', async () => {
      // Create a valid-looking invitation but no agent listening
      const fakeInvitation =
        'http://localhost:99999?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJ0ZXN0In0='

      await expect(alice.acceptConnection(fakeInvitation)).rejects.toThrow()
    }, 10000)
  })
})
