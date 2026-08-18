// ref-06v1 — Credo 0.6.3 speaking the drafted Trust Tasks DIDComm v1 binding.
//
// Two parts:
//   1. Shape conformance: build the binding's basic-message (+ reserved
//      `trust-task` attachment) with Credo's own message classes and compare it
//      against the frozen fixture emitted by the upstream reference
//      implementation (trust-tasks-didcomm-v1, Rust).
//   2. Live carriage: two in-process Credo agents connect (real v1 authcrypt)
//      and the document rides connection-encrypted end to end; the receiver
//      recovers it from the `~attach` decorator byte-identically.
//
// The same @credo-ts/* 0.6.3 the Keyring app ships. Node runtime only — Hermes
// is ref-08's job.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deepStrictEqual } from "node:assert";

// The native binding MUST be imported before any @credo-ts module: askar-shared
// snapshots its `askar` export for ESM importers, so registration has to have
// happened by the time credo's module graph evaluates.
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import {
  DidCommModule,
  DidCommBasicMessage,
  DidCommBasicMessageEventTypes,
  DidCommAttachment,
  DidCommAttachmentData,
  DidCommMessageSender,
  DidCommMessageReceiver,
  DidCommOutboundMessageContext,
} from "@credo-ts/didcomm";

const QUIET = process.argv.includes("--quiet");
const here = dirname(fileURLToPath(import.meta.url));
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

// The binding's two interchangeable basic-message type URIs — spec §1 says a
// consumer MUST treat them as equivalent and MUST NOT compare @type by string
// equality.
const TYPE_URIS = [
  "did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/basicmessage/1.0/message",
  "https://didcomm.org/basicmessage/1.0/message",
];
const ATTACHMENT_ID = "trust-task";

// The same document the fixture generator fed the Rust reference impl.
// `urn:uuid:` ids, as every example in the binding spec and the framework uses.
const DOC = {
  id: "urn:uuid:0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  type: "https://trusttasks.org/spec/acl/grant/0.1",
  threadId: "urn:uuid:0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  parentThreadId: "urn:uuid:7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
  payload: { entry: { subject: "did:sov:alice", role: "admin" } },
};

// The same document with ids that satisfy Aries RFC 0008's thread-id shape
// ([-_./A-Za-z0-9]{8,64}) — a bare UUID fits; a urn:uuid: URI does not.
const DOC_TRANSPORT_SAFE = {
  ...DOC,
  id: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  threadId: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  parentThreadId: "7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
};

// ---------------------------------------------------------------- part 1 ----

function buildBindingMessage(doc) {
  const message = new DidCommBasicMessage({
    content: `Trust Task: ${doc.type}`,
  });
  message.setThread({ threadId: doc.threadId, parentThreadId: doc.parentThreadId });
  message.appendedAttachments = [
    new DidCommAttachment({
      id: ATTACHMENT_ID,
      mimeType: "application/json",
      data: new DidCommAttachmentData({ json: doc }),
    }),
  ];
  return message;
}

function shapeConformance() {
  log("\n— part 1: shape conformance against the Rust reference fixture —");
  const fixture = JSON.parse(
    readFileSync(join(here, "fixtures", "reference-basic-message.json"), "utf8")
  );
  const ours = buildBindingMessage(DOC).toJSON();

  check("both @type values are members of the binding's equivalence class", () => {
    if (!TYPE_URIS.includes(fixture["@type"])) throw new Error(`fixture: ${fixture["@type"]}`);
    if (!TYPE_URIS.includes(ours["@type"])) throw new Error(`credo: ${ours["@type"]}`);
  });
  check("~thread maps threadId→thid and parentThreadId→pthid on both sides", () => {
    deepStrictEqual(ours["~thread"].thid, fixture["~thread"].thid);
    deepStrictEqual(ours["~thread"].pthid, fixture["~thread"].pthid);
  });
  check("content is the same human-readable summary", () => {
    deepStrictEqual(ours.content, fixture.content);
  });
  check("the reserved attachment matches: @id, mime-type, document JSON", () => {
    const f = fixture["~attach"][0];
    const o = ours["~attach"][0];
    deepStrictEqual(o["@id"], f["@id"]);
    deepStrictEqual(o["mime-type"], f["mime-type"]);
    deepStrictEqual(o.data.json, f.data.json);
  });
  check("divergence is confined to volatile/optional members", () => {
    // Everything Credo adds beyond the fixture must be in the known set —
    // anything new is a real divergence and should fail loudly.
    // ~transport: Credo decorates outbound messages with return-route; the
    // reference impl does not. Both are fine — Aries consumers tolerate
    // unknown decorators — but it is a divergence worth naming (see
    // UPSTREAM-FEEDBACK.md).
    const known = new Set(["@id", "sent_time", "~l10n", "~transport", "~timing", "~please_ack", "~service"]);
    for (const [k, v] of Object.entries(ours)) {
      if (v === undefined) continue;
      if (!(k in fixture) && !known.has(k)) throw new Error(`unexpected member ${k}`);
    }
  });
  return { fixture, ours };
}

// ---------------------------------------------------------------- part 2 ----

// In-process transport pair: outbound resolves the peer agent by endpoint and
// hands the authcrypt-packed payload to its MessageReceiver. The envelope work
// (pack/unpack) is entirely real; only the socket is elided.
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
        store: { id: `ref06v1-${name}-${Date.now()}`, key: `ref06v1-testkey-${name}` },
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
  return agent;
}

async function liveCarriage() {
  log("\n— part 2: live carriage over Credo v1 authcrypt, agent to agent —");
  const alice = await makeAgent("alice");
  const bob = await makeAgent("bob");

  try {
    const invitation = await alice.modules.didcomm.oob.createInvitation({ label: "alice" });
    const { connectionRecord } = await bob.modules.didcomm.oob.receiveInvitation(
      invitation.outOfBandInvitation,
      { label: "bob" }
    );
    const bobConn = await bob.modules.didcomm.connections.returnWhenIsConnected(
      connectionRecord.id
    );
    const [aliceConnPending] = await alice.modules.didcomm.connections.findAllByOutOfBandId(
      invitation.id
    );
    await alice.modules.didcomm.connections.returnWhenIsConnected(aliceConnPending.id);
    log(`  · connection up (bob→alice theirDid ${bobConn.theirDid})`);

    const sender = bob.dependencyManager.resolve(DidCommMessageSender);

    // 2a — the discovered incompatibility, asserted so it stays visible:
    // the binding's `urn:uuid:` ids fail Credo's RFC 0008 thread-id validation.
    {
      let refusal;
      try {
        await sender.sendMessage(
          new DidCommOutboundMessageContext(buildBindingMessage(DOC), {
            agentContext: bob.context,
            connection: bobConn,
          })
        );
      } catch (e) {
        refusal = e;
      }
      check("KNOWN INCOMPATIBILITY: Credo refuses urn:uuid: ids in ~thread (RFC 0008 regex)", () => {
        if (!refusal) throw new Error("expected Credo to reject urn:uuid thread ids — it no longer does; re-examine the binding note");
        if (!/threadId/.test(refusal.message)) throw new Error(`rejected for a different reason: ${refusal.message.slice(0, 200)}`);
      });
    }

    // 2b — full carriage with transport-representable ids.
    const received = new Promise((resolve) => {
      alice.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, (ev) => {
        if (ev.payload.basicMessageRecord.role === "receiver") resolve(ev.payload);
      });
    });

    const DOC2 = DOC_TRANSPORT_SAFE;
    const message = buildBindingMessage(DOC2);
    await sender.sendMessage(
      new DidCommOutboundMessageContext(message, {
        agentContext: bob.context,
        connection: bobConn,
      })
    );

    const { message: receivedMessage, basicMessageRecord } = await Promise.race([
      received,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout waiting for message")), 15000)),
    ]);

    check("the ~attach decorator survives Credo's authcrypt pack/unpack", () => {
      const attachments = receivedMessage.appendedAttachments;
      if (!attachments?.length) throw new Error("appendedAttachments empty on receive");
      deepStrictEqual(attachments[0].id, ATTACHMENT_ID);
    });
    check("the recovered document is byte-identical to what was sent", () => {
      deepStrictEqual(receivedMessage.appendedAttachments[0].getDataAsJson(), DOC2);
    });
    check("~thread arrived intact (thid = threadId, pthid = parentThreadId)", () => {
      deepStrictEqual(receivedMessage.threadId, DOC2.threadId);
      deepStrictEqual(receivedMessage.thread?.parentThreadId, DOC2.parentThreadId);
    });
    check("content stays the human-readable summary (what a chat UI shows)", () => {
      deepStrictEqual(receivedMessage.content, `Trust Task: ${DOC2.type}`);
    });
    check("the transport-authenticated sender is the connection's theirDid", () => {
      // §4.8.1's cross-check input: alice attributes the message to the DID her
      // connection record binds bob's verkey to.
      deepStrictEqual(basicMessageRecord.connectionId, aliceConnPending.id);
    });
    check("Credo's persisted BasicMessageRecord keeps content but NOT the attachment", () => {
      // A finding, asserted so we notice if it changes: consumers must dispatch
      // from the live message, not the stored record.
      if (basicMessageRecord.content !== `Trust Task: ${DOC.type}`)
        throw new Error("record content unexpected");
      if ("appendedAttachments" in basicMessageRecord)
        throw new Error("record unexpectedly persists attachments now");
    });
  } finally {
    await alice.shutdown().catch(() => {});
    await bob.shutdown().catch(() => {});
  }
}

// -------------------------------------------------------------------- run ---

log("ref-06v1 — Credo 0.6.3 × trust-tasks didcomm-v1 binding (draft 0.1)");
shapeConformance();
await liveCarriage();

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (shape conformance + live carriage)`);
