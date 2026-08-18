// ref-06v1e — the binding-0.2 @type shape, probed on Credo before answering.
//
// Glenn's ask (#173 / #216): he chose an RFC 0020 message type URI for the
// dedicated carriage —
//
//   https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task
//   └───────────── doc-uri ────────────────┘ └protocol─┘ └ver┘ └msg┘
//
// — with the BINDING version (0.2) inside the doc-uri and a separate RFC 0020
// protocol version (1.0). "You have the deployment experience; if Credo's
// routing or discover-features wants a different shape, say so — nothing
// depends on it yet."
//
// This rung answers with Credo 0.6.3 behavior, not taste:
//   act 1 — does the URI decompose the way Aries tooling expects?
//   act 2 — does it route? (baseline)
//   act 3 — which version slot carries RFC 0020's minor-tolerance? (the 1.0)
//   act 4 — what happens across a BINDING bump (0.2 → 0.3)? (new protocol
//           identity: the aware handler never fires)
//   act 5 — discover-features: what does a peer have to ask to see the
//           protocol across binding versions? (a wildcard on the doc-uri)

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
  DidCommFeatureRegistry,
  DidCommFeatureQuery,
  DidCommProtocol,
  parseMessageType,
  IsValidMessageType,
} from "@credo-ts/didcomm";

// canHandleMessageType is not re-exported from the package root; load it from
// the build file directly (the exports map blocks the bare subpath).
import { pathToFileURL } from "node:url";
const { canHandleMessageType } = await import(
  pathToFileURL("./node_modules/@credo-ts/didcomm/build/util/messageType.mjs").href
);

const QUIET = process.argv.includes("--quiet");
const log = (...a) => QUIET || console.log(...a);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const TYPE_02 = "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task";
const TYPE_02_MINOR = "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.3/task";
const TYPE_03 = "https://trusttasks.org/binding/didcomm-v1/0.3/trust-task/1.0/task";
const TYPE_02_MAJOR2 = "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/2.0/task";

const DOC = {
  id: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  type: "https://trusttasks.org/spec/acl/grant/0.1",
  threadId: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  payload: { entry: { subject: "did:sov:alice", role: "admin" } },
};

// A message class per @type under test — the 0.2 handler is registered ONCE,
// for TrustTask02Message; every other class simulates traffic from elsewhere.
function makeMessageClass(typeUri) {
  class M extends DidCommMessage {
    constructor(options) {
      super();
      if (options) {
        this.id = options.id ?? this.generateId();
        this.document = options.document;
        if (options.threadId) this.setThread({ threadId: options.threadId });
      }
    }
    type = M.type.messageTypeUri;
    static type = parseMessageType(typeUri);
  }
  IsValidMessageType(M.type)(M.prototype, "type");
  return M;
}
const TrustTask02Message = makeMessageClass(TYPE_02);
const TrustTask02MinorMessage = makeMessageClass(TYPE_02_MINOR);
const TrustTask03Message = makeMessageClass(TYPE_03);
const TrustTask02Major2Message = makeMessageClass(TYPE_02_MAJOR2);

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
        store: { id: `ref06v1e-${name}-${Date.now()}`, key: `ref06v1e-testkey-${name}` },
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

// ------------------------------------------------------------------ acts ----

log("ref-06v1e — binding-0.2 @type shape, probed on Credo 0.6.3\n");

log("— act 1: RFC 0020 decomposition —");
{
  const t = parseMessageType(TYPE_02);
  check("protocol name decomposes to 'trust-task' (as §1 intends)", () =>
    deepStrictEqual(t.protocolName, "trust-task"));
  check("protocol version decomposes to 1.0 (major 1, minor 0)", () =>
    deepStrictEqual([t.protocolMajorVersion, t.protocolMinorVersion], [1, 0]));
  check("message name decomposes to 'task'", () => deepStrictEqual(t.messageName, "task"));
  check("the BINDING version (0.2) lands inside the doc-uri — invisible to Aries version tooling", () =>
    ok(t.documentUri.endsWith("/binding/didcomm-v1/0.2")));
}

const alice = await makeAgent("alice"); // aware: handler registered for 0.2 / 1.0
const bob = await makeAgent("bob");     // sender of everything

try {
  const ab = await connect(alice, bob, "alice", "bob");

  let received = [];
  alice.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
    supportedMessages: [TrustTask02Message],
    handle: async (ctx) => { received.push(ctx.message.type); return undefined; },
  });
  const settle = () => new Promise((r) => setTimeout(r, 1500));

  log("\n— act 2: baseline routing —");
  await send(bob, ab.bConn, new TrustTask02Message({ document: DOC, threadId: DOC.threadId }));
  await settle();
  check("0.2/trust-task/1.0/task is delivered to the registered handler", () =>
    deepStrictEqual(received, [TYPE_02]));

  log("\n— act 3: the protocol-version slot carries the tolerance —");
  received = [];
  check("canHandleMessageType: a 1.0 handler accepts 1.3 (same major → compatible)", () =>
    ok(canHandleMessageType(TrustTask02Message, parseMessageType(TYPE_02_MINOR))));
  await send(bob, ab.bConn, new TrustTask02MinorMessage({ document: DOC, threadId: DOC.threadId }));
  await settle();
  check("…and live traffic agrees: 1.3-typed message reaches the 1.0 handler", () =>
    deepStrictEqual(received, [TYPE_02_MINOR]));

  log("\n— act 4: a binding bump is a NEW protocol identity —");
  received = [];
  check("canHandleMessageType: the 0.2 handler does NOT accept a 0.3-doc-uri type", () =>
    ok(!canHandleMessageType(TrustTask02Message, parseMessageType(TYPE_03))));
  let dispatchError;
  await send(bob, ab.bConn, new TrustTask03Message({ document: DOC, threadId: DOC.threadId }))
    .catch((e) => { dispatchError = e; });
  await settle();
  check("live traffic agrees: the 0.3-typed message never reaches the 0.2 handler", () =>
    deepStrictEqual(received, []));
  check("the receiver's dispatcher rejects it as unhandled (visible here only because in-proc surfaces receiver errors to the sender — over HTTP/WS the sender never learns)", () =>
    ok(dispatchError !== undefined));
  check("control: protocol major 2.0 under the SAME binding is also refused — that slot does version work", () =>
    ok(!canHandleMessageType(TrustTask02Message, parseMessageType(TYPE_02_MAJOR2))));

  log("\n— act 5: discover-features across binding versions —");
  {
    const registry = alice.dependencyManager.resolve(DidCommFeatureRegistry);
    const q = (match) => registry.query(new DidCommFeatureQuery({ featureType: "protocol", match }));
    const pid = parseMessageType(TYPE_02).protocolUri;
    check("registering a message handler does NOT add the protocol to discover-features — the binding must say to register it explicitly", () =>
      ok(q(pid).length === 0));
    registry.register(new DidCommProtocol({ id: pid, roles: ["requester", "responder"] }));
    check("once registered, the protocol is queryable by its exact 0.2 protocol id", () =>
      ok(q(pid).length === 1));
    check("an exact 0.3 query sees NOTHING — binding versions do not cross-match", () =>
      ok(q(parseMessageType(TYPE_03).protocolUri).length === 0));
    check("a doc-uri wildcard (…/binding/didcomm-v1/*) is what spans binding versions", () =>
      ok(q("https://trusttasks.org/binding/didcomm-v1/*").length >= 1));
  }
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
}

log(`\n${checks} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
