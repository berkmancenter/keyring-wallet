// ref-06v1d — the carrier question, measured instead of argued.
//
// The drafted binding rides Aries basic-message with the document in ~attach.
// The framework editor's open question (#173, "time-sensitive"): is
// basic-message the right carrier at all, or should Trust Tasks have a
// dedicated message @type? This rung builds the identical exchange BOTH ways
// and measures the three things the decision turns on:
//
//   1  Implementation cost — what a dedicated type actually requires in Credo
//      (spoiler: a small message class + one handler registration).
//   2  Chat pollution — what each carriage leaves in the wallet's chat store,
//      which in Keyring is a real user-facing surface.
//   3  Graceful degradation — what a Trust-Task-UNAWARE wallet does when it
//      receives each (the "reach" argument for basic-message, tested).

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

const DOC = {
  id: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  type: "https://trusttasks.org/spec/acl/grant/0.1",
  threadId: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  payload: { entry: { subject: "did:sov:alice", role: "admin" } },
};

// ================= CARRIAGE A — dedicated @type (the whole module) ==========
// Everything between these fences is the complete "dedicated type" cost in
// Credo: one message class, one handler object, one registration call.

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
// class-validator wiring the way Credo's own message classes do it —
// the one line that keeps the dispatcher's type-check happy:
IsValidMessageType(TrustTaskMessage.type)(TrustTaskMessage.prototype, "type");

function registerTrustTaskHandler(agent, onDocument) {
  agent.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
    supportedMessages: [TrustTaskMessage],
    handle: async (messageContext) => {
      onDocument(messageContext.message.document, messageContext);
      return undefined; // no synchronous reply
    },
  });
}
// ============================================================================

// ---------------- CARRIAGE B — basic-message + ~attach (as drafted) ---------

const ATTACHMENT_ID = "trust-task";
function buildBasicMessageCarriage(doc) {
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

// ------------------------------------------------------------- plumbing ----

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
        store: { id: `ref06v1d-${name}-${Date.now()}`, key: `ref06v1d-testkey-${name}` },
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

async function send(fromAgent, connection, message) {
  const sender = fromAgent.dependencyManager.resolve(DidCommMessageSender);
  await sender.sendMessage(
    new DidCommOutboundMessageContext(message, { agentContext: fromAgent.context, connection })
  );
}

async function chatRecordCount(agent) {
  const records = await agent.modules.didcomm.basicMessages.findAllByQuery({});
  return records.length;
}

// ------------------------------------------------------------------ cast ----

log("ref-06v1d — carrier comparison: dedicated @type vs basic-message+~attach");

const alice = await makeAgent("alice");     // Trust-Task-aware
const bob = await makeAgent("bob");         // Trust-Task-aware sender
const vanilla = await makeAgent("vanilla"); // a wallet that has never heard of Trust Tasks

try {
  const ab = await connect(alice, bob, "alice", "bob");       // alice ↔ bob
  const vb = await connect(vanilla, bob, "vanilla", "bob");   // vanilla ↔ bob

  // ---- ACT 1: the dedicated @type, between two aware agents ----------------
  log("\n— act 1: dedicated @type between aware agents —");
  {
    const received = new Promise((resolve) => registerTrustTaskHandler(alice, resolve));
    await send(bob, ab.bConn, new TrustTaskMessage({ document: DOC, threadId: DOC.threadId }));
    const doc = await Promise.race([
      received,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
    ]);
    check("the document arrives byte-identical through a dedicated message type", () => {
      deepStrictEqual(doc, DOC);
    });
    const [a, b] = [await chatRecordCount(alice), await chatRecordCount(bob)];
    check("dedicated type leaves the chat store EMPTY on both sides", () => {
      deepStrictEqual(a, 0);
      deepStrictEqual(b, 0);
    });
  }

  // ---- ACT 2: basic-message carriage, same document, same peers ------------
  log("\n— act 2: basic-message+~attach between the same aware agents —");
  {
    const received = new Promise((resolve) => {
      alice.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, (ev) => {
        if (ev.payload.basicMessageRecord.role === "receiver")
          resolve(ev.payload.message.appendedAttachments?.[0]?.getDataAsJson());
      });
    });
    await send(bob, ab.bConn, buildBasicMessageCarriage(DOC));
    const doc = await Promise.race([
      received,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
    ]);
    check("the document arrives byte-identical through basic-message+~attach", () => {
      deepStrictEqual(doc, DOC);
    });
  }

  // ---- the pollution measurement, after one exchange per carriage ----------
  {
    const [aliceChat, bobChat] = [await chatRecordCount(alice), await chatRecordCount(bob)];
    check("chat pollution: the basic-message carriage pollutes the RECEIVER's chat store", () => {
      // Both acts ran between alice and bob. The dedicated type left nothing;
      // basic-message left one record on the receiver. (The sender's store
      // stays empty only because we bypass the chat API — a real client using
      // basicMessages.sendMessage would pollute both sides.)
      deepStrictEqual(aliceChat, 1);
      deepStrictEqual(bobChat, 0);
    });
    log(`  · chat records after both acts — alice(receiver): ${aliceChat}, bob(sender): ${bobChat}`);
  }

  // ---- ACT 3: the unaware wallet, receiving each carriage ------------------
  log("\n— act 3: a Trust-Task-unaware wallet receives each carriage —");
  {
    // 3a — basic-message: expected to degrade gracefully into a chat bubble.
    let basicOutcome = "delivered";
    try {
      await send(bob, vb.bConn, buildBasicMessageCarriage(DOC));
    } catch (e) {
      basicOutcome = `sender error: ${e.message.slice(0, 100)}`;
    }
    const vanillaChat = await chatRecordCount(vanilla);
    check("unaware wallet + basic-message: delivered, shows as a harmless chat line", () => {
      deepStrictEqual(basicOutcome, "delivered");
      deepStrictEqual(vanillaChat, 1);
    });
    const [record] = await vanilla.modules.didcomm.basicMessages.findAllByQuery({});
    log(`  · what the unaware user sees in chat: "${record.content}"`);

    // 3b — dedicated type: no handler registered on vanilla. Observe.
    let dedicatedOutcome = "delivered silently";
    try {
      await send(bob, vb.bConn, new TrustTaskMessage({ document: DOC, threadId: DOC.threadId }));
    } catch (e) {
      dedicatedOutcome = `processing failure surfaced: ${String(e.message).slice(0, 140)}`;
    }
    log(`  · observed for the dedicated type at an unaware wallet: ${dedicatedOutcome}`);
    const vanillaChatAfter = await chatRecordCount(vanilla);
    check("unaware wallet's chat stays clean of the dedicated-type message", () => {
      deepStrictEqual(vanillaChatAfter, 1); // still just the act-3a bubble
    });
  }
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
  await vanilla.shutdown().catch(() => {});
}

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (carrier comparison)`);
process.exit(0);
