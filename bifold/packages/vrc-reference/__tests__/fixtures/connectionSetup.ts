import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { buildAlice, buildBob } from '../helpers/testUtils'

/**
 * Establishes a connection between Alice and Bob agents
 * Returns configured agents with active connection
 */
export async function setupConnectedAgents(): Promise<{
  alice: Alice
  bob: Bob
}> {
  // Use worker-aware port allocation to avoid conflicts
  const alice = await buildAlice()
  const bob = await buildBob()

  // Establish connection
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

  // Allow connection state to stabilize and DIDs to be fully imported
  // Alice and Bob both do DID re-imports with overwrite:true after connection
  // We need to wait for these wallet operations to complete
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Verify DIDs are accessible before proceeding
  const aliceIssuerDid = alice.getIssuerDid()
  const bobIssuerDid = bob.getIssuerDid()

  if (!aliceIssuerDid) {
    throw new Error('Alice DID not initialized after connection')
  }
  if (!bobIssuerDid) {
    throw new Error('Bob DID not initialized after connection')
  }

  // CRITICAL: Share DID documents between agents for cross-agent verification
  // This simulates what happens in manual flow where DID documents are exchanged

  // Share Bob's issuer DID with Alice (for credential signature verification)
  const bobDidResolution = await bob.agent.dids.resolve(bobIssuerDid)
  if (bobDidResolution.didDocument) {
    await alice.agent.dids.import({
      did: bobIssuerDid,
      didDocument: bobDidResolution.didDocument,
      overwrite: true,
    })
  }

  // Share Alice's subject DID with Bob (for proof presentation signature verification)
  // When Alice sends a proof presentation, Bob needs to verify her signature
  const aliceDidResolution = await alice.agent.dids.resolve(aliceIssuerDid)
  if (aliceDidResolution.didDocument) {
    await bob.agent.dids.import({
      did: aliceIssuerDid,
      didDocument: aliceDidResolution.didDocument,
      overwrite: true,
    })
  }

  return { alice, bob }
}

/**
 * Issues a credential from Bob to Alice and waits for it to be received
 * Requires alice and bob to already be connected
 */
export async function issueAndReceiveCredential(alice: Alice, bob: Bob): Promise<void> {
  const { waitForCondition } = await import('../helpers/testUtils')

  // Bob offers credential
  await bob.issueCredential()

  // Wait for Alice to receive offer
  await waitForCondition(async () => {
    const records = await alice.agent.credentials.getAll()
    return records.some((r) => r.state === 'offer-received')
  }, 10000)

  // Get credential offer
  const credentialRecords = await alice.agent.credentials.getAll()
  const offerRecord = credentialRecords.find((r) => r.state === 'offer-received')

  if (!offerRecord) {
    throw new Error('Credential offer not found')
  }

  // Alice accepts offer
  await alice.acceptCredentialOffer(offerRecord)

  // Wait for credential to be issued and stored
  // This can take longer due to cryptographic signing and storage operations
  await waitForCondition(async () => {
    const records = await alice.agent.w3cCredentials.getAllCredentialRecords()
    return records.some((r) => r.credential !== null)
  }, 20000)
}
