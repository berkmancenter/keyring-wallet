// ref-06v1c — the task layer, for real: a registry Trust Task processed by the
// official @openvtc/trust-tasks consumer pipeline (0.7.x), over the
// didcomm-v1 0.2 carriage (#216's dedicated @type — adopted from our
// ref-06v1d measurement), with the §2.3 migration rule exercised: a 0.1
// basic-message carriage still lands at this 0.2 consumer.
//
// Five acts, each answering one question:
//   1  Does the library enforce the qualifying profile? (proof REQUIRED)
//   2  Does a real vtc/relationships/request round-trip on our stack —
//      request over the wire, §7.2 pipeline, #response back, response-side
//      consumption (the operation #173 says has no supported path yet)?
//   3  Is a decline a self-describing trust-task-error (inResponseTo — the
//      load-bearing #173 fix) rather than a bespoke rejection message?
//   4  Does the §4.8.1 identity cross-check and the §8.1 oracle-suppression
//      rule behave as the SPEC says, with Credo's theirDid as the
//      transport-authenticated sender?
//   5  What does Credo actually do in the binding's "case 2" — an authcrypt
//      envelope whose verkey is bound to no known DID?

// Native binding first — askar-shared snapshots its export for ESM importers.
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { deepStrictEqual, ok } from "node:assert";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import {
  DidCommModule,
  DidCommMessage,
  DidCommBasicMessage,
  DidCommBasicMessageEventTypes,
  DidCommAttachment,
  DidCommAttachmentData,
  DidCommMessageSender,
  DidCommMessageReceiver,
  DidCommMessageHandlerRegistry,
  DidCommOutboundMessageContext,
  parseMessageType,
  IsValidMessageType,
} from "@credo-ts/didcomm";

import {
  consumeInbound,
  respondWith,
  refuse,
  extendedCode,
  StaticTransport,
  UnauthenticatedTransport,
} from "@openvtc/trust-tasks";
import {
  TYPE_URI,
  SPEC,
  RESPONSE_SPEC,
} from "@openvtc/trust-tasks/vtc/relationships/request/0.1/payload";

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

const BINDING_URI = "https://trusttasks.org/binding/didcomm-v1/0.2";
const ENVELOPE_TYPE = "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task";
const ATTACHMENT_ID = "trust-task";
const NOW = () => "2026-08-11T12:00:00Z";
let errSeq = 0;
const newErrorId = () => `err-${++errSeq}`;

// A structurally-complete Data Integrity proof. NOT cryptographically valid —
// this rung consumes with proofPolicy acceptUnverified. Verifying real
// eddsa-rdfc-2022 proofs is the DI-suite integration's job (Phase D), and
// claiming it here would be dishonest.
const STUB_PROOF = {
  type: "DataIntegrityProof",
  cryptosuite: "eddsa-rdfc-2022",
  verificationMethod: "did:example:stub#key-1",
  created: NOW(),
  proofPurpose: "assertionMethod",
  proofValue: "z3StubProofValueForPipelineShapeOnly",
};

// ----------------------------------------------------------- carriage bits --
// Binding 0.2: the document rides ~attach on the dedicated message type.
// Transport-safe bare-UUID correlators as rung 06v1 proved.

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

function buildBindingMessage(doc) {
  return new TrustTaskMessage({
    threadId: doc.threadId ?? doc.id,
    attachments: [
      new DidCommAttachment({
        id: ATTACHMENT_ID,
        mimeType: "application/json",
        data: new DidCommAttachmentData({ json: doc }),
      }),
    ],
  });
}

// The 0.1 carriage, kept for the §2.3 migration check: a 0.2 consumer MUST
// still accept it (receivers move first).
function buildLegacyBasicMessageCarriage(doc) {
  const message = new DidCommBasicMessage({ content: `Trust Task: ${doc.type}` });
  message.setThread({ threadId: doc.threadId ?? doc.id });
  message.appendedAttachments = [
    new DidCommAttachment({
      id: ATTACHMENT_ID,
      mimeType: "application/json",
      data: new DidCommAttachmentData({ json: doc }),
    }),
  ];
  return message;
}

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

async function makeAgent(name) {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref06v1c-${name}-${Date.now()}`, key: `ref06v1c-testkey-${name}` },
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

  // Inbound trust-task queue for the dedicated @type (binding 0.2).
  agent.trustTaskInbox = [];
  agent.trustTaskWaiters = [];
  agent.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
    supportedMessages: [TrustTaskMessage],
    handle: async (ctx) => {
      const doc = ctx.message.appendedAttachments[0].getDataAsJson();
      agent.lastInboundHadConnection = ctx.connection !== undefined && ctx.connection !== null;
      const waiter = agent.trustTaskWaiters.shift();
      if (waiter) waiter(doc);
      else agent.trustTaskInbox.push(doc);
      return undefined;
    },
  });
  return agent;
}

async function sendDocument(fromAgent, connection, doc) {
  const sender = fromAgent.dependencyManager.resolve(DidCommMessageSender);
  await sender.sendMessage(
    new DidCommOutboundMessageContext(buildBindingMessage(doc), {
      agentContext: fromAgent.context,
      connection,
    })
  );
}

function nextDocumentFrom(agent) {
  if (agent.trustTaskInbox.length) return Promise.resolve(agent.trustTaskInbox.shift());
  return new Promise((resolve) => agent.trustTaskWaiters.push(resolve));
}

// One-shot listener for the LEGACY basic-message carriage (§2.3 check only).
function nextLegacyDocumentFrom(agent) {
  return new Promise((resolve) => {
    const listener = (ev) => {
      if (ev.payload.basicMessageRecord.role !== "receiver") return;
      agent.events.off(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, listener);
      resolve(ev.payload.message.appendedAttachments[0].getDataAsJson());
    };
    agent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, listener);
  });
}

// -------------------------------------------------------------------- cast --

log("ref-06v1c — the task layer: vtc/relationships/request through the real pipeline");

const alice = await makeAgent("alice"); // the issuing member
const bob = await makeAgent("bob");     // the requester

try {
  const invitation = await alice.modules.didcomm.oob.createInvitation({ label: "alice" });
  const { connectionRecord } = await bob.modules.didcomm.oob.receiveInvitation(
    invitation.outOfBandInvitation,
    { label: "bob" }
  );
  const bobConn = await bob.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id);
  const [aliceConnPending] = await alice.modules.didcomm.connections.findAllByOutOfBandId(
    invitation.id
  );
  const aliceConn = await alice.modules.didcomm.connections.returnWhenIsConnected(
    aliceConnPending.id
  );

  // The v1 identity model in one line: whose DID a verkey belongs to is
  // *connection state*, and the two wallets hold mirror images of it.
  check("the verkey→DID binding is connection state (bob.did === alice.theirDid)", () => {
    deepStrictEqual(bobConn.did, aliceConn.theirDid);
    deepStrictEqual(aliceConn.did, bobConn.theirDid);
  });

  const aliceTransport = new StaticTransport(
    { issuer: aliceConn.theirDid, recipient: aliceConn.did },
    BINDING_URI
  );

  const makeRequest = (id, extra = {}) => ({
    id,
    type: TYPE_URI,
    issuer: bobConn.did,
    recipient: bobConn.theirDid,
    issuedAt: NOW(),
    payload: { reason: "We met at the Berkman workshop; requesting a relationship credential." },
    ...extra,
  });

  // ---- ACT 1: the qualifying profile is enforced by the library ------------
  log("\n— act 1: proof: REQUIRED is enforced (the qualifying profile, live) —");
  {
    const bare = makeRequest("req-unproofed-0001");
    const outcome = await consumeInbound({
      transport: aliceTransport,
      spec: SPEC,
      proofPolicy: { kind: "acceptUnverified" },
      doc: bare,
      myVid: aliceConn.did,
      now: Date.parse(NOW()),
      newErrorId,
      handler: () => {
        throw new Error("handler must not run for an unproofed document");
      },
    });
    check("a request without proof is rejected with proofRequired, before the handler", () => {
      deepStrictEqual(outcome.kind, "rejected");
      deepStrictEqual(outcome.error.payload.code, "proofRequired");
    });
  }

  // ---- ACT 2: the happy path, over the wire --------------------------------
  log("\n— act 2: request → #response over the carriage, both sides consuming —");
  {
    const request = makeRequest("11e6c7a2-53d4-4a10-9b6e-2f01c3a9d201", { proof: STUB_PROOF });

    const arrivedAtAlice = nextDocumentFrom(alice);
    await sendDocument(bob, bobConn, request);
    const received = await arrivedAtAlice;

    check("the document that arrived is the document that was sent", () => {
      deepStrictEqual(received, request);
    });

    const outcome = await consumeInbound({
      transport: aliceTransport,
      spec: SPEC,
      proofPolicy: { kind: "acceptUnverified" },
      doc: received,
      myVid: aliceConn.did,
      now: Date.parse(NOW()),
      newErrorId,
      handler: (doc, parties) => {
        // parties = the post-§4.8.1 identities — what alice may rely on.
        ok(parties.issuer === aliceConn.theirDid, "issuer resolved to the connection's theirDid");
        const vrc = {
          "@context": ["https://www.w3.org/ns/credentials/v2"],
          type: ["VerifiableCredential", "VerifiableRelationshipCredential"],
          issuer: aliceConn.did,
          credentialSubject: { id: doc.issuer },
        };
        const response = respondWith(doc, "22f7d8b3-64e5-4b21-ac7f-3a12d4bae302", { vrc }, NOW);
        response.proof = STUB_PROOF; // RESPONSE_SPEC also declares proof REQUIRED
        return response;
      },
    });

    check("alice's pipeline handles the request (§7.2 items 4–8 all pass)", () => {
      deepStrictEqual(outcome.kind, "handled");
    });
    check("respondWith derived the #response type and swapped the parties", () => {
      deepStrictEqual(outcome.response.type, `${TYPE_URI}#response`);
      deepStrictEqual(outcome.response.issuer, request.recipient);
      deepStrictEqual(outcome.response.recipient, request.issuer);
      deepStrictEqual(outcome.response.threadId, request.id); // §4.9 fallback
    });

    // The response rides back over the same carriage…
    const arrivedAtBob = nextDocumentFrom(bob);
    await sendDocument(alice, aliceConn, outcome.response);
    const responseAtBob = await arrivedAtBob;

    // …and bob consumes it with RESPONSE_SPEC — response-side consumption,
    // the operation #173's editor said has no named path yet. It works via
    // the same pipeline; what is missing upstream is *guidance*, not code.
    const bobTransport = new StaticTransport(
      { issuer: bobConn.theirDid, recipient: bobConn.did },
      BINDING_URI
    );
    const responseOutcome = await consumeInbound({
      transport: bobTransport,
      spec: RESPONSE_SPEC,
      proofPolicy: { kind: "acceptUnverified" },
      doc: responseAtBob,
      myVid: bobConn.did,
      now: Date.parse(NOW()),
      newErrorId,
      handler: (doc) => {
        ok(doc.payload.vrc.credentialSubject.id === bobConn.did, "the VRC names bob as subject");
        return respondWith(doc, "ack-unused-0001", {}); // pipeline wants a return; unused
      },
    });
    check("bob consumes the retained #response through the same pipeline (RESPONSE_SPEC)", () => {
      deepStrictEqual(responseOutcome.kind, "handled");
    });

    // §2.3 (binding 0.2): a 0.2 consumer still accepts the 0.1 basic-message
    // carriage — receivers move first, producers stop emitting it.
    const legacyArrival = nextLegacyDocumentFrom(alice);
    const legacyDoc = makeRequest("88fdfef9-ca4b-4f87-a235-9f78dafff908", { proof: STUB_PROOF });
    const sender = bob.dependencyManager.resolve(DidCommMessageSender);
    await sender.sendMessage(
      new DidCommOutboundMessageContext(buildLegacyBasicMessageCarriage(legacyDoc), {
        agentContext: bob.context,
        connection: bobConn,
      })
    );
    const legacyReceived = await legacyArrival;
    check("§2.3 migration: the 0.1 basic-message carriage still lands at this 0.2 consumer", () => {
      deepStrictEqual(legacyReceived, legacyDoc);
    });
  }

  // ---- ACT 3: a decline is a self-describing trust-task-error --------------
  log("\n— act 3: the decline path — trust-task-error with inResponseTo —");
  {
    const request = makeRequest("33a8e9c4-75f6-4c32-bd80-4b23e5cbf403", { proof: STUB_PROOF });
    const outcome = await consumeInbound({
      transport: aliceTransport,
      spec: SPEC,
      proofPolicy: { kind: "acceptUnverified" },
      doc: request,
      myVid: aliceConn.did,
      now: Date.parse(NOW()),
      newErrorId,
      handler: (doc) =>
        refuse(doc, "44b9fad5-8607-4d43-ce91-5c34f6dcf504", {
          code: extendedCode(TYPE_URI, "declined"),
          message: "Not issuing relationship credentials to workshop acquaintances.",
          retryable: false,
        }),
    });

    check("the registry's decline idiom: extended code namespaced to the slug", () => {
      deepStrictEqual(outcome.kind, "rejected");
      deepStrictEqual(outcome.error.payload.code, "vtc/relationships/request:declined");
    });
    check("the error is self-describing: inResponseTo names the request (#173's fix)", () => {
      deepStrictEqual(outcome.error.payload.inResponseTo.id, request.id);
      deepStrictEqual(outcome.error.payload.inResponseTo.typeUri, TYPE_URI);
    });
    check("the error routes back to the transport-authenticated requester", () => {
      deepStrictEqual(outcome.error.recipient, request.issuer);
    });
  }

  // ---- ACT 4: identity cross-check and oracle suppression ------------------
  log("\n— act 4: §4.8.1 cross-check, and §8.1's oracle-suppression rule —");
  {
    // In-band issuer contradicts what the transport authenticated.
    const impersonation = makeRequest("55cafbe6-9718-4e54-df02-6d45a7edf605", {
      proof: STUB_PROOF,
      issuer: "did:example:carol",
    });
    const outcome = await consumeInbound({
      transport: aliceTransport,
      spec: SPEC,
      proofPolicy: { kind: "acceptUnverified" },
      doc: impersonation,
      myVid: aliceConn.did,
      now: Date.parse(NOW()),
      newErrorId,
      handler: () => {
        throw new Error("handler must not run for a contested identity");
      },
    });
    check("in-band issuer ≠ transport sender → identityMismatch, handler never runs", () => {
      deepStrictEqual(outcome.kind, "rejected");
      deepStrictEqual(outcome.error.payload.code, "identityMismatch");
    });
    check("the mismatch error is NOT addressed to the contested in-band issuer", () => {
      ok(outcome.error.recipient !== "did:example:carol");
    });

    // §8.1's suppression rule needs a precise construction: an identity
    // mismatch (both values present and disagreeing) while the transport
    // authenticated NO sender — so there is nobody safe to answer, and
    // answering the in-band party would be an oracle. A sender-side mismatch
    // can't produce this (it requires an authenticated sender), so the case is
    // a RECIPIENT mismatch on an unauthenticated channel: the delivery context
    // claims a different recipient than the document names.
    const misdelivered = makeRequest("77ecfdf8-b93a-4f76-f124-8f67c9fff807", {
      proof: STUB_PROOF,
    });
    const suppressed = await consumeInbound({
      transport: new StaticTransport({ recipient: "did:example:not-alice" }, BINDING_URI),
      spec: SPEC,
      proofPolicy: { kind: "acceptUnverified" },
      doc: misdelivered,
      myVid: bobConn.theirDid,
      now: Date.parse(NOW()),
      newErrorId,
      handler: () => {
        throw new Error("handler must not run");
      },
    });
    check("unauthenticated + contested identity → suppressed (no response at all)", () => {
      deepStrictEqual(suppressed.kind, "suppressed");
    });
  }

  // ---- ACT 5: the binding's case 2, as Credo actually behaves --------------
  log("\n— act 5: authcrypt from a verkey bound to no known DID (binding §3 case 2) —");
  {
    // Alice forgets the connection; bob's next envelope is cryptographically
    // sound but attributable to nobody alice knows. CARRIER-DEPENDENT finding:
    // under the 0.1 basic-message carriage this hard-failed inside Credo's
    // basic-message module ("No connection associated with incoming message"),
    // before any app code. Under the 0.2 dedicated @type, the envelope still
    // decrypts (the keys outlive the connection record) and Credo dispatches
    // to OUR handler with NO connection attached — case 2 now surfaces at the
    // app layer, which is exactly where the binding's three-way identity
    // split says it must be handled (map to UnauthenticatedTransport; never
    // treat the in-band issuer as authenticated).
    await alice.modules.didcomm.connections.deleteById(aliceConn.id);
    const arrival = nextDocumentFrom(alice);
    let observed = null;
    try {
      await sendDocument(bob, bobConn, makeRequest("66dbfcf7-a829-4f65-e013-7e56b8fef706", { proof: STUB_PROOF }));
    } catch (e) {
      observed = e;
    }
    const doc = await Promise.race([
      arrival,
      new Promise((r) => setTimeout(() => r(null), 3000)),
    ]);
    check("0.2 carriage: case 2 REACHES the handler (no hard failure) — unlike basic-message", () => {
      ok(observed === null, `unexpected transport error: ${observed}`);
      ok(doc !== null, "document did not arrive");
    });
    check("…but with NO connection attached — transport-unauthenticated, the app must treat it as such", () => {
      deepStrictEqual(alice.lastInboundHadConnection, false);
    });
  }
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
}

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (task layer over the didcomm-v1 carriage)`);
process.exit(0);
