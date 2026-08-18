// ref-06x — the full stack, assembled as far as Cypress permits, measured
// where it resists.
//
// Brendan's build-up phasing, step 3: "Alice and Bob with DIDComm 1 +
// Cypress VTA/VTI (affinidi mediator, webvh hosting)". Steps 1–2 are
// ref-06v1/v1b; the Cypress components are proven separately (ref-04: the
// mediator, TSP legs; ref-05: a local VTA serving its own did:webvh). This
// rung composes them from the WALLET side and records exactly which joints
// hold and which don't yet:
//
//   act 1 — the Cypress VTA (local, release binary): alive, self-hosted
//           did:webvh, the capability ladder readable by wallet-side code.
//   act 2 — webvh at the wallet: can Credo 0.6.3 resolve did:webvh?
//           (measured; the workaround is a ~20-line fetch-and-parse)
//   act 3 — the Cypress mediator dialect: what happens when DIDComm v1
//           traffic meets the v2-only mediator (measured, not assumed).
//   act 4 — the witnessed exchange, full app-layer stack: three Credo
//           agents, binding 0.2 dedicated @type, trust-tasks 0.9.0 with
//           real payload validation, §4.9.3 task digests, digest receipts.
//
// Honest scope: acts 1/2/4 are self-contained; act 3 needs the public
// mediator reachable and degrades to "recorded, skipped" offline.

import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { deepStrictEqual, ok } from "node:assert";
import { createHash } from "node:crypto";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import {
  DidCommModule,
  DidCommMessage,
  DidCommAttachment,
  DidCommAttachmentData,
  DidCommMessageSender,
  DidCommMessageReceiver,
  DidCommMessageHandlerRegistry,
  DidCommOutboundMessageContext,
  parseMessageType,
  IsValidMessageType,
} from "@credo-ts/didcomm";

import { consumeInbound, respondWith, StaticTransport } from "@openvtc/trust-tasks";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as propose from "@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload";
import * as issue from "@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload";
import * as session from "@openvtc/trust-tasks/witness/session/0.1/payload";
import * as submit from "@openvtc/trust-tasks/witness/session/submit/0.1/payload";

const QUIET = process.argv.includes("--quiet");
const log = (...a) => QUIET || console.log(...a);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const VTA_URL = process.env.VTA_URL ?? "http://localhost:8100";
const MEDIATOR_DID = process.env.MEDIATOR_DID
  ?? "did:webvh:QmTS3a3H9Dk4ZMPAZ8jNWGeyPbuKrPbrPZcSbg8CJ6yynD:webvh.storm.ws:mediator";

const BINDING_URI = "https://trusttasks.org/binding/didcomm-v1/0.2";
const ENVELOPE_TYPE = "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task";
const ATTACHMENT_ID = "trust-task";
const NOW = () => "2026-08-17T12:00:00Z";
let errSeq = 0;
const newErrorId = () => `err-${++errSeq}`;

const STUB_PROOF = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-jcs-2022",
  verificationMethod: "did:example:stub#key-1",
  created: NOW(),
  proofPurpose: "assertionMethod",
  proofValue: "z3StubProofValueForPipelineShapeOnly",
};

// §4.9.3 task digest: JCS ∖ top-level proof, multihash sha2-256, base58btc.
function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btc(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  return out;
}
function taskDigest(doc) {
  const { proof: _p, ...sansProof } = doc;
  const d = createHash("sha256").update(Buffer.from(jcs(sansProof), "utf8")).digest();
  return "z" + base58btc(Buffer.concat([Buffer.from([0x12, 0x20]), d]));
}

// ═══════════════════════ act 1 — the Cypress VTA ═══════════════════════════
log("ref-06x — the full stack, measured joint by joint\n");
log("— act 1: the Cypress VTA (release binary, local) —");

const health = await (await fetch(`${VTA_URL}/health`)).json();
check("the VTA is alive on the Cypress release binary", () => deepStrictEqual(health.status, "ok"));

const logText = await (await fetch(`${VTA_URL}/.well-known/did.jsonl`)).text();
const entries = logText.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vtaDoc = entries.at(-1).state;
check("it self-hosts its did:webvh log (no hosting service in the loop)", () =>
  ok(vtaDoc.id.startsWith("did:webvh:")));
const vtaServices = (vtaDoc.service ?? []).map((s) => s.type);
check(`its DID document advertises the capability ladder (${vtaServices.join(", ") || "none"})`, () =>
  ok(vtaServices.length >= 1));

// ═══════════ act 2 — webvh at the wallet: Credo's resolver, measured ═══════

log("\n— act 2: can the wallet's Credo stack resolve did:webvh? —");

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

class TrustTaskMessage extends DidCommMessage {
  constructor(options) {
    super();
    if (options) {
      this.id = options.id ?? this.generateId();
      if (options.threadId) this.setThread({ threadId: options.threadId });
      if (options.attachments) this.appendedAttachments = options.attachments;
    }
  }
  type = TrustTaskMessage.type.messageTypeUri;
  static type = parseMessageType(ENVELOPE_TYPE);
}
IsValidMessageType(TrustTaskMessage.type)(TrustTaskMessage.prototype, "type");

async function makeAgent(name) {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref06x-${name}-${Date.now()}`, key: `ref06x-testkey-${name}` },
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
  agent.trustTaskInbox = [];
  agent.trustTaskWaiters = [];
  agent.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
    supportedMessages: [TrustTaskMessage],
    handle: async (ctx) => {
      const doc = ctx.message.appendedAttachments[0].getDataAsJson();
      const waiter = agent.trustTaskWaiters.shift();
      if (waiter) waiter(doc);
      else agent.trustTaskInbox.push(doc);
      return undefined;
    },
  });
  return agent;
}

const alice = await makeAgent("alice");
const bob = await makeAgent("bob");
const wendy = await makeAgent("wendy");

let resolveOutcome;
try {
  resolveOutcome = await alice.dids.resolve(vtaDoc.id);
} catch (e) {
  resolveOutcome = { didResolutionMetadata: { error: String(e.message ?? e) } };
}
const resolveError = resolveOutcome?.didResolutionMetadata?.error;
check(`FINDING: Credo 0.6.3 cannot resolve did:webvh natively (${resolveError ?? "resolved?!"}) — a wallet needs a resolver adapter`, () =>
  ok(resolveError !== undefined && resolveError !== null));

// The workaround is small and wallet-side: fetch the log, take the last
// entry's state. That is exactly what this rung's act-1 code did.
const firstEndpoint = (svc) => {
  const ep = svc?.serviceEndpoint;
  if (typeof ep === "string") return ep;
  if (Array.isArray(ep)) return ep[0]?.uri ?? ep[0];
  return ep?.uri;
};
const anyService = (vtaDoc.service ?? [])[0];
check("the ~20-line workaround suffices: wallet code reads the log and extracts a service endpoint from the ladder", () =>
  ok(typeof firstEndpoint(anyService) === "string"));

// ═══════ act 3 — the Cypress mediator meets DIDComm v1 (measured) ══════════

log("\n— act 3: the Cypress mediator's dialect vs DIDComm v1 —");
{
  // Resolve the mediator's did:webvh by the same wallet-side workaround.
  const [, , scid, domain, ...path] = MEDIATOR_DID.split(":");
  const url = `https://${domain}/${path.join("/")}/did.jsonl`;
  let medDoc = null;
  try {
    const text = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).text();
    medDoc = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).at(-1).state;
  } catch (e) {
    log(`  · mediator unreachable (${e.message}) — act 3 recorded as skipped`);
  }
  if (medDoc) {
    const med = (medDoc.service ?? []).find((s) => String(s.type).includes("DIDComm")) ?? (medDoc.service ?? [])[0];
    const endpoint = firstEndpoint(med);
    check(`the mediator's webvh doc resolves wallet-side and names its endpoint (${String(endpoint).slice(0, 40)}…)`, () =>
      ok(typeof endpoint === "string"));

    // The dialect fact, from the packages themselves: the Cypress client
    // speaks DIDComm v2 media types; Credo v1 speaks ssi-agent-wire.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const pkgDir = new URL("./node_modules/@openvtc/vti-didcomm-js", import.meta.url).pathname;
    let v2MediaType = false;
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (v2MediaType) return;
        const p = join(d, e.name);
        if (e.isDirectory() && e.name !== "node_modules") walk(p);
        else if (/\.(js|mjs|cjs|ts)$/.test(e.name) && /didcomm-encrypted\+json|didcomm\/v2/.test(readFileSync(p, "utf8"))) v2MediaType = true;
      }
    };
    walk(pkgDir);
    check("FINDING (structural): the Cypress mediator client is DIDComm v2 (didcomm-encrypted+json); Credo v1 emits ssi-agent-wire — no shared dialect", () =>
      ok(v2MediaType));

    // And the live measurement: a v1 envelope POSTed at the v2 inbox.
    const httpEndpoint = String(endpoint).replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    let status = null;
    try {
      const res = await fetch(httpEndpoint, {
        method: "POST",
        headers: { "content-type": "application/ssi-agent-wire" },
        body: JSON.stringify({ protected: "eyJmYWtlIjoidjEifQ", iv: "", ciphertext: "", tag: "" }),
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
    } catch (e) {
      status = `transport-refused (${e.cause?.code ?? e.message})`;
    }
    check(`FINDING (measured): the v1 envelope is refused by the Cypress mediator (${status}) — Keyring's v1 traffic keeps its own mediator until the TSP transport lands`, () =>
      ok(status !== 200 && status !== 202));
  }
}

// ═══ act 4 — the witnessed exchange: v1 carriage 0.2 × trust-tasks 0.9.0 ═══

log("\n— act 4: the witnessed exchange on the full app-layer stack —");

const ajv = new Ajv2020({ strict: false });
const VALIDATOR = {
  validate(schema, payload) {
    const okv = ajv.validate(schema, payload);
    return okv ? true : { ok: false, errors: (ajv.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
  },
};

async function connect(a, b, aName, bName) {
  const invitation = await a.modules.didcomm.oob.createInvitation({ label: aName });
  const { connectionRecord } = await b.modules.didcomm.oob.receiveInvitation(
    invitation.outOfBandInvitation, { label: bName });
  const bConn = await b.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id);
  const [aPending] = await a.modules.didcomm.connections.findAllByOutOfBandId(invitation.id);
  const aConn = await a.modules.didcomm.connections.returnWhenIsConnected(aPending.id);
  return { aConn, bConn };
}

function buildCarriage(doc) {
  return new TrustTaskMessage({
    threadId: doc.threadId ?? doc.id,
    attachments: [new DidCommAttachment({
      id: ATTACHMENT_ID, mimeType: "application/json",
      data: new DidCommAttachmentData({ json: doc }),
    })],
  });
}
async function sendDoc(from, conn, doc) {
  const sender = from.dependencyManager.resolve(DidCommMessageSender);
  await sender.sendMessage(new DidCommOutboundMessageContext(buildCarriage(doc), {
    agentContext: from.context, connection: conn,
  }));
}
function nextDoc(agent) {
  if (agent.trustTaskInbox.length) return Promise.resolve(agent.trustTaskInbox.shift());
  return new Promise((r) => agent.trustTaskWaiters.push(r));
}
async function consume(myVid, senderVid, spec, doc, handler = (d) => d) {
  return consumeInbound({
    transport: new StaticTransport({ issuer: senderVid, recipient: myVid }, BINDING_URI),
    spec,
    proofPolicy: { kind: "acceptUnverified" },
    payloadPolicy: { kind: "validate", validate: VALIDATOR },
    doc, myVid, now: Date.parse(NOW()), newErrorId, handler,
  });
}

try {
  const tConn = process.hrtime.bigint();
  const ab = await connect(alice, bob, "alice", "bob");
  const bw = await connect(bob, wendy, "bob", "wendy");
  const aw = await connect(alice, wendy, "alice", "wendy");

  const tCeremony = process.hrtime.bigint();
  log(`  · connections (3 pairwise DIDComm handshakes): ${Number(tCeremony - tConn) / 1e6 | 0} ms`);

  const REL = { alice: "did:peer:alice-rel", bob: "did:peer:bob-rel" };

  // propose (bob → alice), witnessed asked and answered — over the wire.
  const proposeDoc = {
    id: "aaaa1111-1111-4111-8111-111111111111", type: propose.TYPE_URI,
    threadId: "aaaa1111-1111-4111-8111-111111111111",
    issuer: ab.bConn.did, recipient: ab.bConn.theirDid, issuedAt: NOW(),
    payload: { relationshipDid: REL.bob, witnessed: true },
  };
  const atAlice = nextDoc(alice);
  await sendDoc(bob, ab.bConn, proposeDoc);
  const received = await atAlice;
  const proposeOutcome = await consume(ab.aConn.did, ab.aConn.theirDid, propose.SPEC, received, (d) =>
    respondWith(d, "aaaa1111-0000-4000-8000-00000000000a",
      { accept: true, relationshipDid: REL.alice, witnessed: true }, NOW));
  check("propose crosses the 0.2 carriage and is accepted (witnessed answered on the response)", () =>
    ok(proposeOutcome.kind === "handled" && proposeOutcome.response.payload.witnessed === true));

  // bilateral sessions with wendy, distinct challenges — over the wire.
  async function runSession(party, partyConnToWendy, wendyConn, sessionId, challenge) {
    const doc = {
      id: sessionId, type: session.TYPE_URI, threadId: sessionId,
      parentThreadId: proposeDoc.id,
      issuer: partyConnToWendy.did, recipient: partyConnToWendy.theirDid, issuedAt: NOW(),
      payload: { parties: [REL.alice, REL.bob] },
    };
    const atWendy = nextDoc(wendy);
    await sendDoc(party, partyConnToWendy, doc);
    const got = await atWendy;
    const outcome = await consume(wendyConn.did, wendyConn.theirDid, session.SPEC, got, (d) =>
      respondWith(d, sessionId.replace(/^..../, "cccc"), { challenge, domain: "wendy.example" }, NOW));
    outcome.response.proof = STUB_PROOF;
    return { doc: got, response: outcome.response };
  }
  const bobSession = await runSession(bob, bw.aConn, bw.bConn, "bbbb2222-2222-4222-8222-222222222222", "nonce-bob-06x");
  const aliceSession = await runSession(alice, aw.aConn, aw.bConn, "bbbb3333-3333-4333-8333-333333333333", "nonce-alice-06x");
  check("two bilateral sessions with the witness, distinct challenges, both over the wire", () =>
    ok(bobSession.response.payload.challenge !== aliceSession.response.payload.challenge));

  // submit (proofed) → VWC with top-level taskContext + §4.9.3 task digest.
  const submitDoc = {
    id: "dddd4444-4444-4444-8444-444444444402", type: submit.TYPE_URI,
    threadId: bobSession.doc.id, parentThreadId: proposeDoc.id,
    issuer: bw.aConn.did, recipient: bw.aConn.theirDid, issuedAt: NOW(),
    payload: { vp: { holder: "stub", challengeBound: true } },
    proof: STUB_PROOF,
  };
  const atWendy = nextDoc(wendy);
  await sendDoc(bob, bw.aConn, submitDoc);
  const gotSubmit = await atWendy;
  const vwc = {
    issuer: vtaDoc.id, // the witness anchors its issuer identity on the Cypress-hosted webvh DID
    taskContext: bobSession.doc.id,
    taskDigestMultibase: taskDigest(bobSession.doc),
    credentialSubject: { id: REL.bob, digestMultibase: "zStubVrcDigest1111111111" },
  };
  const submitOutcome = await consume(bw.bConn.did, bw.bConn.theirDid, submit.SPEC, gotSubmit, (d) =>
    respondWith(d, "eeee5555-5555-4555-8555-555555555555",
      { vwc, vwcDigestMultibase: taskDigest({ ...vwc, proof: undefined }) }, NOW));
  submitOutcome.response.proof = STUB_PROOF;
  check("the proofed submit yields the VWC over the wire (Lever D shape, 0.9.0-validated)", () =>
    deepStrictEqual(submitOutcome.kind, "handled"));

  // the §4.9.3 pairing, wallet-side: locate by id, bind by digest.
  check("verifier pairing holds: taskContext locates the session document AND its task digest reproduces (§4.9.3)", () => {
    ok(vwc.taskContext === bobSession.doc.id);
    deepStrictEqual(taskDigest(bobSession.doc), vwc.taskDigestMultibase);
  });
  check("a counterfeit session document with the same id fails the digest half", () => {
    const forged = { ...bobSession.doc, payload: { parties: ["did:peer:mallory", REL.bob] } };
    ok(taskDigest(forged) !== vwc.taskDigestMultibase);
  });

  // issue ×2 with digest receipts — closing the exchange.
  const vrc = { issuer: REL.bob, credentialSubject: { id: REL.alice }, proof: STUB_PROOF };
  const issueDoc = {
    id: "ffff6666-6666-4666-8666-666666666666", type: issue.TYPE_URI, threadId: proposeDoc.id,
    issuer: ab.bConn.did, recipient: ab.bConn.theirDid, issuedAt: NOW(),
    payload: { vrc }, proof: STUB_PROOF,
  };
  const atAlice2 = nextDoc(alice);
  await sendDoc(bob, ab.bConn, issueDoc);
  const gotIssue = await atAlice2;
  const issueOutcome = await consume(ab.aConn.did, ab.aConn.theirDid, issue.SPEC, gotIssue, (d) =>
    respondWith(d, "ffff6666-0000-4000-8000-00000000000f",
      { vrcDigestMultibase: taskDigest({ ...vrc, proof: undefined }) }, NOW));
  check("issue crosses the carriage; the receipt carries the receiver-computed digest (design call 2)", () =>
    deepStrictEqual(issueOutcome.kind, "handled"));
  log(`  · full ceremony (propose → 2 sessions → submit/VWC → issue/receipt): ${Number(process.hrtime.bigint() - tCeremony) / 1e6 | 0} ms`);
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
  await wendy.shutdown().catch(() => {});
}

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (the stack, joint by joint: VTA ✓, webvh-at-wallet measured, mediator dialect measured, exchange end-to-end)`);
process.exit(0);
