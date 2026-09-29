import { JsonTransformer, W3cJsonLdVerifiableCredential } from '@credo-ts/core'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { Witness } from '../../src/Witness'
import { buildAlice, buildBob, buildWitness, cleanupAgents, waitForCondition } from '../helpers/testUtils'

/**
 * ============================================================================
 * CAPTURE TOOL — the witnessed-edge fixture, rebuilt
 * ============================================================================
 *
 * `tsp-reference/ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json`
 * (Check D's highest-value fixture) was originally produced by a tool that
 * was never committed (`captureWitnessedEdge.local-al.test.ts`, 2026-08-26).
 * This is that tool, rebuilt and committed — same 5-phase flow as
 * `witnessedFlow.test.ts`, but ending in a real capture instead of assertions.
 *
 * Runs entirely in-process (real Askar-backed Credo agents, no mediator, no
 * witness-server process) — nothing here needs live infra.
 *
 * By default this only asserts the captured shape is stable (a regression
 * guard, safe for a normal `yarn test` run). Set CAPTURE_OUTPUT=1 to also
 * write a fresh capture to `capture-output/edge-witnessed-captured.json`
 * (gitignored — a throwaway artifact for manual inspection, not a ladder
 * input; the ladder's frozen fixture is untouched by this test).
 *
 * KNOWN LIMITATION, not fixed here: this reference implementation's own
 * `Witness.buildWitnessCredential` is a legacy, hardcoded builder — it does
 * not read `WITNESS_CREDENTIAL_SHAPE` and cannot produce a `vsc`-shaped VWC.
 * The real `vsc` implementation lives in `witness-server`'s
 * `buildWitnessCredentialJson` (`WitnessService.ts`), which has no library
 * entrypoint this package can import without pulling in a CLI-shaped
 * package (langchain, node-ble, three, ws — server dependencies, not meant
 * for reuse). Producing a genuine `vsc`-shaped capture would need either a
 * live witness-server process or a real library-export refactor of that
 * package — both out of scope for a capture-tool rebuild. See
 * `tsp-reference/ref-07-dtg-edge-semantics/README.md` for the full note.
 */
describe('Capture: Witnessed Edge (rebuilt capture tool)', () => {
  let alice: Alice
  let bob: Bob
  let witness: Witness
  let aliceWitnessConnectionId: string
  let bobWitnessConnectionId: string
  let aliceBobConnectionId: string
  let bobAliceConnectionId: string
  let aliceConnectionToWitness: string
  let bobConnectionToWitness: string

  beforeEach(async () => {
    alice = await buildAlice(0, 'capture')
    bob = await buildBob(0, 'capture')
    witness = await buildWitness(0)

    const bobInviteUrl = await bob.createConnectionInvitation()
    aliceBobConnectionId = await alice.acceptConnection(bobInviteUrl)

    await waitForCondition(async () => {
      const bobConns = await bob.agent.modules.didcomm.connections.getAll()
      return bobConns.length > 0 && bobConns.some((c) => c.state === 'completed')
    }, 15000)

    const bobConnections = await bob.agent.modules.didcomm.connections.getAll()
    bobAliceConnectionId = bobConnections[0].id
    bob.connectionRecordId = bobAliceConnectionId

    await waitForCondition(async () => {
      return !!alice.getIssuerDid() && !!bob.getIssuerDid()
    }, 15000)

    const aliceIssuerDid = alice.getIssuerDid()
    const bobIssuerDid = bob.getIssuerDid()
    if (!aliceIssuerDid) throw new Error('Alice issuer DID not initialized after acceptConnection')
    if (!bobIssuerDid) throw new Error('Bob issuer DID not initialized after connection completed')

    await bob.agent.modules.didcomm.basicMessages.sendMessage(bobAliceConnectionId, JSON.stringify({ rDid: bobIssuerDid }))
    await alice.agent.modules.didcomm.basicMessages.sendMessage(aliceBobConnectionId, JSON.stringify({ rDid: aliceIssuerDid }))
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await waitForCondition(async () => {
      return alice.hasCounterpartyRDid() && bob.getCounterpartyRDid(bobAliceConnectionId) !== undefined
    }, 10000)

    const witnessAliceInvite = await witness.createConnectionInvitation()
    await alice.acceptConnection(witnessAliceInvite)

    await Promise.race([
      waitForCondition(async () => {
        const aliceConns = await alice.agent.modules.didcomm.connections.getAll()
        return aliceConns.length >= 2
      }, 10000),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Alice-Witness connection timeout')), 15000)),
    ])

    let witnessConnections = await witness.agent.modules.didcomm.connections.getAll()
    aliceWitnessConnectionId = witnessConnections[0].id

    const aliceConns = await alice.agent.modules.didcomm.connections.getAll()
    aliceConnectionToWitness = aliceConns.find((c) => c.id !== aliceBobConnectionId)!.id

    const witnessBobInvite = await witness.createConnectionInvitation()
    const { connectionRecord: bobWitnessConn } = await bob.agent.modules.didcomm.oob.receiveInvitationFromUrl(
      witnessBobInvite,
      { label: 'bob' }
    )

    await Promise.race([
      bob.agent.modules.didcomm.connections.returnWhenIsConnected(bobWitnessConn!.id),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Bob-Witness connection timeout')), 15000)),
    ])

    witnessConnections = await witness.agent.modules.didcomm.connections.getAll()
    bobWitnessConnectionId = witnessConnections.find((c) => c.id !== aliceWitnessConnectionId)!.id

    const bobConns = await bob.agent.modules.didcomm.connections.getAll()
    bobConnectionToWitness = bobConns.find((c) => c.id !== bobAliceConnectionId)!.id
  }, 60000)

  afterEach(async () => {
    await cleanupAgents(alice, bob, witness)
  }, 15000)

  it(
    'captures a full 5-phase witnessed VRC exchange',
    async () => {
      // Phase 1 — session creation
      const {
        sessionId,
        challenge: sessionChallenge,
        domain: sessionDomain,
      } = await witness.createWitnessedSession(aliceWitnessConnectionId, bobWitnessConnectionId)

      // Phase 2 — credential creation & wrapping
      const aliceRDid = bob.getCounterpartyRDid(bobAliceConnectionId)
      const bobRDid = alice.getAnyCounterpartyRDid()
      if (!aliceRDid) throw new Error('Bob does not have Alice R-DID')
      if (!bobRDid) throw new Error('Alice does not have Bob R-DID')

      // createAndSubmitPresentation returns the raw VRC it minted — this is
      // the only place the VRC is observable pre-witnessing; a self-issued
      // VRC targeting a counterparty is never stored in one's own
      // w3cCredentials wallet (it's submitted inside a VP, not offered via
      // the credential-exchange protocol), matching the original capture's
      // "(minted, submitted in VP)" holder notes.
      const { vrc: bobVrcJson } = await bob.createAndSubmitPresentation(
        bobConnectionToWitness,
        aliceRDid,
        'alice',
        sessionChallenge,
        sessionDomain
      )
      const { vrc: aliceVrcJson } = await alice.createAndSubmitPresentation(
        aliceConnectionToWitness,
        bobRDid,
        'bob',
        sessionChallenge,
        sessionDomain
      )
      await new Promise((resolve) => setTimeout(resolve, 2000))

      await waitForCondition(async () => {
        const count = witness.getSessionPresentationCount(sessionId)
        const sessionExists = witness.getSessionData(sessionId) !== undefined
        return count >= 2 || !sessionExists
      }, 20000)

      // Phase 3/4 — witness verification, VWC minting & distribution
      const sessionData = witness.getSessionData(sessionId)
      if (sessionData) {
        await witness.issueWitnessCredentials(sessionId)
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))

      // Phase 5 — both wallets accept their VWC offers and hold final state
      await waitForCondition(async () => {
        const a = await alice.agent.modules.didcomm.credentials.getAll()
        const b = await bob.agent.modules.didcomm.credentials.getAll()
        return a.some((r) => r.state === 'offer-received') && b.some((r) => r.state === 'offer-received')
      }, 20000)
      await alice.acceptPendingCredentialOffers()
      await bob.acceptPendingCredentialOffers()
      await waitForCondition(async () => {
        const a = await alice.agent.w3cCredentials.getAll()
        const b = await bob.agent.w3cCredentials.getAll()
        return a.some((r) => (r as any).firstCredential) && b.some((r) => (r as any).firstCredential)
      }, 30000)

      const aliceCredentials = await alice.agent.w3cCredentials.getAll()
      const bobCredentials = await bob.agent.w3cCredentials.getAll()

      const jsonOf = (r: any) => JsonTransformer.toJSON(r.firstCredential) as any
      const findByType = (records: any[], type: string) =>
        records.find((r) => jsonOf(r).type?.includes(type))

      // The VWC IS a received/accepted credential, so it's found in wallet storage.
      const aliceVwcRecord = findByType(aliceCredentials, 'WitnessCredential')
      const bobVwcRecord = findByType(bobCredentials, 'WitnessCredential')

      expect(aliceVwcRecord).toBeDefined()
      expect(bobVwcRecord).toBeDefined()

      const aliceVwcJson = jsonOf(aliceVwcRecord) // Alice holds the VWC witnessing Bob's VRC
      const bobVwcJson = jsonOf(bobVwcRecord) // Bob holds the VWC witnessing Alice's VRC

      const verify = async (agentHolder: Alice | Bob, credential: any) =>
        agentHolder.agent.w3cCredentials.verifyCredential({
          credential: JsonTransformer.fromJSON(credential, W3cJsonLdVerifiableCredential) as any,
        })

      const aliceVwcVerification = await verify(alice, aliceVwcJson)
      const bobVwcVerification = await verify(bob, bobVwcJson)

      // ------------------------------------------------------------------
      // Regression guard: the captured shape must match what Check D
      // (tsp-reference/ref-07-dtg-edge-semantics) audits against the spec.
      // ------------------------------------------------------------------
      expect(bobVrcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])
      expect(aliceVrcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])
      expect(aliceVwcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'WitnessCredential'])
      expect(bobVwcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'WitnessCredential'])
      // The witnessed halves must mutually name each other — the exact bug
      // this rung's Check D found and fixed (wrong-R-DID minting).
      expect(bobVrcJson.issuer).toBe(aliceVrcJson.credentialSubject.id)
      expect(aliceVrcJson.issuer).toBe(bobVrcJson.credentialSubject.id)
      // Each VWC's credentialSubject.id names the VRC issuer it witnesses.
      expect(aliceVwcJson.credentialSubject.id).toBe(bobVrcJson.issuer)
      expect(bobVwcJson.credentialSubject.id).toBe(aliceVrcJson.issuer)
      // KNOWN GAP (unchanged by this capture — see Check D): legacy digest
      // form, no taskContext. Asserted here so a future fix to this legacy
      // path is caught as a deliberate change, not silent drift.
      expect(typeof aliceVwcJson.credentialSubject.digest).toBe('string')
      expect(aliceVwcJson.credentialSubject.digest.startsWith('sha256:')).toBe(true)
      expect(aliceVwcJson.credentialSubject.taskContext).toBeUndefined()
      expect(aliceVwcJson.credentialSubject.witnessContext).toBeDefined()
      expect(aliceVwcVerification.isValid).toBe(true)
      expect(bobVwcVerification.isValid).toBe(true)

      if (process.env.CAPTURE_OUTPUT) {
        const captured = {
          description:
            'A REAL witnessed Keyring edge, recaptured by the rebuilt capture tool ' +
            '(bifold/packages/vrc-reference/__tests__/integration/captureWitnessedEdge.test.ts). ' +
            'Same shape as the original 2026-08-26 capture that ' +
            'tsp-reference/ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json freezes — ' +
            'this file is a throwaway, regenerable sample, not a ladder input.',
          captureMeta: {
            capturedAt: new Date().toISOString(),
            tool: 'vrc-reference (committed), __tests__/integration/captureWitnessedEdge.test.ts',
            witnessIssuerDid: witness.getIssuerDid(),
            sessionNote: 'sessionId/challenge are per-run values inside witnessContext; the digest binds the VWC to its VRC',
          },
          declaredScopes: { half1: 'pairwise', half2: 'pairwise' },
          vrcs: [
            { holder: 'bob (minted, submitted in VP)', verifiedAtCapture: 'inside witness-verified VP', credential: bobVrcJson },
            { holder: 'alice (minted, submitted in VP)', verifiedAtCapture: 'inside witness-verified VP', credential: aliceVrcJson },
          ],
          vwcs: [
            { holder: 'alice', verifiedAtCapture: aliceVwcVerification.isValid === true, credential: aliceVwcJson },
            { holder: 'bob', verifiedAtCapture: bobVwcVerification.isValid === true, credential: bobVwcJson },
          ],
        }

        const outDir = join(__dirname, 'capture-output')
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
        writeFileSync(join(outDir, 'edge-witnessed-captured.json'), JSON.stringify(captured, null, 2))
        // eslint-disable-next-line no-console
        console.log(`Captured fresh witnessed edge -> ${join(outDir, 'edge-witnessed-captured.json')}`)
      }
    },
    90000
  )
})
