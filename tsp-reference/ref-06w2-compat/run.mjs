// ref-06w2 — compatibility evidence: the recast is the same ceremony at its
// core, and the two dances can coexist.
//
//   Act 1  SHARED CORE — the REAL compiled witness-server functions
//          (computeVrcDigest, buildWitnessCredentialJson from
//          bifold/packages/witness-server/dist) driven from BOTH message
//          shapes produce a byte-identical VWC. Two dances, one crypto core,
//          one artifact.
//   Act 2  TRANSLATOR — a lossless old⇄new mapping for the three session
//          messages, with the fields that DON'T map enumerated honestly, and
//          the capability lever: rceVersion 4 = "speaks Trust Tasks".
//   Act 3  MIXED-DIALECT SESSION — one witness, one session: alice speaks
//          the legacy JSON dance, bob speaks trust-task documents, both
//          submit under the SAME challenge, both receive VWCs built by the
//          same real function, sharing one session identifier.
//
// Signal-level compatibility (Keyring is pre-production): this proves the
// levers work; it does not productionize them.

// Native binding first — askar-shared snapshots its export for ESM importers.
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { deepStrictEqual, ok } from "node:assert";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import {
  DidCommModule,
  DidCommMessage,
  DidCommBasicMessage,
  DidCommBasicMessageEventTypes,
  DidCommMessageSender,
  DidCommMessageReceiver,
  DidCommMessageHandlerRegistry,
  DidCommOutboundMessageContext,
  parseMessageType,
  IsValidMessageType,
} from "@credo-ts/didcomm";

const here = dirname(fileURLToPath(import.meta.url));
// The REAL compiled functions the production witness runs — not a copy.
const req = createRequire(import.meta.url);
const witnessCore = req(
  resolve(here, "../../bifold/packages/witness-server/dist/WitnessService.js")
);
const { computeVrcDigest, buildWitnessCredentialJson } = witnessCore;

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

// ------------------------------------------------------------- fixtures ----

const SESSION_ID = "bbbb2222-0000-4000-8000-000000000002"; // one id, both worlds (lever C)
const CHALLENGE = "c9d1e2f3-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
const DOMAIN = "wendy.example";

const vrcOf = (issuerRelDid, subjectRelDid) => ({
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://firstperson.network/credentials/dtg/v1"],
  type: ["VerifiableCredential", "DTGCredential", "RelationshipCredential"],
  issuer: issuerRelDid,
  validFrom: "2026-08-12T10:00:00Z",
  credentialSubject: { id: subjectRelDid },
  proof: { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", proofValue: "z3Stub" },
});
const vpOf = (vrc, holder) => ({
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiablePresentation"],
  holder,
  verifiableCredential: [vrc],
  proof: { type: "DataIntegrityProof", challenge: CHALLENGE, domain: DOMAIN, proofValue: "z3Stub" },
});

const VRC_A = vrcOf("did:peer:alice-rel", "did:peer:bob-rel");
const VRC_B = vrcOf("did:peer:bob-rel", "did:peer:alice-rel");

const BUILD_CTX = {
  issuerDid: "did:web:wendy.example",
  witnessName: "wendy",
  sessionId: SESSION_ID,
  verificationMethod: "remote-session",
};

const stripVolatile = (vwc) => {
  const { id, validFrom, validUntil, issuanceDate, expirationDate, ...stable } = vwc;
  return stable;
};

// ================================ ACT 1 =====================================
log("ref-06w2 — compatibility evidence (real witness-server core: dist/WitnessService.js)");
log("\n— act 1: two dances, one crypto core, one artifact —");
{
  // The LEGACY dance's view of the submission:
  const legacySubmit = { type: "submit-presentation", presentation: vpOf(VRC_B, "did:peer:bob-rel") };
  const legacySession = { sessionId: SESSION_ID, challenge: CHALLENGE, domain: DOMAIN };

  // The TRUST-TASK dance's view of the same submission:
  const taskSubmit = {
    id: "cccc3333-0000-4000-8000-000000000003",
    type: "https://keyring.berkmancenter.org/tt-draft/witness/session/submit/0.1",
    threadId: SESSION_ID,
    parentThreadId: "aaaa1111-0000-4000-8000-000000000001",
    issuer: "did:peer:bob-rel",
    recipient: "did:web:wendy.example",
    issuedAt: "2026-08-12T10:01:00Z",
    payload: { vp: vpOf(VRC_B, "did:peer:bob-rel") },
  };

  // Same core function, fed from each dance's own shape:
  const vwcFromLegacy = buildWitnessCredentialJson(legacySubmit.presentation, {
    ...BUILD_CTX,
    sessionId: legacySession.sessionId,
  });
  const vwcFromTask = buildWitnessCredentialJson(taskSubmit.payload.vp, {
    ...BUILD_CTX,
    sessionId: taskSubmit.threadId, // the session document's id — lever C
  });

  check("the REAL production functions load from witness-server/dist (not a copy)", () => {
    ok(typeof computeVrcDigest === "function" && typeof buildWitnessCredentialJson === "function");
  });
  check("both dances yield a BYTE-IDENTICAL VWC (volatile id/timestamps stripped)", () => {
    deepStrictEqual(stripVolatile(vwcFromLegacy), stripVolatile(vwcFromTask));
  });
  check("the digest is identical and is the real computeVrcDigest over JCS", () => {
    deepStrictEqual(vwcFromLegacy.credentialSubject.digest, computeVrcDigest(VRC_B));
    deepStrictEqual(vwcFromTask.credentialSubject.digest, computeVrcDigest(VRC_B));
  });
  check("the shared session identifier IS the ceremony identifier (lever C)", () => {
    deepStrictEqual(vwcFromLegacy.credentialSubject.witnessContext.sessionId, SESSION_ID);
    deepStrictEqual(vwcFromTask.credentialSubject.witnessContext.sessionId, taskSubmit.threadId);
  });
  check("today's digest encoding is sha256:hex — the cred-spec digestMultibase migration is real, and is encoding-only", () => {
    ok(vwcFromLegacy.credentialSubject.digest.startsWith("sha256:"));
  });
}

// ================================ ACT 2 =====================================
log("\n— act 2: the translator — lossless where it maps, honest where it doesn't —");

const T = {
  session: "https://keyring.berkmancenter.org/tt-draft/witness/session/0.1",
  submit: "https://keyring.berkmancenter.org/tt-draft/witness/session/submit/0.1",
};

// Fields of the legacy dance with NO home in the recast — the honest delta.
const UNMAPPED = {
  "session-request.witness": "witness *preference* — superseded by addressing the session to a chosen witness",
  "submit-presentation.reportingDid": "deferred to witness/reporting-did/register (follow-up spec)",
  "witness-announcement": "capability broadcast — future witness/announce (bearer) spec",
  "verify-credential(+response)": "separate service, out of the ceremony's scope",
  "error{event-not-started,event-ended}": "becomes trust-task-error codes with retryable semantics",
};

function legacyToTask(msg, ids) {
  switch (msg.type) {
    case "session-request":
      return {
        id: ids.sessionId, type: T.session, threadId: ids.sessionId,
        ...(ids.exchangeThreadId ? { parentThreadId: ids.exchangeThreadId } : {}),
        issuer: msg.myRelationshipDid, recipient: ids.witnessDid, issuedAt: ids.now,
        payload: { parties: [msg.myRelationshipDid, msg.counterpartyDid] },
      };
    case "session-challenge":
      return {
        id: ids.responseId, type: `${T.session}#response`, threadId: msg.sessionId,
        issuer: ids.witnessDid, recipient: ids.participantDid, issuedAt: ids.now,
        payload: { challenge: msg.challenge, domain: msg.domain },
      };
    case "submit-presentation":
      return {
        id: ids.submitId, type: T.submit, threadId: ids.sessionId,
        issuer: msg.presentation.holder, recipient: ids.witnessDid, issuedAt: ids.now,
        payload: { vp: msg.presentation },
      };
    default:
      throw new Error(`no mapping for legacy type ${msg.type}`);
  }
}
function taskToLegacy(doc) {
  if (doc.type === T.session)
    return { type: "session-request", myRelationshipDid: doc.payload.parties[0], counterpartyDid: doc.payload.parties[1] };
  if (doc.type === `${T.session}#response`)
    return { type: "session-challenge", sessionId: doc.threadId, challenge: doc.payload.challenge, domain: doc.payload.domain };
  if (doc.type === T.submit)
    return { type: "submit-presentation", presentation: doc.payload.vp };
  throw new Error(`no mapping for task type ${doc.type}`);
}

// Lever B: the legacy handshake's own ordinal announces the new dance.
const speaksTrustTasks = (legacyHandshakeText) => {
  const m = legacyHandshakeText.match(/vrc:rceVersion:(\d+)/);
  return m ? Number(m[1]) >= 4 : false;
};

{
  const ids = {
    sessionId: SESSION_ID, responseId: "r-1", submitId: "s-1",
    witnessDid: "did:web:wendy.example", participantDid: "did:peer:bob-rel",
    exchangeThreadId: "aaaa1111-0000-4000-8000-000000000001", now: "2026-08-12T10:00:00Z",
  };
  const legacy = [
    { type: "session-request", myRelationshipDid: "did:peer:bob-rel", counterpartyDid: "did:peer:alice-rel" },
    { type: "session-challenge", sessionId: SESSION_ID, challenge: CHALLENGE, domain: DOMAIN },
    { type: "submit-presentation", presentation: vpOf(VRC_B, "did:peer:bob-rel") },
  ];
  const tasks = legacy.map((m) => legacyToTask(m, ids));
  check("legacy → task → legacy round-trips losslessly for all three session messages", () => {
    deepStrictEqual(tasks.map(taskToLegacy), legacy);
  });
  check("the translated documents ARE the ref-06w shapes (threading + payload)", () => {
    deepStrictEqual(tasks[0].threadId, tasks[0].id);            // session opens its own thread
    deepStrictEqual(tasks[1].threadId, SESSION_ID);             // challenge continues it
    deepStrictEqual(tasks[2].payload.vp.proof.challenge, CHALLENGE);
    deepStrictEqual(tasks[0].parentThreadId, ids.exchangeThreadId);
  });
  check("lever B: rceVersion 4 in the OLD handshake gates the NEW dance", () => {
    ok(speaksTrustTasks("This is my relationship DID: vrc:relationshipDid:did:peer:x vrc:rceVersion:4"));
    ok(!speaksTrustTasks("This is my relationship DID: vrc:relationshipDid:did:peer:x vrc:rceVersion:3"));
  });
  writeFileSync(
    join(here, "fixtures", "translator-fixtures.json"),
    JSON.stringify({ note: "frozen legacy⇄task mapping + the honest unmapped delta", legacy, tasks, unmapped: UNMAPPED }, null, 2)
  );
  log(`  · frozen fixtures + unmapped-delta written (${Object.keys(UNMAPPED).length} legacy concepts with no task home yet)`);
}

// ================================ ACT 3 =====================================
log("\n— act 3: one witness, one session, two dialects —");

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
  async sendMessage(pkg) {
    const peer = peers.get(pkg.endpoint);
    if (!peer) throw new Error(`no in-proc peer at ${pkg.endpoint}`);
    await peer.dependencyManager.resolve(DidCommMessageReceiver).receiveMessage(pkg.payload, {});
  }
}
async function makeAgent(name) {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: `ref06w2-${name}-${Date.now()}`, key: `k-${name}` } }),
      didcomm: new DidCommModule({ endpoints: [`inproc://${name}`], connections: { autoAcceptConnections: true } }),
    },
  });
  agent.modules.didcomm.registerOutboundTransport(new InProcOutboundTransport());
  await agent.initialize();
  peers.set(`inproc://${name}`, agent);
  return agent;
}
async function connect(a, b, an, bn) {
  const inv = await a.modules.didcomm.oob.createInvitation({ label: an });
  const { connectionRecord } = await b.modules.didcomm.oob.receiveInvitation(inv.outOfBandInvitation, { label: bn });
  const bConn = await b.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id);
  const [aPend] = await a.modules.didcomm.connections.findAllByOutOfBandId(inv.id);
  const aConn = await a.modules.didcomm.connections.returnWhenIsConnected(aPend.id);
  return { aConn, bConn };
}
async function sendRaw(from, connection, message) {
  await from.dependencyManager
    .resolve(DidCommMessageSender)
    .sendMessage(new DidCommOutboundMessageContext(message, { agentContext: from.context, connection }));
}
const sendLegacy = (from, conn, obj) => sendRaw(from, conn, new DidCommBasicMessage({ content: JSON.stringify(obj) }));
const sendTask = (from, conn, doc) =>
  sendRaw(from, conn, new TrustTaskMessage({ document: doc, threadId: doc.threadId ?? doc.id }));

const alice = await makeAgent("alice"); // legacy dialect
const bob = await makeAgent("bob");     // trust-task dialect
const wendy = await makeAgent("wendy"); // speaks BOTH

try {
  const wa = await connect(wendy, alice, "wendy", "alice");
  const wb = await connect(wendy, bob, "wendy", "bob");

  // --- wendy: ONE session core, normalized from both dialects -------------
  const session = { id: SESSION_ID, parties: new Map(), submissions: [], vwcs: [] };
  const dialectOf = new Map(); // connectionId -> {dialect, conn}
  dialectOf.set(wa.aConn.id, { dialect: "legacy", conn: wa.aConn });
  dialectOf.set(wb.aConn.id, { dialect: "task", conn: wb.aConn });

  const handleNormalized = async (norm, via) => {
    if (norm.type === "session-request") {
      session.parties.set(via.conn.id, norm);
      // one challenge, served to each party in ITS OWN dialect
      const reply = { type: "session-challenge", sessionId: SESSION_ID, challenge: CHALLENGE, domain: DOMAIN };
      if (via.dialect === "legacy") await sendLegacy(wendy, via.conn, reply);
      else await sendTask(wendy, via.conn, legacyToTask(reply, {
        responseId: `resp-${via.conn.id.slice(0, 8)}`, witnessDid: "did:web:wendy.example",
        participantDid: via.conn.theirDid, now: new Date().toISOString(),
      }));
    }
    if (norm.type === "submit-presentation") {
      const vwc = buildWitnessCredentialJson(norm.presentation, { ...BUILD_CTX, sessionId: SESSION_ID });
      session.submissions.push({ via: via.dialect, holder: norm.presentation.holder });
      session.vwcs.push({ via: via.dialect, vwc });
      const delivery = { type: "witness-credential", credential: vwc };
      if (via.dialect === "legacy") await sendLegacy(wendy, via.conn, delivery);
      else await sendTask(wendy, via.conn, {
        id: `vwc-${via.conn.id.slice(0, 8)}`, type: `${T.submit}#response`, threadId: SESSION_ID,
        issuer: "did:web:wendy.example", recipient: via.conn.theirDid,
        issuedAt: new Date().toISOString(), payload: { vwc },
      });
    }
  };

  // legacy inbound: bespoke JSON in basic-message content (today's carriage)
  wendy.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, (ev) => {
    if (ev.payload.basicMessageRecord.role !== "receiver") return;
    const via = dialectOf.get(ev.payload.basicMessageRecord.connectionId);
    if (!via || via.dialect !== "legacy") return;
    handleNormalized(JSON.parse(ev.payload.message.content), via).catch((e) => console.error(e));
  });
  // task inbound: normalized through the SAME translator
  wendy.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
    supportedMessages: [TrustTaskMessage],
    handle: async (ctx) => {
      const via = dialectOf.get(ctx.connection?.id);
      await handleNormalized(taskToLegacy(ctx.message.document), via);
      return undefined;
    },
  });

  // participants' inboxes
  const inboxFor = (agent, dialect) =>
    new Promise((resolve) => {
      const got = [];
      if (dialect === "legacy") {
        agent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, (ev) => {
          if (ev.payload.basicMessageRecord.role !== "receiver") return;
          got.push(JSON.parse(ev.payload.message.content));
          if (got.length === 2) resolve(got);
        });
      } else {
        agent.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
          supportedMessages: [TrustTaskMessage],
          handle: async (ctx) => {
            got.push(ctx.message.document);
            if (got.length === 2) resolve(got);
            return undefined;
          },
        });
      }
    });

  const aliceInbox = inboxFor(alice, "legacy");
  const bobInbox = inboxFor(bob, "task");

  // --- the mixed session runs ---------------------------------------------
  await sendLegacy(alice, wa.bConn, { type: "session-request", myRelationshipDid: "did:peer:alice-rel", counterpartyDid: "did:peer:bob-rel" });
  await sendTask(bob, wb.bConn, {
    id: SESSION_ID, type: T.session, threadId: SESSION_ID,
    issuer: "did:peer:bob-rel", recipient: "did:web:wendy.example",
    issuedAt: new Date().toISOString(), payload: { parties: ["did:peer:bob-rel", "did:peer:alice-rel"] },
  });

  // each submits its own VRC, in its own dialect, under the one challenge
  await sendLegacy(alice, wa.bConn, { type: "submit-presentation", presentation: vpOf(VRC_A, "did:peer:alice-rel") });
  await sendTask(bob, wb.bConn, {
    id: "s-bob-1", type: T.submit, threadId: SESSION_ID,
    issuer: "did:peer:bob-rel", recipient: "did:web:wendy.example",
    issuedAt: new Date().toISOString(), payload: { vp: vpOf(VRC_B, "did:peer:bob-rel") },
  });

  const [aliceMsgs, bobDocs] = await Promise.all([
    Promise.race([aliceInbox, new Promise((_, r) => setTimeout(() => r(new Error("alice timeout")), 15000))]),
    Promise.race([bobInbox, new Promise((_, r) => setTimeout(() => r(new Error("bob timeout")), 15000))]),
  ]);

  const aliceChallenge = aliceMsgs.find((m) => m.type === "session-challenge");
  const aliceVwc = aliceMsgs.find((m) => m.type === "witness-credential")?.credential;
  const bobChallenge = bobDocs.find((d) => d.type === `${T.session}#response`);
  const bobVwc = bobDocs.find((d) => d.type === `${T.submit}#response`)?.payload?.vwc;

  check("one challenge served both dialects (legacy JSON and task document agree)", () => {
    deepStrictEqual(aliceChallenge.challenge, CHALLENGE);
    deepStrictEqual(bobChallenge.payload.challenge, CHALLENGE);
    deepStrictEqual(aliceChallenge.sessionId, bobChallenge.threadId);
  });
  check("both parties received VWCs from the SAME real build function, one per direction", () => {
    deepStrictEqual(aliceVwc.credentialSubject.id, "did:peer:alice-rel");
    deepStrictEqual(bobVwc.credentialSubject.id, "did:peer:bob-rel");
    deepStrictEqual(aliceVwc.credentialSubject.digest, computeVrcDigest(VRC_A));
    deepStrictEqual(bobVwc.credentialSubject.digest, computeVrcDigest(VRC_B));
  });
  check("one session identifier spans both worlds (lever C): witnessContext.sessionId = ceremony id", () => {
    deepStrictEqual(aliceVwc.credentialSubject.witnessContext.sessionId, SESSION_ID);
    deepStrictEqual(bobVwc.credentialSubject.witnessContext.sessionId, SESSION_ID);
  });
  check("dialects never leaked: alice saw only legacy JSON, bob only task documents", () => {
    ok(aliceMsgs.every((m) => typeof m.type === "string" && !m.type.startsWith("https://")));
    ok(bobDocs.every((d) => d.type.startsWith("https://")));
  });
  check("the witness normalized both dialects into ONE session (both submissions recorded)", () => {
    deepStrictEqual(session.submissions.map((s) => s.via).sort(), ["legacy", "task"]);
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
console.log(`\nPASS — ${checks} checks (shared core · translator · mixed-dialect session)`);
process.exit(0);
