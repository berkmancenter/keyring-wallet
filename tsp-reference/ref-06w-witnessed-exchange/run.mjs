// ref-06w — the witnessed relationship exchange as DRAFT Trust Task documents.
//
// This is the appendix's raw material: the two-thread design from
// trust_tasks_subtask.md §5, run for real between three Credo agents —
// alice and bob (the relationship parties) and wendy (the witness) — using
// draft vrc/* and witness/* payloads we author here, the official
// @openvtc/trust-tasks §7.2 pipeline on every receive, and the dedicated
// @type carriage (provisional pending the binding review; the documents are
// carriage-independent, which is the point of the task layer).
//
//   EXCHANGE THREAD (id = propose.id)
//     bob → alice   vrc/relationship/propose        (mode, relationship DID)
//     alice → bob   … #response                     (accept)
//       ┌─ CEREMONY THREAD (id = witness/session.id = the VWC's taskContext)
//       │  bob → wendy  witness/session             (parentThreadId → exchange)
//       │  wendy → bob  … #response {challenge}     (proof REQUIRED)
//       │  bob → wendy  witness/session/submit {vp} (bound to challenge)
//       │  wendy → bob  … #response {vwc}           (proof REQUIRED — RETAINED:
//       └─                                           the outcome evidence)
//     alice → bob   vrc/relationship/issue {vrc}    → receipt
//     bob → alice   vrc/relationship/issue {vrc}    → receipt
//
// An unwitnessed exchange is the outer thread alone — proven as act 5.

import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { deepStrictEqual, ok } from "node:assert";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import {
  DidCommModule,
  DidCommMessage,
  DidCommMessageSender,
  DidCommMessageReceiver,
  DidCommMessageHandlerRegistry,
  DidCommOutboundMessageContext,
  parseMessageType,
  IsValidMessageType,
} from "@credo-ts/didcomm";

import { consumeInbound, respondWith, StaticTransport } from "@openvtc/trust-tasks";

const QUIET = process.argv.includes("--quiet");
const log = (...a) => QUIET || console.log(...a);

let checks = 0;
let failures = 0;
function check(name, fn) {
  try {
    fn();
    checks++;
    log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// ------------------------------------------------------ the draft specs -----
// Hand-authored spec policies for the documents the joint appendix will
// specify. URIs live under a placeholder authority on purpose: the appendix's
// namespace/slug placement is an open question (#173); nothing here squats
// trusttasks.org. Proof posture per the subtask: relationship-layer documents
// rely on authcrypt (SPEC §4.7.1 — proof OPTIONAL); the witness legs that a
// VWC's taskContext depends on declare proof REQUIRED on their responses —
// the qualifying profile.

const AUTHORITY = "https://keyring.berkmancenter.org/tt-draft";
const T = {
  propose: `${AUTHORITY}/vrc/relationship/propose/0.1`,
  session: `${AUTHORITY}/witness/session/0.1`,
  submit: `${AUTHORITY}/witness/session/submit/0.1`,
  issue: `${AUTHORITY}/vrc/relationship/issue/0.1`,
};
const DRAFT_SPECS = {
  [T.propose]: { typeUri: T.propose, isBearer: false, isProofRequired: false, isRecipientRequired: true },
  [`${T.propose}#response`]: { typeUri: `${T.propose}#response`, isBearer: false, isProofRequired: false, isRecipientRequired: true },
  [T.session]: { typeUri: T.session, isBearer: false, isProofRequired: false, isRecipientRequired: true },
  [`${T.session}#response`]: { typeUri: `${T.session}#response`, isBearer: false, isProofRequired: true, isRecipientRequired: true },
  [T.submit]: { typeUri: T.submit, isBearer: false, isProofRequired: false, isRecipientRequired: true },
  [`${T.submit}#response`]: { typeUri: `${T.submit}#response`, isBearer: false, isProofRequired: true, isRecipientRequired: true },
  [T.issue]: { typeUri: T.issue, isBearer: false, isProofRequired: false, isRecipientRequired: true },
  [`${T.issue}#response`]: { typeUri: `${T.issue}#response`, isBearer: false, isProofRequired: false, isRecipientRequired: true },
};

const NOW = () => "2026-08-11T15:00:00Z";
let errSeq = 0;
const newErrorId = () => `err-${++errSeq}`;
const STUB_PROOF = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-rdfc-2022",
  verificationMethod: "did:example:stub#key-1",
  created: NOW(),
  proofPurpose: "assertionMethod",
  proofValue: "z3StubProofValueForPipelineShapeOnly",
};

// Deterministic ids, named for readability.
const ID = {
  propose: "aaaa1111-0000-4000-8000-000000000001",
  session: "bbbb2222-0000-4000-8000-000000000002", // ← the VWC's taskContext
  submit: "cccc3333-0000-4000-8000-000000000003",
  issueAB: "dddd4444-0000-4000-8000-000000000004",
  issueBA: "eeee5555-0000-4000-8000-000000000005",
};

// ------------------------------------------------- dedicated-type carriage --

class TrustTaskMessage extends DidCommMessage {
  constructor(options) {
    super();
    if (options) {
      this.id = options.id ?? this.generateId();
      this.document = options.document;
      if (options.threadId) this.setThread({ threadId: options.threadId });
    }
  }
  type = TrustTaskMessage.type.messageTypeUri;
  static type = parseMessageType("https://trusttasks.org/didcomm-v1/1.0/task");
}
IsValidMessageType(TrustTaskMessage.type)(TrustTaskMessage.prototype, "type");

const peers = new Map();
class InProcOutboundTransport {
  supportedSchemes = ["inproc"];
  async start() {}
  async stop() {}
  async sendMessage(outboundPackage) {
    const peer = peers.get(outboundPackage.endpoint);
    if (!peer) throw new Error(`no in-proc peer at ${outboundPackage.endpoint}`);
    const receiver = peer.dependencyManager.resolve(DidCommMessageReceiver);
    await receiver.receiveMessage(outboundPackage.payload, {});
  }
}

// Every agent gets one handler and an inbox; documents are awaited by type.
async function makeAgent(name) {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref06w-${name}-${Date.now()}`, key: `ref06w-testkey-${name}` },
      }),
      didcomm: new DidCommModule({
        endpoints: [`inproc://${name}`],
        connections: { autoAcceptConnections: true },
      }),
    },
  });
  agent.modules.didcomm.registerOutboundTransport(new InProcOutboundTransport());
  await agent.initialize();
  peers.set(`inproc://${name}`, agent);
  agent.myName = name;

  const inbox = [];
  const waiters = [];
  agent.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
    supportedMessages: [TrustTaskMessage],
    handle: async (ctx) => {
      const doc = ctx.message.document;
      log(`\n      ◀── ${agent.myName} RECEIVES ${doc.type.split("/").slice(-4).join("/")}`);
      const i = waiters.findIndex((w) => w.match(doc));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(doc);
      else inbox.push(doc);
      return undefined;
    },
  });
  agent.awaitDoc = (match) => {
    const i = inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      waiters.push({ match, resolve });
      setTimeout(() => reject(new Error("timeout awaiting document")), 10000);
    });
  };
  return agent;
}

async function connect(a, b, aName, bName) {
  const invitation = await a.modules.didcomm.oob.createInvitation({ label: aName });
  const { connectionRecord } = await b.modules.didcomm.oob.receiveInvitation(
    invitation.outOfBandInvitation,
    { label: bName }
  );
  const bConn = await b.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id);
  const [aPending] = await a.modules.didcomm.connections.findAllByOutOfBandId(invitation.id);
  const aConn = await a.modules.didcomm.connections.returnWhenIsConnected(aPending.id);
  return { aConn, bConn };
}

async function send(fromAgent, connection, doc) {
  log(`\n  ──▶ ${fromAgent.myName} SENDS ${doc.type.split("/").slice(-4).join("/")}   (thread ${doc.threadId?.slice(0,8)}…${doc.parentThreadId ? `, parent ${doc.parentThreadId.slice(0,8)}…` : ""})`);
  log(JSON.stringify(doc, null, 2).split("\n").map(l => "      " + l).join("\n"));
  const sender = fromAgent.dependencyManager.resolve(DidCommMessageSender);
  await sender.sendMessage(
    new DidCommOutboundMessageContext(
      new TrustTaskMessage({ document: doc, threadId: doc.threadId ?? doc.id }),
      { agentContext: fromAgent.context, connection }
    )
  );
}

// Consume an inbound document with the §7.2 pipeline and the draft policies.
async function consume(agent, conn, doc, handler) {
  const outcome = await consumeInbound({
    transport: new StaticTransport(
      { issuer: conn.theirDid, recipient: conn.did },
      "https://trusttasks.org/binding/didcomm-v1/0.1"
    ),
    spec: DRAFT_SPECS[doc.type],
    proofPolicy: { kind: "acceptUnverified" },
    doc,
    myVid: conn.did,
    now: Date.parse(NOW()),
    newErrorId,
    handler,
  });
  if (outcome.kind !== "handled") {
    throw new Error(`pipeline rejected ${doc.type}: ${JSON.stringify(outcome.error?.payload ?? outcome.reason)}`);
  }
  return outcome.response;
}

// -------------------------------------------------------------------- run ---

log("ref-06w — the witnessed relationship exchange as draft Trust Task documents");

const alice = await makeAgent("alice");
const bob = await makeAgent("bob");
const wendy = await makeAgent("wendy");

try {
  const ab = await connect(alice, bob, "alice", "bob"); // aConn=alice's view, bConn=bob's
  const bw = await connect(wendy, bob, "wendy", "bob"); // aConn=wendy's view, bConn=bob's

  // ---- act 1: the relationship exchange opens (outer thread) ---------------
  log("\n— act 1: vrc/relationship/propose — the exchange thread opens —");
  const propose = {
    id: ID.propose,
    type: T.propose,
    threadId: ID.propose,
    issuer: ab.bConn.did,
    recipient: ab.bConn.theirDid,
    issuedAt: NOW(),
    payload: { mode: "mutual", relationshipDid: "did:peer:bob-rel", witnessed: true },
  };
  await send(bob, ab.bConn, propose);
  const proposeAtAlice = await alice.awaitDoc((d) => d.type === T.propose);
  const proposeResponse = await consume(alice, ab.aConn, proposeAtAlice, (doc) =>
    respondWith(doc, "aaaa1111-0000-4000-8000-00000000000a", {
      accept: true,
      relationshipDid: "did:peer:alice-rel",
    }, NOW)
  );
  await send(alice, ab.aConn, proposeResponse);
  const acceptAtBob = await bob.awaitDoc((d) => d.type === `${T.propose}#response`);
  check("the exchange thread opens and the acceptance continues it (threadId = propose.id)", () => {
    deepStrictEqual(acceptAtBob.threadId, ID.propose);
    deepStrictEqual(acceptAtBob.payload.accept, true);
  });

  // ---- act 2: the witness ceremony — its own thread, linked by parentThreadId
  log("\n— act 2: witness/session — the ceremony thread, nested via parentThreadId —");
  const session = {
    id: ID.session,
    type: T.session,
    threadId: ID.session,          // its own thread…
    parentThreadId: ID.propose,    // …nested in the exchange (framework §4.9.2)
    issuer: bw.bConn.did,
    recipient: bw.bConn.theirDid,
    issuedAt: NOW(),
    payload: { exchange: { parties: ["did:peer:alice-rel", "did:peer:bob-rel"] } },
  };
  await send(bob, bw.bConn, session);
  const sessionAtWendy = await wendy.awaitDoc((d) => d.type === T.session);
  const challengeResponse = await consume(wendy, bw.aConn, sessionAtWendy, (doc) => {
    const r = respondWith(doc, "bbbb2222-0000-4000-8000-00000000000b", {
      challenge: "c9d1e2f3-nonce",
      domain: "wendy.example",
    }, NOW);
    r.parentThreadId = ID.propose; // every ceremony document carries the link
    r.proof = STUB_PROOF;          // qualifying profile: proof REQUIRED on #response
    return r;
  });
  await send(wendy, bw.aConn, challengeResponse);
  const challengeAtBob = await bob.awaitDoc((d) => d.type === `${T.session}#response`);
  check("the ceremony opens its OWN thread (threadId = session.id ≠ exchange thread)", () => {
    deepStrictEqual(challengeAtBob.threadId, ID.session);
    ok(challengeAtBob.threadId !== ID.propose);
  });
  check("every ceremony document carries parentThreadId → the exchange thread", () => {
    deepStrictEqual(sessionAtWendy.parentThreadId, ID.propose);
    deepStrictEqual(challengeAtBob.parentThreadId, ID.propose);
  });

  // ---- act 3: submit under challenge; the VWC and its retained evidence ----
  log("\n— act 3: witness/session/submit — the VWC, and the outcome evidence —");
  const submit = {
    id: ID.submit,
    type: T.submit,
    threadId: ID.session,          // same ceremony thread
    parentThreadId: ID.propose,
    issuer: bw.bConn.did,
    recipient: bw.bConn.theirDid,
    issuedAt: NOW(),
    payload: {
      vp: { holder: "did:peer:bob-rel", challenge: "c9d1e2f3-nonce", domain: "wendy.example" },
    },
  };
  await send(bob, bw.bConn, submit);
  const submitAtWendy = await wendy.awaitDoc((d) => d.type === T.submit);

  // The qualifying profile has teeth on OUR draft spec too: wendy's unproofed
  // response must be rejected by bob's pipeline. Try it first.
  const unproofed = respondWith(submitAtWendy, "cccc3333-0000-4000-8000-00000000000c", {
    vwc: { type: ["VerifiableCredential", "VerifiableWitnessCredential"] },
  }, NOW);
  {
    const outcome = await consumeInbound({
      transport: new StaticTransport(
        { issuer: bw.bConn.theirDid, recipient: bw.bConn.did },
        "https://trusttasks.org/binding/didcomm-v1/0.1"
      ),
      spec: DRAFT_SPECS[`${T.submit}#response`],
      proofPolicy: { kind: "acceptUnverified" },
      doc: unproofed,
      myVid: bw.bConn.did,
      now: Date.parse(NOW()),
      newErrorId,
      handler: () => { throw new Error("must not run"); },
    });
    check("an unproofed submit#response is rejected — our draft spec qualifies for real", () => {
      deepStrictEqual(outcome.kind, "rejected");
      deepStrictEqual(outcome.error.payload.code, "proofRequired");
    });
  }

  const vwcResponse = await consume(wendy, bw.aConn, submitAtWendy, (doc) => {
    const r = respondWith(doc, "cccc3333-0000-4000-8000-00000000000d", {
      vwc: {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential", "VerifiableWitnessCredential"],
        issuer: "did:example:wendy",
        credentialSubject: {
          parties: ["did:peer:alice-rel", "did:peer:bob-rel"],
          taskContext: ID.session, // ← §4.9.1: the id of the INNERMOST exchange
        },                         //    that attests the witnessing
      },
    }, NOW);
    r.parentThreadId = ID.propose;
    r.proof = STUB_PROOF;
    return r;
  });
  await send(wendy, bw.aConn, vwcResponse);
  const evidenceAtBob = await bob.awaitDoc((d) => d.type === `${T.submit}#response`);

  // RETENTION — the A5 requirement, made concrete: bob persists this document.
  const retained = { taskContext: evidenceAtBob.payload.vwc.credentialSubject.taskContext, evidence: evidenceAtBob };

  check("the VWC's taskContext = the ceremony's initiating document id (never the outer thread)", () => {
    deepStrictEqual(evidenceAtBob.payload.vwc.credentialSubject.taskContext, ID.session);
    ok(evidenceAtBob.payload.vwc.credentialSubject.taskContext !== ID.propose);
  });

  // ---- act 4: what a THIRD-PARTY verifier checks (the ask-#5 sketch) -------
  log("\n— act 4: presentation — VWC + retained evidence, verified as a pair —");
  {
    const { taskContext, evidence } = retained;
    check("Outcome Interpretability holds: evidence pairs with the VWC by taskContext", () => {
      deepStrictEqual(evidence.threadId, taskContext);       // same ceremony thread
      deepStrictEqual(evidence.type, `${T.submit}#response`); // a terminal success form
      ok(evidence.proof, "the evidence carries its own proof");
      deepStrictEqual(evidence.payload.vwc.credentialSubject.taskContext, taskContext);
    });
    log(`  · retained evidence size: ${JSON.stringify(evidence).length} bytes (the A5 cost, per ceremony)`);
  }

  // ---- act 5: issues close the exchange; unwitnessed variant is the same minus the ceremony
  log("\n— act 5: vrc/relationship/issue both directions; witnessing is additive —");
  const issueAB = {
    id: ID.issueAB,
    type: T.issue,
    threadId: ID.propose,          // back on the exchange thread
    issuer: ab.aConn.did,
    recipient: ab.aConn.theirDid,
    issuedAt: NOW(),
    payload: { vrc: { issuer: "did:peer:alice-rel", credentialSubject: { id: "did:peer:bob-rel" } } },
  };
  await send(alice, ab.aConn, issueAB);
  const issueAtBob = await bob.awaitDoc((d) => d.type === T.issue);
  const receiptB = await consume(bob, ab.bConn, issueAtBob, (doc) =>
    respondWith(doc, "dddd4444-0000-4000-8000-00000000000e", { received: true }, NOW)
  );
  await send(bob, ab.bConn, receiptB);
  await alice.awaitDoc((d) => d.type === `${T.issue}#response`);

  const issueBA = { ...issueAB, id: ID.issueBA, issuer: ab.bConn.did, recipient: ab.bConn.theirDid,
    payload: { vrc: { issuer: "did:peer:bob-rel", credentialSubject: { id: "did:peer:alice-rel" } } } };
  await send(bob, ab.bConn, issueBA);
  const issueAtAlice = await alice.awaitDoc((d) => d.type === T.issue);
  await consume(alice, ab.aConn, issueAtAlice, (doc) =>
    respondWith(doc, "eeee5555-0000-4000-8000-00000000000f", { received: true }, NOW)
  );
  check("both issue legs ride the EXCHANGE thread and close with receipts", () => {
    deepStrictEqual(issueAtBob.threadId, ID.propose);
    deepStrictEqual(issueAtAlice.threadId, ID.propose);
  });
  check("witnessing was additive: no relationship-layer document needed the ceremony", () => {
    ok(!("parentThreadId" in propose));
    ok(!("parentThreadId" in issueAB));
  });
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
  await wendy.shutdown().catch(() => {});
}

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (witnessed relationship exchange, draft documents)`);
process.exit(0);
