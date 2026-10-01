import { JsonTransformer, W3cJsonLdVerifiableCredential } from '@credo-ts/core'
import { DidCommAutoAcceptCredential } from '@credo-ts/didcomm'
import { getMirroredJsonLdProofOptions } from '@bifold/vrc-shared'
import { taskDigestMultibase } from '@bifold/trust-tasks'
import { DTG_PREDICATE_WITNESSED } from '@bifold/dtg-vocab'
// The REAL production `vsc`-shape builder — imported from witness-server's
// lightweight credentialBuilder module (extracted 2026-09-29, capture-harness
// task), NOT re-implemented here. Deep import bypasses witness-server's
// `main` (dist/index.js -> WitnessService.ts), which pulls in its CLI/server
// dependency tree (langchain, node-ble, three, ws) that this test has no
// business depending on.
import { buildWitnessCredentialJson } from '@bifold/witness-server/dist/credentialBuilder'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import { Alice } from '../../src/Alice'
import { Bob } from '../../src/Bob'
import { Witness } from '../../src/Witness'
import { buildAlice, buildBob, buildWitness, cleanupAgents, waitForCondition } from '../helpers/testUtils'

/**
 * ============================================================================
 * CAPTURE TOOL — a REAL `vsc`-shaped witnessed edge
 * ============================================================================
 *
 * Companion to `captureWitnessedEdge.test.ts` (the frozen `wd02` regression
 * guard). That test's known limitation, unresolved since 2026-08-26: this
 * reference implementation's own `Witness.buildWitnessCredential` is a
 * separate, hardcoded legacy builder that never reads `WITNESS_CREDENTIAL_SHAPE`
 * and cannot emit `vsc` shape — so no fresh `vsc`-shaped capture had ever been
 * produced (docs/plans/vsc-migration-plan/2026-09-27-bm.md, item 6;
 * 2026-09-29-bm.md, item 2).
 *
 * This test closes that gap WITHOUT touching Witness.ts (so
 * captureWitnessedEdge.test.ts's wd02 regression guard is byte-for-byte
 * unaffected): it runs the identical 5-phase flow — real Askar-backed Credo
 * agents, real DIDComm connections, real session challenge/domain, real
 * VP-wrapped VRCs submitted to and verified by the real `Witness` class — and
 * then, instead of calling `witness.issueWitnessCredentials()` (which calls
 * the reference impl's own hardcoded builder), builds each VWC's JSON by
 * calling the REAL production function, `witness-server`'s
 * `buildWitnessCredentialJson(presentation, { ..., shape: 'vsc' })` —
 * imported as a library, not re-implemented — then signs it with the SAME
 * Credo API (`agent.w3cCredentials.signCredential`) and DIDComm
 * credential-issuance pipeline (`credentials.offerCredential` /
 * `acceptPendingCredentialOffers`) the wd02 capture already proves works,
 * and independently verifies it with the HOLDER's own Credo agent
 * (`agent.w3cCredentials.verifyCredential`) — exactly as
 * captureWitnessedEdge.test.ts does for wd02.
 *
 * IMPLEMENTATION NOTE on how the swap happens without touching Witness.ts:
 * `Witness`'s own basic-message handler (`registerBasicMessageHandler`)
 * unconditionally auto-calls `this.issueWitnessCredentials(sessionId)` the
 * instant a session reaches 2 verified presentations — there is no window
 * for a test to "beat it there" and mint from the outside. So this test
 * monkey-patches `witness.issueWitnessCredentials` on the INSTANCE (not the
 * class/source) to `issueVscWitnessCredentials` below, before Phase 2 starts.
 * The real internal auto-issuance flow then calls this override instead of
 * `Witness.prototype.issueWitnessCredentials` (the hardcoded legacy
 * builder) — same trigger, same session data, same cross-distribution
 * logic, only the credential-building call swapped for the real one.
 *
 * Every field of the resulting credentialSubject is therefore attributable
 * to a specific, real line of `buildWitnessCredentialJson`'s `shape === 'vsc'`
 * branch (witness-server/src/credentialBuilder.ts) — not hand-constructed
 * JSON mimicking the shape:
 *   - `predicate`              -> `DTG_PREDICATE_WITNESSED` (@bifold/dtg-vocab)
 *   - `object.digestMultibase` -> `taskDigestMultibase(vrcJson)` (@bifold/trust-tasks)
 *   - `witnessContext`         -> { sessionId, method, event? }
 *   - `witnessName`            -> the witness's display name
 *   - `hardwareAttestationIncluded` -> whether the observed VRC carried evidence
 *   - `issuerScope: 'directed'`, `type: [..., 'StatementCredential']`,
 *     `issuer` as a bare string, VC 2.0 `@context`/`validFrom`/`validUntil`
 *     -> all emitted unconditionally by the same function.
 *
 * Runs entirely in-process (no live witness-server process, no mediator) —
 * nothing here needs live infra, same as captureWitnessedEdge.test.ts.
 *
 * By default this only asserts the captured shape is stable (a regression
 * guard, safe for a normal `yarn test` run). Set CAPTURE_OUTPUT=1 to also
 * write a fresh capture to
 * `capture-output/edge-witnessed-vsc-captured.json` (gitignored, matching
 * the wd02 capture's own convention) — a throwaway artifact for manual
 * inspection, not a ladder input; the ladder's frozen fixture
 * (tsp-reference/ref-07-dtg-edge-semantics/fixtures/edge-witnessed-vsc-captured.json)
 * is a one-time freeze of this same output, committed separately.
 *
 * KNOWN GAP, deliberately NOT fixed here (docs/plans/vsc-migration-plan/2026-09-27-bm.md
 * item 10 / 2026-09-29-bm.md item 4): the legacy basicmessage-dialect
 * `buildWitnessCredentialJson` — the SAME function this test calls — emits
 * no `taskContext`/`taskDigestMultibase`-at-top-level for `vsc` shape either;
 * only the newer Trust Tasks ceremony path (`WitnessTaskSessions.ts`) does.
 * This capture demonstrates that gap is real and persists under `vsc` shape
 * too, not just `wd02` — see the assertion below.
 */
/**
 * Replaces `Witness.prototype.issueWitnessCredentials` on a single instance
 * (see the file header's IMPLEMENTATION NOTE). Same trigger (the basic-message
 * handler's auto-issue), same session data, same cross-distribution logic as
 * the original — the only change is calling the REAL production
 * `buildWitnessCredentialJson(..., { shape: 'vsc' })` instead of `this`'s own
 * hardcoded `buildWitnessCredential`.
 */
async function issueVscWitnessCredentials(this: Witness, sessionId: string): Promise<void> {
  const sessionData = this.getSessionData(sessionId)
  if (!sessionData) {
    throw new Error(`Session ${sessionId} not found`)
  }
  if (sessionData.receivedPresentations.size !== 2) {
    throw new Error(
      `Session ${sessionId} incomplete: received ${sessionData.receivedPresentations.size}/2 presentations`
    )
  }

  const witnessIssuerDid = this.getIssuerDid()
  if (!witnessIssuerDid) throw new Error('Witness issuer DID not initialized')

  const participantIds = Array.from(sessionData.participants)
  const presentationEntries = Array.from(sessionData.receivedPresentations.entries())

  // Cross-distribution, same as the original Witness.issueWitnessCredentials:
  // the VWC about one participant's VRC goes to the OTHER participant.
  for (const [senderConnectionId, presentation] of presentationEntries) {
    const recipientConnectionId = participantIds.find((id) => id !== senderConnectionId)
    if (!recipientConnectionId) throw new Error(`Could not find recipient for VWC from ${senderConnectionId}`)

    // THE REAL PRODUCTION CALL — every field of the returned JSON is
    // computed by witness-server/src/credentialBuilder.ts's `shape ===
    // 'vsc'` branch, not by this test.
    const vscCredentialJson = buildWitnessCredentialJson(presentation, {
      issuerDid: witnessIssuerDid,
      witnessName: this.name,
      sessionId,
      verificationMethod: 'session-based-challenge',
      shape: 'vsc',
    })

    // Mirror the observed VRC's proof family (production does the same at
    // the offer site) — deliver over the real DIDComm credential-issuance
    // protocol, same as the wd02 capture, so the holder's own wallet accepts
    // and stores it, not just a directly-signed object. Credo resolves the
    // signing verification method from the credential's own `issuer` DID —
    // no explicit verificationMethod needed here (the original
    // Witness.issueWitnessCredentials doesn't pass one either).
    const proofOptions = getMirroredJsonLdProofOptions(presentation.verifiableCredential?.[0]?.proof)

    await this.agent.modules.didcomm.credentials.offerCredential({
      connectionId: recipientConnectionId,
      protocolVersion: 'v2',
      autoAcceptCredential: DidCommAutoAcceptCredential.Always,
      credentialFormats: {
        jsonld: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          credential: vscCredentialJson as any,
          options: proofOptions,
        },
      },
    })
  }

  // Same cleanup as the original.
  ;(this as unknown as { activeSessions: Map<string, unknown> }).activeSessions.delete(sessionId)
}

describe('Capture: Witnessed Edge, vsc shape (real production builder)', () => {
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
    alice = await buildAlice(0, 'capture-vsc')
    bob = await buildBob(0, 'capture-vsc')
    witness = await buildWitness(0)
    // See the file header's IMPLEMENTATION NOTE and issueVscWitnessCredentials
    // above: swap the reference impl's hardcoded builder for the real
    // production one, on this instance only, before any session starts.
    witness.issueWitnessCredentials = issueVscWitnessCredentials.bind(witness)

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

    await bob.agent.modules.didcomm.basicMessages.sendMessage(
      bobAliceConnectionId,
      JSON.stringify({ rDid: bobIssuerDid })
    )
    await alice.agent.modules.didcomm.basicMessages.sendMessage(
      aliceBobConnectionId,
      JSON.stringify({ rDid: aliceIssuerDid })
    )
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

  it('captures a full 5-phase witnessed VRC exchange, VWC minted by the REAL production vsc builder', async () => {
    // Phase 1 — session creation (identical to the wd02 capture)
    const {
      sessionId,
      challenge: sessionChallenge,
      domain: sessionDomain,
    } = await witness.createWitnessedSession(aliceWitnessConnectionId, bobWitnessConnectionId)
    const witnessIssuerDid = witness.getIssuerDid()
    if (!witnessIssuerDid) throw new Error('Witness issuer DID not initialized')

    // Phase 2 — credential creation & wrapping (identical to the wd02 capture)
    const aliceRDid = bob.getCounterpartyRDid(bobAliceConnectionId)
    const bobRDid = alice.getAnyCounterpartyRDid()
    if (!aliceRDid) throw new Error('Bob does not have Alice R-DID')
    if (!bobRDid) throw new Error('Alice does not have Bob R-DID')

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

    // The witness's REAL verifyPresentation ran on both VPs (via the basic-message
    // handler, same as wd02) — wait for both to land in its session store.
    await waitForCondition(async () => {
      const count = witness.getSessionPresentationCount(sessionId)
      const sessionExists = witness.getSessionData(sessionId) !== undefined
      return count >= 2 || !sessionExists
    }, 20000)

    // Phase 3/4 — VWC minting happened automatically: Witness's own
    // basic-message handler auto-called `issueWitnessCredentials` the
    // instant it saw 2 verified presentations (the waitForCondition above
    // already confirms this completed — the session is gone). That call
    // resolved to `issueVscWitnessCredentials` (patched onto this instance
    // in beforeEach), which built each VWC with the REAL production
    // `buildWitnessCredentialJson(..., { shape: 'vsc' })` and delivered it
    // over the real DIDComm credential-issuance protocol. Nothing left to
    // do here but wait for delivery.

    // Phase 5 — both wallets accept their VWC offers and hold final state
    // (identical mechanics to the wd02 capture).
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
    const findByType = (records: any[], type: string) => records.find((r) => jsonOf(r).type?.includes(type))

    // vsc shape's type is ['VerifiableCredential', 'DTGCredential', 'StatementCredential']
    // — no 'WitnessCredential' member (D1: no concrete DTGCredential subtype
    // other than StatementCredential). Distinguish from the VRCs (also
    // DTGCredential) by looking for StatementCredential specifically.
    const aliceVwcRecord = findByType(aliceCredentials, 'StatementCredential')
    const bobVwcRecord = findByType(bobCredentials, 'StatementCredential')

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
    // Regression guard: the captured vsc shape must match what
    // buildWitnessCredentialJson's `shape === 'vsc'` branch actually emits,
    // and must independently verify under Credo's real signing/verification
    // path — the same bar the wd02 capture holds itself to.
    // ------------------------------------------------------------------
    expect(bobVrcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])
    expect(aliceVrcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])
    expect(aliceVwcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'StatementCredential'])
    expect(bobVwcJson.type).toEqual(['VerifiableCredential', 'DTGCredential', 'StatementCredential'])
    // issuer is a bare string in vsc shape (D... / the `issuer`-string fix).
    expect(typeof aliceVwcJson.issuer).toBe('string')
    expect(aliceVwcJson.issuer).toBe(witnessIssuerDid)
    expect(bobVwcJson.issuer).toBe(witnessIssuerDid)
    // issuerScope (cred-spec #68, REQUIRED): the profile's stated minimum.
    expect(aliceVwcJson.issuerScope).toBe('directed')
    expect(bobVwcJson.issuerScope).toBe('directed')
    // The witnessed halves must mutually name each other (same regression
    // guard as the wd02 capture).
    expect(bobVrcJson.issuer).toBe(aliceVrcJson.credentialSubject.id)
    expect(aliceVrcJson.issuer).toBe(bobVrcJson.credentialSubject.id)
    // Each VWC's credentialSubject.id names the VRC issuer it witnesses.
    expect(aliceVwcJson.credentialSubject.id).toBe(bobVrcJson.issuer)
    expect(bobVwcJson.credentialSubject.id).toBe(aliceVrcJson.issuer)
    // D2: predicate is the real dtg:witnessed IRI.
    expect(aliceVwcJson.credentialSubject.predicate).toBe(DTG_PREDICATE_WITNESSED)
    expect(bobVwcJson.credentialSubject.predicate).toBe(DTG_PREDICATE_WITNESSED)
    // D3: object.digestMultibase, independently recomputed here with the
    // SAME @bifold/trust-tasks function production uses (not re-derived by
    // hand) — over the witnessed VRC, excluding its own top-level proof.
    // Cross-checked against the OTHER side's VRC deliberately (Alice holds
    // the VWC witnessing BOB's VRC, and vice versa) — the exact wrong-VRC
    // binding mistake this rung's Check D was built to catch (see its
    // wrong-R-DID minting bug note) would fail this the same way it would
    // fail Check D's own digest-binding check.
    expect(aliceVwcJson.credentialSubject.object.digestMultibase).toBe(taskDigestMultibase(bobVrcJson))
    expect(bobVwcJson.credentialSubject.object.digestMultibase).toBe(taskDigestMultibase(aliceVrcJson))
    // And NOT equal to the digest of the credential it does NOT reference —
    // catches a digest that's merely well-formed but bound to the wrong VRC.
    expect(aliceVwcJson.credentialSubject.object.digestMultibase).not.toBe(taskDigestMultibase(aliceVrcJson))
    expect(bobVwcJson.credentialSubject.object.digestMultibase).not.toBe(taskDigestMultibase(bobVrcJson))
    // witnessContext keeps only the profile's three members (event absent
    // here since no WITNESS_EVENT_NAME is set for this in-process agent).
    expect(aliceVwcJson.credentialSubject.witnessContext).toEqual({
      sessionId,
      method: 'session-based-challenge',
    })
    expect(bobVwcJson.credentialSubject.witnessContext).toEqual({
      sessionId,
      method: 'session-based-challenge',
    })
    expect(aliceVwcJson.credentialSubject.witnessName).toBe(witness.name)
    expect(bobVwcJson.credentialSubject.witnessName).toBe(witness.name)
    // No real hardware attestation is possible from this in-process agent
    // (no Secure Enclave/StrongBox), so this must be deterministically
    // false, not just "some boolean".
    expect(aliceVwcJson.credentialSubject.hardwareAttestationIncluded).toBe(false)
    expect(bobVwcJson.credentialSubject.hardwareAttestationIncluded).toBe(false)
    // KNOWN GAP (unchanged by this capture — see file header and Check D):
    // this legacy-dialect builder emits no taskContext/taskDigestMultibase
    // at the top level for vsc shape either — only WitnessTaskSessions.ts's
    // Trust Tasks ceremony path does. Asserted here so a future fix is
    // caught as a deliberate change, not silent drift.
    expect(aliceVwcJson.taskContext).toBeUndefined()
    expect(aliceVwcJson.taskDigestMultibase).toBeUndefined()
    expect(bobVwcJson.taskContext).toBeUndefined()
    expect(bobVwcJson.taskDigestMultibase).toBeUndefined()
    expect(aliceVwcVerification.isValid).toBe(true)
    expect(bobVwcVerification.isValid).toBe(true)

    if (process.env.CAPTURE_OUTPUT) {
      const captured = {
        description:
          'A REAL witnessed Keyring edge, vsc shape, captured by ' +
          'bifold/packages/vrc-reference/__tests__/integration/captureWitnessedEdgeVsc.test.ts. ' +
          "Unlike edge-witnessed-captured.json (wd02 shape, this reference implementation's own " +
          'hardcoded legacy builder), every field of these VWCs was computed by the REAL production ' +
          'function, witness-server\'s buildWitnessCredentialJson(..., { shape: "vsc" }) — imported ' +
          'as a library (bifold/packages/witness-server/src/credentialBuilder.ts), not re-implemented ' +
          'here. Both VWCs were delivered over a real DIDComm credential-issuance exchange and ' +
          "independently verified by the holder's own Credo agent.",
        captureMeta: {
          capturedAt: new Date().toISOString(),
          tool: 'vrc-reference (committed), __tests__/integration/captureWitnessedEdgeVsc.test.ts',
          builderSource:
            'bifold/packages/witness-server/src/credentialBuilder.ts:buildWitnessCredentialJson (shape: "vsc")',
          witnessIssuerDid,
          sessionNote:
            'sessionId/challenge are per-run values inside witnessContext; object.digestMultibase binds the VWC to its VRC',
        },
        declaredScopes: { half1: 'pairwise', half2: 'pairwise' },
        vrcs: [
          {
            holder: 'bob (minted, submitted in VP)',
            verifiedAtCapture: 'inside witness-verified VP',
            credential: bobVrcJson,
          },
          {
            holder: 'alice (minted, submitted in VP)',
            verifiedAtCapture: 'inside witness-verified VP',
            credential: aliceVrcJson,
          },
        ],
        vwcs: [
          { holder: 'alice', verifiedAtCapture: aliceVwcVerification.isValid === true, credential: aliceVwcJson },
          { holder: 'bob', verifiedAtCapture: bobVwcVerification.isValid === true, credential: bobVwcJson },
        ],
      }

      const outDir = join(__dirname, 'capture-output')
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, 'edge-witnessed-vsc-captured.json'), JSON.stringify(captured, null, 2))
      // eslint-disable-next-line no-console
      console.log(`Captured fresh vsc-shaped witnessed edge -> ${join(outDir, 'edge-witnessed-vsc-captured.json')}`)
    }
  }, 90000)
})
