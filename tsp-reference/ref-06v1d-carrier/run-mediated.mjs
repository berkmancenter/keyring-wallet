// ref-06v1d, mediated variant — the dedicated @type through the REAL Keyring
// mediator. Theory says a mediator cannot discriminate by @type (the type is
// inside the encrypted envelope); this proves it empirically, completing the
// carrier evidence: both carriages now have the same mediated-path proof.

import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { deepStrictEqual } from "node:assert";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import {
  DidCommModule,
  DidCommMessage,
  DidCommMessageSender,
  DidCommMessageHandlerRegistry,
  DidCommOutboundMessageContext,
  DidCommHttpOutboundTransport,
  DidCommWsOutboundTransport,
  DidCommMediatorPickupStrategy,
  parseMessageType,
  IsValidMessageType,
} from "@credo-ts/didcomm";

const QUIET = process.argv.includes("--quiet");
const log = (...a) => QUIET || console.log(...a);

const MEDIATOR_URL =
  process.env.MEDIATOR_URL ??
  "https://credo-mediator.asml.berkmancenter.org/invitation?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJhZjAzZjhjMS05NWE1LTRlZjMtYjBkMy03ZTFmNWNlY2E1YzIiLCJsYWJlbCI6Ik15IE1lZGlhdG9yIiwiZ29hbF9jb2RlIjoibWVkaWF0b3IiLCJnb2FsIjoiTWVkaWF0b3IgSW52aXRhdGlvbiIsImFjY2VwdCI6WyJkaWRjb21tL2FpcDEiLCJkaWRjb21tL2FpcDI7ZW52PXJmYzE5Il0sImhhbmRzaGFrZV9wcm90b2NvbHMiOlsiaHR0cHM6Ly9kaWRjb21tLm9yZy9kaWRleGNoYW5nZS8xLjEiLCJodHRwczovL2RpZGNvbW0ub3JnL2Nvbm5lY3Rpb25zLzEuMCJdLCJzZXJ2aWNlcyI6W3siaWQiOiIjaW5saW5lLTAiLCJzZXJ2aWNlRW5kcG9pbnQiOiJodHRwczovL2NyZWRvLW1lZGlhdG9yLmFzbWwuYmVya21hbmNlbnRlci5vcmciLCJ0eXBlIjoiZGlkLWNvbW11bmljYXRpb24iLCJyZWNpcGllbnRLZXlzIjpbImRpZDprZXk6ejZNa3FIMmlKQzl6M1BQblZwV0tESGFkUVBBaEZFV3JIUXZobmZVUE1nOUVWNmRBIl0sInJvdXRpbmdLZXlzIjpbXX0seyJpZCI6IiNpbmxpbmUtMSIsInNlcnZpY2VFbmRwb2ludCI6IndzczovL2NyZWRvLW1lZGlhdG9yLmFzbWwuYmVya21hbmNlbnRlci5vcmciLCJ0eXBlIjoiZGlkLWNvbW11bmljYXRpb24iLCJyZWNpcGllbnRLZXlzIjpbImRpZDprZXk6ejZNa3FIMmlKQzl6M1BQblZwV0tESGFkUVBBaEZFV3JIUXZobmZVUE1nOUVWNmRBIl0sInJvdXRpbmdLZXlzIjpbXX1dfQ";

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

// The same ~25-line dedicated carrier as run.mjs.
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

async function makeMediatedAgent(name) {
  const agent = new Agent({
    config: { label: `ref06v1d-${name}` },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref06v1dm-${name}-${Date.now()}`, key: `ref06v1dm-testkey-${name}` },
      }),
      didcomm: new DidCommModule({
        connections: { autoAcceptConnections: true },
        mediationRecipient: {
          mediatorInvitationUrl: MEDIATOR_URL,
          mediatorPickupStrategy: DidCommMediatorPickupStrategy.Implicit,
        },
      }),
    },
  });
  agent.modules.didcomm.registerOutboundTransport(new DidCommWsOutboundTransport());
  agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport());
  await agent.initialize();
  return agent;
}

log("ref-06v1d (mediated) — the dedicated @type through the real Keyring mediator");
log(`  mediator: ${new URL(MEDIATOR_URL).host}`);

// Global watchdog: nothing in this script may take longer than 2 minutes.
// agent.initialize() (mediation provisioning) has no internal timeout, so a
// slow mediator would otherwise hang the run silently.
setTimeout(() => {
  console.error("\nFAIL — global watchdog: run exceeded 120s (likely mediation provisioning)");
  process.exit(1);
}, 120000);

const alice = await makeMediatedAgent("alice");
log("  · alice initialized (mediation granted)");
const bob = await makeMediatedAgent("bob");
log("  · bob initialized (mediation granted)");

try {
  const received = new Promise((resolve) => {
    alice.dependencyManager.resolve(DidCommMessageHandlerRegistry).registerMessageHandler({
      supportedMessages: [TrustTaskMessage],
      handle: async (ctx) => {
        resolve(ctx.message.document);
        return undefined;
      },
    });
  });

  const invitation = await alice.modules.didcomm.oob.createInvitation({ label: "alice" });
  const { connectionRecord } = await bob.modules.didcomm.oob.receiveInvitation(
    invitation.outOfBandInvitation,
    { label: "bob" }
  );
  const bobConn = await bob.modules.didcomm.connections.returnWhenIsConnected(
    connectionRecord.id,
    { timeoutMs: 60000 }
  );
  const [alicePending] = await alice.modules.didcomm.connections.findAllByOutOfBandId(
    invitation.id
  );
  await alice.modules.didcomm.connections.returnWhenIsConnected(alicePending.id, {
    timeoutMs: 60000,
  });
  log("  · mediated connection up");

  const sender = bob.dependencyManager.resolve(DidCommMessageSender);
  await sender.sendMessage(
    new DidCommOutboundMessageContext(
      new TrustTaskMessage({ document: DOC, threadId: DOC.threadId }),
      { agentContext: bob.context, connection: bobConn }
    )
  );
  log("  · sent — waiting for alice's pickup from the mediator …");

  const doc = await Promise.race([
    received,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("timeout waiting for mediated delivery (60s)")), 60000)
    ),
  ]);

  check("the dedicated @type crosses the real mediator (store-and-forward + pickup)", () => {
    deepStrictEqual(doc, DOC);
  });
  const aliceChat = await alice.modules.didcomm.basicMessages.findAllByQuery({});
  check("and still leaves the chat store empty end-to-end", () => {
    deepStrictEqual(aliceChat.length, 0);
  });
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
}

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (dedicated @type, mediated)`);
process.exit(0);
