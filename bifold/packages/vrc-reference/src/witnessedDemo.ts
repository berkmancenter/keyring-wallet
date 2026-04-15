/**
 * ============================================================================
 * WITNESSED VRC EXCHANGE DEMO
 * ============================================================================
 *
 * This demo implements the full Witnessed VRC Session Flow as described
 * in WITNESSED_FLOW.md. The flow consists of 5 phases:
 *
 * Phase 1: Session Creation (The Handshake)
 * Phase 2: Credential Creation & Wrapping (The Binding)
 * Phase 3: Witness Verification & Endorsement
 * Phase 4: Credential Distribution
 * Phase 5: Final State
 *
 * Run with: yarn witnessed
 */

import { JsonTransformer } from '@credo-ts/core'
import { Alice } from './Alice'
import { Bob } from './Bob'
import { Witness } from './Witness'
import inquirer from 'inquirer'

// Helper to wait for a condition
async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 30000,
  checkInterval = 500
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval))
  }
  throw new Error('Condition not met within timeout')
}

// Helper to pause for user
async function waitForUser(message: string): Promise<void> {
  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: `${message} (Press Enter to continue)`,
    },
  ])
}

function printBanner(text: string) {
  const border = '═'.repeat(text.length + 4)
  console.log(`\n╔${border}╗`)
  console.log(`║  ${text}  ║`)
  console.log(`╚${border}╝\n`)
}

function printPhase(number: number, title: string) {
  console.log(`\n┌${'─'.repeat(60)}┐`)
  console.log(`│ PHASE ${number}: ${title.padEnd(49)} │`)
  console.log(`└${'─'.repeat(60)}┘\n`)
}

async function run() {
  printBanner('WITNESSED VRC EXCHANGE DEMO')
  console.log('This demo walks through a witnessed VRC exchange between Alice, Bob, and a Witness.\n')
  console.log('Reference: WITNESSED_FLOW.md\n')

  let alice: Alice | undefined
  let bob: Bob | undefined
  let witness: Witness | undefined

  try {
    // ========================================================================
    // SETUP: Initialize all agents
    // ========================================================================
    console.log(purpleText('Initializing agents...\n'))

    console.log('  Starting Alice agent on port 9000...')
    alice = await Alice.build()
    console.log(greenText('  ✓ Alice initialized\n'))

    console.log('  Starting Bob agent on port 9001...')
    bob = await Bob.build()
    console.log(greenText('  ✓ Bob initialized\n'))

    console.log('  Starting Witness agent on port 9002...')
    witness = await Witness.build()
    console.log(greenText('  ✓ Witness initialized\n'))

    await waitForUser('All agents initialized!')

    // ========================================================================
    // SETUP: Establish connections between all parties
    // ========================================================================
    console.log(purpleText('\nEstablishing connections...\n'))

    // 1. Connect Alice to Bob
    console.log('  Connecting Alice ↔ Bob...')
    const bobOob = await bob.agent.oob.createInvitation()
    bob.outOfBandId = bobOob.id
    const bobInviteUrl = bobOob.outOfBandInvitation.toUrl({ domain: 'http://localhost:9001' })

    await alice.acceptConnection(bobInviteUrl)

    // Wait for connection to be established from THIS specific OOB invitation
    await waitForCondition(async () => {
      const bobConns = await bob!.agent.connections.findAllByOutOfBandId(bobOob.id)
      return alice!.connectionRecordId !== undefined && bobConns.length > 0 && bobConns[0].state === 'completed'
    }, 15000)

    // Use Alice's stored connection ID (set during acceptConnection)
    const aliceBobConnectionId = alice.connectionRecordId!
    // Get Bob's connection from the specific OOB invitation (not getAll!)
    const bobAliceConns = await bob.agent.connections.findAllByOutOfBandId(bobOob.id)
    const bobAliceConnectionId = bobAliceConns[0].id

    console.log(greenText('  ✓ Alice ↔ Bob connected'))
    console.log(purpleText(`    Alice's connection ID: ${aliceBobConnectionId}`))
    console.log(purpleText(`    Bob's connection ID: ${bobAliceConnectionId}\n`))

    // 2. Connect Alice to Witness
    console.log('  Connecting Alice ↔ Witness...')
    const witnessAliceOob = await witness.agent.oob.createInvitation()
    const witnessAliceInviteUrl = witnessAliceOob.outOfBandInvitation.toUrl({ domain: 'http://localhost:9002' })
    console.log(purpleText(`Invitation URL: ${witnessAliceInviteUrl}\n`))

    await alice.acceptConnection(witnessAliceInviteUrl)

    // Alice's connectionRecordId is now the Alice-Witness connection (overwrote the Bob connection)
    const aliceConnectionToWitness = alice.connectionRecordId!

    // Wait for Witness to get the connection from THIS specific OOB invitation
    await waitForCondition(async () => {
      const conns = await witness!.agent.connections.findAllByOutOfBandId(witnessAliceOob.id)
      return conns.length > 0 && conns[0].state === 'completed'
    }, 15000)

    // Get the Witness's connection ID from the specific OOB invitation (not getAll!)
    const witnessAliceConns = await witness.agent.connections.findAllByOutOfBandId(witnessAliceOob.id)
    const aliceWitnessConnectionId = witnessAliceConns[0].id // Witness's connection to Alice from THIS invitation

    console.log(greenText('  ✓ Alice ↔ Witness connected'))
    console.log(purpleText(`    Alice's connection to Witness: ${aliceConnectionToWitness}`))
    console.log(purpleText(`    Witness's connection to Alice: ${aliceWitnessConnectionId}\n`))

    // 3. Connect Bob to Witness
    console.log('  Connecting Bob ↔ Witness...')
    const witnessBobOob = await witness.agent.oob.createInvitation()
    const witnessBobInviteUrl = witnessBobOob.outOfBandInvitation.toUrl({ domain: 'http://localhost:9002' })
    console.log(purpleText(`Invitation URL: ${witnessBobInviteUrl}\n`))

    const { connectionRecord: bobWitnessConn } = await bob.agent.oob.receiveInvitationFromUrl(witnessBobInviteUrl)
    await bob.agent.connections.returnWhenIsConnected(bobWitnessConn!.id)
    const bobConnectionToWitness = bobWitnessConn!.id

    // Wait for Witness to get the connection from THIS specific OOB invitation
    await waitForCondition(async () => {
      const conns = await witness!.agent.connections.findAllByOutOfBandId(witnessBobOob.id)
      return conns.length > 0 && conns[0].state === 'completed'
    }, 15000)

    // Get the Witness's connection ID from the specific OOB invitation (not getAll!)
    const witnessBobConns = await witness.agent.connections.findAllByOutOfBandId(witnessBobOob.id)
    const bobWitnessConnectionId = witnessBobConns[0].id // Witness's connection to Bob from THIS invitation

    console.log(greenText('  ✓ Bob ↔ Witness connected'))
    console.log(purpleText(`    Bob's connection to Witness: ${bobConnectionToWitness}`))
    console.log(purpleText(`    Witness's connection to Bob: ${bobWitnessConnectionId}\n`))

    await waitForUser('All connections established!')

    // ========================================================================
    // SETUP: Exchange Subject DIDs between Alice and Bob
    // ========================================================================
    console.log(purpleText('\nExchanging Subject DIDs through their direct connection...\n'))

    // Alice's subject DID was created during acceptConnection and sent to Bob
    // Now Bob needs to send his DID to Alice
    const aliceSubjectDid = alice.getIssuerDid()
    const bobIssuerDid = bob.getIssuerDid()

    console.log(greenText('  Created DIDs:'))
    console.log(purpleText(`    Alice's DID (did:peer:0): ${aliceSubjectDid}`))
    console.log(purpleText(`    Bob's DID (did:peer:0): ${bobIssuerDid}\n`))

    // Alice already sent her DID to Bob in acceptConnection()
    console.log(greenText('  ✓ Alice → Bob: DID sent during connection setup'))

    // Bob sends his DID to Alice via basic message
    console.log('  Bob → Alice: Sending DID via basic message...')
    await bob.agent.basicMessages.sendMessage(
      bobAliceConnectionId,
      JSON.stringify({ holderSubjectDid: bobIssuerDid })
    )

    // Wait for Alice to receive Bob's DID (use simpler check - any counterparty DID)
    await waitForCondition(async () => {
      return alice.hasCounterpartyDid()
    }, 10000)

    console.log(greenText('  ✓ Bob → Alice: DID received'))

    // Get the DID Alice actually received (may be stored under different connection ID)
    const aliceReceivedBobDid = alice.getAnyCounterpartyDid()

    console.log(greenText('\n  DID Exchange Complete:'))
    console.log(purpleText(`    Alice knows Bob's DID: ${aliceReceivedBobDid}`))
    console.log(purpleText(`    Bob knows Alice's DID: ${aliceSubjectDid}\n`))

    await waitForUser('DIDs exchanged through Alice-Bob connection!')

    // ========================================================================
    // PHASE 1: SESSION CREATION (The Handshake)
    // ========================================================================
    printPhase(1, 'SESSION CREATION (The Handshake)')

    console.log('Witness creates a session and distributes challenge to Alice and Bob...\n')

    const { sessionId, challenge, domain } = await witness.createWitnessedSession(
      aliceWitnessConnectionId,
      bobWitnessConnectionId
    )

    console.log(greenText('Session Created:'))
    console.log(purpleText(`  Session ID: ${sessionId}`))
    console.log(purpleText(`  Challenge (nonce): ${challenge}`))
    console.log(purpleText(`  Domain: ${domain}\n`))

    await waitForUser('Phase 1 complete!')

    // ========================================================================
    // PHASE 2: CREDENTIAL CREATION & WRAPPING (The Binding)
    // ========================================================================
    printPhase(2, 'CREDENTIAL CREATION & WRAPPING (The Binding)')

    console.log('Alice and Bob each create a VRC, wrap it in a VP, and submit to Witness.\n')
    console.log('Key: The VRC schema is unchanged. Session binding happens at the VP layer.\n')

    // Get the DIDs that were exchanged through the Alice-Bob connection
    // Bob uses Alice's DID that he received via basic message
    const aliceDidReceivedByBob = bob.getHolderSubjectDid(bobAliceConnectionId)
    // Alice uses Bob's DID that she received via basic message (use any since connection ID may differ)
    const bobDidReceivedByAlice = alice.getAnyCounterpartyDid()

    console.log(greenText('Using exchanged DIDs from Alice↔Bob connection:'))
    console.log(purpleText(`  Bob will target Alice at: ${aliceDidReceivedByBob}`))
    console.log(purpleText(`  Alice will target Bob at: ${bobDidReceivedByAlice}\n`))

    // Bob creates and submits his presentation
    console.log(purpleText('─'.repeat(60)))
    console.log(purpleText('BOB: Creating VRC → VP → Submitting to Witness'))
    console.log(purpleText('─'.repeat(60)))

    await bob.createAndSubmitPresentation(
      bobConnectionToWitness,
      aliceDidReceivedByBob!, // Target: Alice (DID received via connection)
      'alice',
      challenge,
      domain
    )

    await waitForUser("Bob's VP submitted!")

    // Alice creates and submits her presentation
    console.log(purpleText('─'.repeat(60)))
    console.log(purpleText('ALICE: Creating VRC → VP → Submitting to Witness'))
    console.log(purpleText('─'.repeat(60)))

    await alice.createAndSubmitPresentation(
      aliceConnectionToWitness,
      bobDidReceivedByAlice!, // Target: Bob (DID received via connection)
      'bob',
      challenge,
      domain
    )

    await waitForUser("Alice's VP submitted!")

    // ========================================================================
    // PHASE 3: WITNESS VERIFICATION & ENDORSEMENT
    // ========================================================================
    printPhase(3, 'WITNESS VERIFICATION & ENDORSEMENT')

    console.log('Witness verifies both presentations...\n')
    console.log('For each VP, Witness performs:')
    console.log('  1. Context Check: VP signature matches challenge')
    console.log('  2. Identity Check: VRC signature belongs to claimed issuer')
    console.log('  3. Freshness Check: VRC timestamp is recent\n')

    // Wait for both presentations to be received
    console.log(purpleText('Waiting for Witness to receive and verify both presentations...\n'))

    await waitForCondition(async () => {
      const count = witness!.getSessionPresentationCount(sessionId)
      return count === 2
    }, 30000)

    console.log(greenText('✓ Witness received and verified both presentations!\n'))

    await waitForUser('Phase 3 complete!')

    // ========================================================================
    // PHASE 4: CREDENTIAL DISTRIBUTION
    // ========================================================================
    printPhase(4, 'CREDENTIAL DISTRIBUTION')

    console.log('Witness issues Witness Credentials (VWCs) to participants.\n')
    console.log('Per WITNESSED_FLOW.md:')
    console.log('  • VWC A (attesting Bob\'s VRC) → sent to Alice')
    console.log('  • VWC B (attesting Alice\'s VRC) → sent to Bob\n')

    await witness.issueWitnessCredentials(sessionId)

    // Wait for credential offers to arrive at both parties
    console.log(purpleText('Waiting for VWC offers to arrive...\n'))
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Alice and Bob accept their VWC offers
    console.log(greenText('Accepting VWC offers...\n'))

    const aliceAccepted = await alice.acceptPendingCredentialOffers()
    const bobAccepted = await bob.acceptPendingCredentialOffers()

    // Wait for credentials to be fully stored
    await new Promise((resolve) => setTimeout(resolve, 2000))

    console.log(greenText(`\n✓ Witness credentials issued and accepted!`))
    console.log(purpleText(`  Alice accepted ${aliceAccepted} VWC(s)`))
    console.log(purpleText(`  Bob accepted ${bobAccepted} VWC(s)\n`))

    await waitForUser('Phase 4 complete!')

    // ========================================================================
    // PHASE 5: FINAL STATE
    // ========================================================================
    printPhase(5, 'FINAL STATE')

    console.log('At the end of this flow, Alice and Bob each possess:\n')
    console.log('  1. Their own VRC: The relationship credential they created about the other party')
    console.log('     (Note: VRCs are NOT exchanged - they go to the Witness for verification)')
    console.log('  2. A VWC: Third-party attestation from the Witness proving the counterparty\'s')
    console.log('     VRC was verified during the witnessed session\n')

    console.log(purpleText('─'.repeat(60)))
    console.log(purpleText('ALICE\'s Credentials:'))
    console.log(purpleText('─'.repeat(60)))
    await alice.listStoredCredentials()

    console.log(purpleText('─'.repeat(60)))
    console.log(purpleText('BOB\'s Credentials:'))
    console.log(purpleText('─'.repeat(60)))
    const bobCredentials = await bob.agent.w3cCredentials.getAllCredentialRecords()
    const bobValidCredentials = bobCredentials.filter((record) => Boolean(record.credential))
    
    if (bobValidCredentials.length === 0) {
      console.log(greenText(`Bob has 0 credential(s) stored\n`))
    } else {
      console.log(greenText(`Bob has ${bobValidCredentials.length} credential(s) stored:\n`))
      bobValidCredentials.forEach((record, index) => {
        if (!record.credential) return
        const credentialJson = JsonTransformer.toJSON(record.credential)
        const types = (credentialJson as any).type?.join(', ') || 'Unknown'
        const issuer = (credentialJson as any).issuer || 'Unknown'
        console.log(purpleText(`[${index + 1}] recordId=${record.id} | types: ${types} | issuer: ${issuer}`))
        console.log(JSON.stringify(credentialJson, null, 2))
      })
      console.log('')
    }

    printBanner('WITNESSED VRC EXCHANGE COMPLETE!')

    console.log('Summary:')
    console.log(`  • Session ID: ${sessionId}`)
    console.log(`  • Alice created a VRC about Bob and submitted it to ${witness.name}`)
    console.log(`  • Bob created a VRC about Alice and submitted it to ${witness.name}`)
    console.log(`  • ${witness.name} verified both VRCs and issued VWCs:`)
    console.log(`    - VWC attesting to Bob's VRC → sent to Alice`)
    console.log(`    - VWC attesting to Alice's VRC → sent to Bob\n`)

    console.log(greenText('Alice can now prove to a verifier:'))
    console.log(purpleText('"I have a VWC from a trusted Witness proving that Bob'))
    console.log(purpleText('claimed to know me in a specific witnessed session."\n'))

  } catch (error) {
    console.error(redText(`\nError: ${(error as Error).message}`))
    console.error((error as Error).stack)
  } finally {
    // Cleanup
    console.log(purpleText('\nShutting down agents...\n'))
    if (alice) await alice.agent.shutdown()
    if (bob) await bob.agent.shutdown()
    if (witness) await witness.agent.shutdown()
    console.log(greenText('Done!\n'))
  }
}

// Run the demo
run().catch(console.error)

