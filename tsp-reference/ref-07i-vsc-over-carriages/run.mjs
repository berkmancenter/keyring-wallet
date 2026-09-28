// ref-07i — a witnessed exchange, with a VSC, over three carriages.
//
// Act 1 (DIDComm v1, live): two real Credo 0.7.1 agents (patched, per this
// branch's Credo-0.7 line) connect in-process over real v1 authcrypt, then
// run a witness/session -> session#response -> witness/session/submit ->
// submit#response ceremony (framework SPEC.md §9 step 5, the same message
// shapes bifold/packages/core/src/modules/trust-tasks/witnessCeremony.ts
// uses) whose delivered payload is a real `dtg:witnessed` VSC (plan §3's
// D1-D8 shape, not the legacy WD02 VWC shape that file still emits/reads).
// D6 (subject-issuer binding + object.digestMultibase) and the
// outcome-evidence pairing check (cred-spec, Outcome Interpretability) both
// run against the document Credo actually delivered over the real
// connection, not one this rung assembled and verified against itself.
// Every document that carries a proof is signed and verified through real
// Credo calls (`signDocumentProof`/`verifyDocumentProof`,
// `@bifold/trust-tasks/build/documentProof.js` — platform-neutral, shared
// with the witness-server, not reimplemented here).
//
// Act 2 (TSP): DEFERRED. Two real findings, not a shortcut:
//   (a) `@openvtc/vti-tsp-js`'s package.json `exports` map defines only an
//       `"import"` condition, no `"require"` — `@bifold/trust-tasks`'s own
//       compiled output is CommonJS, so requiring anything that reaches the
//       real `tsp/` module (including `@bifold/trust-tasks`'s own package
//       root) throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (reproduced: run
//       `require('@bifold/trust-tasks')` in this rung's node_modules). This
//       rung avoids the whole `tsp/` subtree by requiring
//       `documentProof.js`/`v2Binding.js`/`TrustTaskEnvelopeV2Message.js`
//       directly rather than the package root — which is exactly why Acts 1
//       and 3 work at all, and exactly why a real TSP double-wrap (which
//       needs the `tsp/` module itself) cannot.
//   (b) `tsp-reference/ref-16` through `ref-20` are cited by name in shipped
//       code (`DidCommV2Carriage.ts`'s own module comment: "measured on the
//       snapshot in tsp-reference/ref-16 (16 checks) and, through a v2
//       mediator, ref-17") as where the DIDComm v2/TSP transport plumbing
//       was proven — but none of `ref-16`..`ref-19` exist on disk (only
//       `ref-20-local-vetting`, unrelated). There is no existing rung to
//       build a live TSP-over-v1 transport from, and building the whole
//       carriage's transport plumbing from nothing is its own task, not a
//       one-line addition here.
// See this rung's README for what this leaves unproven.
//
// Act 3 (DIDComm v2): proven, without a live v2 connection — matching
// `didCommV2Carriage.test.ts`'s own documented pattern ("The Credo agent is
// faked at the container boundary... the message class itself is the real
// one"). A real `TrustTaskEnvelopeV2Message` instance (from
// `@bifold/trust-tasks`, not a stand-in) carries the same VSC-bearing
// submit#response this rung produced in Act 1, and the real, exported
// `checkV2ThreadCorrelation` (binding 0.2 §3.1) runs over it — proving the
// v2 thread-correlation rule holds for a VSC-shaped document, which is what
// changed (D4 moves `taskContext`/`taskDigestMultibase` to the top level;
// this check reads `document.threadId`/`document.parentThreadId`, so it
// never depended on where `taskContext` lives inside `credentialSubject`
// and needed no change to keep passing).
//
// Node only. No React Native imports anywhere in this rung.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { deepStrictEqual } from 'node:assert'

// Must be imported before any @credo-ts module — askar-shared snapshots its
// `askar` export for ESM importers at import time (ref-06v1's own note).
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'

import { Agent, utils } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import {
  DidCommModule,
  DidCommMessageReceiver,
  DidCommBasicMessageEventTypes,
  DidCommBasicMessagesModule,
} from '@credo-ts/didcomm'

const require = createRequire(import.meta.url)
// Deep imports, deliberately NOT the package root (`@bifold/trust-tasks`) —
// see the Act 2 comment above for why the root throws.
const { digestMultibase, taskDigestMultibase, digestBytesEqual, signDocumentProof, verifyDocumentProof, wireTimestamp } =
  require('@bifold/trust-tasks/build/documentProof.js')
const { checkV2ThreadCorrelation } = require('@bifold/trust-tasks/build/v2Binding.js')
const { TrustTaskEnvelopeV2Message } = require('@bifold/trust-tasks/build/TrustTaskEnvelopeV2Message.js')

const QUIET = process.argv.includes('--quiet')
const here = dirname(fileURLToPath(import.meta.url))
const log = (...a) => QUIET || console.log(...a)

// Real cred-spec (994a3d63) IRIs the two upstream PRs opened this session
// record — see docs/plans/vsc-migration-plan.md §2.1/§9 Q6. `ref-22`'s own
// open question (which candidate namespace to mirror) is orthogonal to this
// rung: this act is about the EXCHANGE, not which namespace wins, so the
// exact predicate IRI is not load-bearing to any check below.
const DTG_PREDICATE_WITNESSED = 'https://registry.trustoverip.org/dtg/vsc/witnessed/1'
const DTG_CONTEXT = 'https://registry.trustoverip.org/dtg/context/v1'

const SESSION_TYPE_URI = 'https://trusttasks.org/spec/witness/session/0.1'
const SESSION_RESPONSE_TYPE_URI = 'https://trusttasks.org/spec/witness/session/0.1#response'
const SUBMIT_TYPE_URI = 'https://trusttasks.org/spec/witness/session/submit/0.1'
const SUBMIT_RESPONSE_TYPE_URI = 'https://trusttasks.org/spec/witness/session/submit/0.1#response'
const ERROR_TYPE_MARKER = '/trust-task-error/'

let checks = 0
let failures = 0
function check(name, fn) {
  try {
    fn()
    checks++
    log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.error(`  ✗ ${name}\n    ${e.message}`)
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    checks++
    log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.error(`  ✗ ${name}\n    ${e.stack || e.message}`)
  }
}

// ---------------------------------------------------------------- setup ----

const peers = new Map()
class InProcOutboundTransport {
  supportedSchemes = ['inproc']
  async start() {}
  async stop() {}
  async sendMessage(outboundPackage) {
    const peer = peers.get(outboundPackage.endpoint)
    if (!peer) throw new Error(`no in-proc peer at ${outboundPackage.endpoint}`)
    const receiver = peer.dependencyManager.resolve(DidCommMessageReceiver)
    await receiver.receiveMessage(outboundPackage.payload, {})
  }
}

async function makeAgent(name) {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref07i-${name}-${Date.now()}-${Math.random()}`, key: `ref07i-testkey-${name}` },
      }),
      didcomm: new DidCommModule({
        endpoints: [`inproc://${name}`],
        connections: { autoAcceptConnections: true },
      }),
      basicMessages: new DidCommBasicMessagesModule(),
    },
  })
  agent.modules.didcomm.registerOutboundTransport(new InProcOutboundTransport())
  await agent.initialize()
  peers.set(`inproc://${name}`, agent)
  return agent
}

async function connect(inviterAgent, inviterLabel, inviteeAgent, inviteeLabel) {
  const invitation = await inviterAgent.modules.didcomm.oob.createInvitation({ label: inviterLabel })
  const { connectionRecord } = await inviteeAgent.modules.didcomm.oob.receiveInvitation(
    invitation.outOfBandInvitation,
    { label: inviteeLabel }
  )
  const inviteeConn = await inviteeAgent.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id)
  const [inviterConnPending] = await inviterAgent.modules.didcomm.connections.findAllByOutOfBandId(invitation.id)
  const inviterConn = await inviterAgent.modules.didcomm.connections.returnWhenIsConnected(inviterConnPending.id)
  return { inviterConn, inviteeConn }
}

/** Carry one Trust Task document as a real v1 DidCommBasicMessage, real authcrypt, real send. */
async function sendDocument(fromAgent, connectionId, document) {
  await fromAgent.modules.basicMessages.sendMessage(connectionId, JSON.stringify(document))
}

/** Await the next basic message on a connection and parse it back into a document. */
function awaitDocument(toAgent, connectionId, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      toAgent.events.off(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, listener)
      reject(new Error(`timed out awaiting a document on connection ${connectionId}`))
    }, timeoutMs)
    function listener(event) {
      const record = event.payload?.basicMessageRecord
      if (!record || record.connectionId !== connectionId || record.role !== 'receiver') return
      toAgent.events.off(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, listener)
      clearTimeout(timer)
      try {
        resolve(JSON.parse(record.content))
      } catch (e) {
        reject(new Error(`inbound basic message was not a JSON document: ${e.message}`))
      }
    }
    toAgent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, listener)
  })
}

// ----------------------------------------------------------- VSC builder ----

/**
 * Build a `dtg:witnessed` VSC per plan §3's D1-D8 shape (NOT the WD02 shape
 * witnessCeremony.ts still emits/reads): `taskContext`/`taskDigestMultibase`
 * at the TOP level (D4), `credentialSubject.predicate` (D2),
 * `credentialSubject.object.digestMultibase` (D3), `credentialSubject.id`
 * set to the referenced VRC's issuer (D6 — this rung's whole point is that a
 * verifier holding the VRC checks this, not merely that the witness sets it
 * right).
 */
function buildVsc({ witnessDid, sessionDoc, vrc }) {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT],
    type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
    issuer: witnessDid,
    validFrom: wireTimestamp(),
    taskContext: sessionDoc.id,
    taskDigestMultibase: taskDigestMultibase(sessionDoc),
    credentialSubject: {
      id: vrc.issuer,
      predicate: DTG_PREDICATE_WITNESSED,
      object: { digestMultibase: taskDigestMultibase(vrc) },
      witnessContext: { event: 'ref-07i', sessionId: sessionDoc.id, method: 'in-process-test' },
    },
  }
}

/** D6: the wallet-side check nothing in the codebase runs today (plan §3.2, §3.3). */
function checkD6(vsc, vrc) {
  const subject = vsc.credentialSubject
  if (subject.id !== vrc.issuer) {
    throw new Error(`D6 fails: credentialSubject.id (${subject.id}) !== referenced VRC's issuer (${vrc.issuer})`)
  }
  if (!digestBytesEqual(subject.object.digestMultibase, taskDigestMultibase(vrc))) {
    throw new Error('D6 fails: object.digestMultibase does not reproduce over the referenced VRC')
  }
}

/**
 * Outcome-evidence pairing (cred-spec, Outcome Interpretability), adapted
 * for the VSC's top-level taskContext/taskDigestMultibase placement — the
 * plan's finding A5: outcomeEvidence.ts:71/227 and witnessCeremony.ts:169
 * all read these from `credentialSubject` today (WD02 placement), which is
 * a standing conformance gap independent of this migration. This function
 * is what the migrated version should do.
 */
async function checkOutcomeEvidencePairing({ vsc, initiating, terminal, verifierAgent, terminalController }) {
  const failures = []
  const taskContext = vsc.taskContext
  const taskDigest = vsc.taskDigestMultibase
  if (!taskContext) failures.push('credential carries no taskContext')
  if (!taskDigest) failures.push('credential carries no taskDigestMultibase')
  if (taskContext && String(initiating.id ?? '') !== taskContext) {
    failures.push('initiating document id does not equal taskContext')
  }
  if (taskDigest && !digestBytesEqual(taskDigest, taskDigestMultibase(initiating))) {
    failures.push('taskDigestMultibase does not reproduce over the initiating document')
  }
  const expectedThread = String(initiating.threadId ?? initiating.id ?? '')
  if (String(terminal.threadId ?? '') !== expectedThread) {
    failures.push('terminal document threadId does not pair with the initiating document')
  }
  const terminalType = String(terminal.type ?? '')
  if (terminalType.includes(ERROR_TYPE_MARKER)) {
    failures.push('terminal document is an error response — failure evidence, not completion')
  } else if (!terminalType.endsWith('#response')) {
    failures.push('terminal document is not a success response')
  }
  if (terminal.proof === undefined) {
    failures.push('terminal document carries no proof — outcome evidence must be integrity-protected')
  } else if (!(await verifyDocumentProof(verifierAgent, terminal, terminalController))) {
    failures.push('terminal document proof did not verify under its issuer')
  }
  if (failures.length) throw new Error(`outcome-evidence pairing failed: ${failures.join('; ')}`)
}

// ---------------------------------------------------------------- Act 1 ----

async function actOne() {
  log('\n— Act 1: witnessed exchange over real DIDComm v1, VSC-shaped —')
  const wendy = await makeAgent('wendy') // the witness
  const bob = await makeAgent('bob') // the subject being witnessed

  try {
    const { inviterConn: wendyConn, inviteeConn: bobConn } = await connect(wendy, 'wendy', bob, 'bob')
    log(`  · v1 connection up (bob theirDid ${bobConn.theirDid}, wendy theirDid ${wendyConn.theirDid})`)

    check('a real v1 connection exists on both sides, mutually authenticated', () => {
      if (!bobConn.theirDid) throw new Error('bob has no theirDid')
      if (!wendyConn.theirDid) throw new Error('wendy has no theirDid')
      deepStrictEqual(bobConn.theirDid, wendyConn.did)
      deepStrictEqual(wendyConn.theirDid, bobConn.did)
    })

    const vrc = JSON.parse(readFileSync(join(here, 'fixtures', 'captured-vrc.json'), 'utf8'))

    // ---- open the session (bob -> wendy), unsigned per SPEC (isProofRequired: false) ----
    const sessionId = utils.uuid()
    const exchangeId = utils.uuid()
    const sessionDoc = {
      id: sessionId,
      type: SESSION_TYPE_URI,
      threadId: sessionId,
      parentThreadId: exchangeId,
      issuer: bobConn.did,
      recipient: bobConn.theirDid,
      issuedAt: wireTimestamp(),
      payload: { parties: [vrc.issuer, vrc.credentialSubject.id] },
    }
    const challengeWait = awaitDocument(wendy, wendyConn.id)
    await sendDocument(bob, bobConn.id, sessionDoc)
    const sessionChallengeDoc = await challengeWait
    log(`  · session opened (${sessionId}), wendy received it over v1`)

    // ---- wendy issues the challenge, SIGNED (RESPONSE_SPEC.isProofRequired: true) ----
    const rawChallengeDoc = {
      id: utils.uuid(),
      type: SESSION_RESPONSE_TYPE_URI,
      threadId: sessionId,
      parentThreadId: exchangeId,
      issuer: wendyConn.did,
      recipient: wendyConn.theirDid,
      issuedAt: wireTimestamp(),
      payload: { challenge: utils.uuid(), domain: 'ref-07i.example' },
    }
    const challengeDoc = await signDocumentProof(wendy, rawChallengeDoc, wendyConn.did)
    const submitWait = awaitDocument(bob, bobConn.id)
    await sendDocument(wendy, wendyConn.id, challengeDoc)
    const receivedChallengeDoc = await submitWait
    log('  · session challenge issued and delivered, signed under wendy\'s connection DID')

    await checkAsync('challenge document proof verifies under the witness DID', async () => {
      if (!(await verifyDocumentProof(bob, receivedChallengeDoc, bobConn.theirDid))) {
        throw new Error('challenge proof did not verify')
      }
    })

    // ---- bob submits, SIGNED (SPEC.isProofRequired: true) — vp left opaque per schema ----
    const rawSubmitDoc = {
      id: utils.uuid(),
      type: SUBMIT_TYPE_URI,
      threadId: sessionId,
      parentThreadId: exchangeId,
      issuer: bobConn.did,
      recipient: bobConn.theirDid,
      issuedAt: wireTimestamp(),
      payload: { vp: { challenge: receivedChallengeDoc.payload.challenge, domain: receivedChallengeDoc.payload.domain } },
    }
    const submitDoc = await signDocumentProof(bob, rawSubmitDoc, bobConn.did)
    const vwcWait = awaitDocument(wendy, wendyConn.id)
    await sendDocument(bob, bobConn.id, submitDoc)
    const receivedSubmitDoc = await vwcWait
    log('  · presentation submitted and delivered, signed under bob\'s connection DID')

    await checkAsync('submit document proof verifies under the subject DID', async () => {
      if (!(await verifyDocumentProof(wendy, receivedSubmitDoc, wendyConn.theirDid))) {
        throw new Error('submit proof did not verify')
      }
    })

    // ---- wendy delivers the VSC, SIGNED — this is the document D6/outcome-evidence run against ----
    const vsc = buildVsc({ witnessDid: wendyConn.did, sessionDoc, vrc })
    const rawVwcResponseDoc = {
      id: utils.uuid(),
      type: SUBMIT_RESPONSE_TYPE_URI,
      threadId: sessionId,
      parentThreadId: exchangeId,
      issuer: wendyConn.did,
      recipient: wendyConn.theirDid,
      issuedAt: wireTimestamp(),
      payload: { vwc: vsc, vwcDigestMultibase: digestMultibase(vsc) },
    }
    const vwcResponseDoc = await signDocumentProof(wendy, rawVwcResponseDoc, wendyConn.did)
    const finalWait = awaitDocument(bob, bobConn.id)
    await sendDocument(wendy, wendyConn.id, vwcResponseDoc)
    const deliveredVwcResponseDoc = await finalWait
    log('  · VSC delivered over the real v1 connection, signed under wendy\'s connection DID')

    let deliveredVsc
    await checkAsync('submit#response proof verifies under the witness DID', async () => {
      if (!(await verifyDocumentProof(bob, deliveredVwcResponseDoc, bobConn.theirDid))) {
        throw new Error('submit#response proof did not verify')
      }
    })
    check('vwcDigestMultibase matches the delivered VSC bytes', () => {
      deliveredVsc = deliveredVwcResponseDoc.payload.vwc
      if (!digestBytesEqual(deliveredVwcResponseDoc.payload.vwcDigestMultibase, digestMultibase(deliveredVsc))) {
        throw new Error('vwcDigestMultibase does not match the delivered VSC')
      }
    })

    check('D6: credentialSubject.id equals the referenced VRC\'s issuer, and the digest reproduces (real, delivered document)', () => {
      checkD6(deliveredVsc, vrc)
    })

    check('D6 negative case: a VSC whose subject is NOT the VRC issuer is caught', () => {
      const tampered = { ...deliveredVsc, credentialSubject: { ...deliveredVsc.credentialSubject, id: 'did:key:zNotTheIssuer' } }
      let threw = false
      try {
        checkD6(tampered, vrc)
      } catch {
        threw = true
      }
      if (!threw) throw new Error('D6 did not reject a subject that is not the VRC issuer')
    })

    await checkAsync('outcome-evidence pairing: initiating + terminal documents pair, over the real delivered documents', async () => {
      await checkOutcomeEvidencePairing({
        vsc: deliveredVsc,
        initiating: sessionChallengeDoc.type ? sessionDoc : sessionDoc, // the session request bob actually sent
        terminal: deliveredVwcResponseDoc,
        verifierAgent: bob,
        terminalController: bobConn.theirDid,
      })
    })

    await checkAsync('outcome-evidence negative case: a mismatched initiating document is rejected', async () => {
      const wrongInitiating = { ...sessionDoc, id: utils.uuid() }
      let threw = false
      try {
        await checkOutcomeEvidencePairing({
          vsc: deliveredVsc,
          initiating: wrongInitiating,
          terminal: deliveredVwcResponseDoc,
          verifierAgent: bob,
          terminalController: bobConn.theirDid,
        })
      } catch {
        threw = true
      }
      if (!threw) throw new Error('pairing did not reject a mismatched initiating document')
    })

    return { vsc: deliveredVsc, initiating: sessionDoc, terminal: deliveredVwcResponseDoc }
  } finally {
    await wendy.shutdown()
    await bob.shutdown()
  }
}

// ---------------------------------------------------------------- Act 3 ----

function actThree({ terminal }) {
  log('\n— Act 3: the same submit#response, over DIDComm v2\'s thread-correlation rule —')
  log('  (Credo faked at the container boundary, per didCommV2Carriage.test.ts\'s own pattern —')
  log('   no live v2 connection: see this rung\'s README and the Act 2 comment for why)')

  check('agreeing v2 headers pass (real TrustTaskEnvelopeV2Message, real checkV2ThreadCorrelation)', () => {
    const message = new TrustTaskEnvelopeV2Message({ document: terminal })
    message.setThread({ threadId: terminal.threadId })
    const verdict = checkV2ThreadCorrelation(message, terminal)
    if (verdict !== 'ok') throw new Error(`expected 'ok', got '${verdict}'`)
  })

  check('a disagreeing v2 thid is rejected (malformedRequest:thid)', () => {
    const message = new TrustTaskEnvelopeV2Message({ document: terminal })
    message.setThread({ threadId: 'not-the-real-thread-id' })
    const verdict = checkV2ThreadCorrelation(message, terminal)
    if (verdict !== 'malformedRequest:thid') throw new Error(`expected 'malformedRequest:thid', got '${verdict}'`)
  })

  check('a conforming producer that omits thid entirely is never falsely rejected', () => {
    const message = new TrustTaskEnvelopeV2Message({ document: terminal })
    const verdict = checkV2ThreadCorrelation(message, terminal)
    if (verdict !== 'ok') throw new Error(`expected 'ok', got '${verdict}'`)
  })
}

// ---------------------------------------------------------------- Act 2 ----

function actTwoDeferred() {
  log('\n— Act 2: TSP — DEFERRED, not attempted —')
  log('  (a) @openvtc/vti-tsp-js\'s package.json exports only an "import" condition, no')
  log('      "require" — reproduced: node -e "require(\'@bifold/trust-tasks\')" in this rung\'s')
  log('      own node_modules throws ERR_PACKAGE_PATH_NOT_EXPORTED.')
  log('  (b) tsp-reference/ref-16 through ref-19 are cited by DidCommV2Carriage.ts\'s own module')
  log('      comment as where this was measured, but do not exist on disk (checked this session).')
  log('  See README.md.')
}

async function main() {
  log('ref-07i — VSC witnessed exchange over three carriages\n')
  const { vsc, initiating, terminal } = await actOne()
  actThree({ terminal })
  actTwoDeferred()

  console.log(`\n=== ref-07i done · ${checks} checks, ${failures} failure(s) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL', e.stack || e)
  process.exit(1)
})
