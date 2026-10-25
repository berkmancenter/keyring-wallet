// Scratch probe (2026-08-18, e2e M2 investigation — docs/spikes/e2e-vrc-connect-findings.md):
// does the prod mediator still deliver via PickUpV2 LIVE MODE after the
// recipient's websocket has sat idle ~90s? The wallet uses PickUpV2LiveMode;
// if the mediator's proxy kills idle websockets, live delivery dies silently
// and messages strand until a reconnect that live mode never triggers.
//
// PASS  = delivery after idle works → ws-idle theory dead, look elsewhere.
// FAIL  = timeout → mediator ws idle-timeout confirmed as the app-level cause.

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

const IDLE_MS = Number(process.env.IDLE_MS ?? 3_000);

const MEDIATOR_URL =
  process.env.MEDIATOR_URL ??
  "https://credo-mediator.asml.berkmancenter.org/invitation?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJhZjAzZjhjMS05NWE1LTRlZjMtYjBkMy03ZTFmNWNlY2E1YzIiLCJsYWJlbCI6Ik15IE1lZGlhdG9yIiwiZ29hbF9jb2RlIjoibWVkaWF0b3IiLCJnb2FsIjoiTWVkaWF0b3IgSW52aXRhdGlvbiIsImFjY2VwdCI6WyJkaWRjb21tL2FpcDEiLCJkaWRjb21tL2FpcDI7ZW52PXJmYzE5Il0sImhhbmRzaGFrZV9wcm90b2NvbHMiOlsiaHR0cHM6Ly9kaWRjb21tLm9yZy9kaWRleGNoYW5nZS8xLjEiLCJodHRwczovL2RpZGNvbW0ub3JnL2Nvbm5lY3Rpb25zLzEuMCJdLCJzZXJ2aWNlcyI6W3siaWQiOiIjaW5saW5lLTAiLCJzZXJ2aWNlRW5kcG9pbnQiOiJodHRwczovL2NyZWRvLW1lZGlhdG9yLmFzbWwuYmVya21hbmNlbnRlci5vcmciLCJ0eXBlIjoiZGlkLWNvbW11bmljYXRpb24iLCJyZWNpcGllbnRLZXlzIjpbImRpZDprZXk6ejZNa3FIMmlKQzl6M1BQblZwV0tESGFkUVBBaEZFV3JIUXZobmZVUE1nOUVWNmRBIl0sInJvdXRpbmdLZXlzIjpbXX0seyJpZCI6IiNpbmxpbmUtMSIsInNlcnZpY2VFbmRwb2ludCI6IndzczovL2NyZWRvLW1lZGlhdG9yLmFzbWwuYmVya21hbmNlbnRlci5vcmciLCJ0eXBlIjoiZGlkLWNvbW11bmljYXRpb24iLCJyZWNpcGllbnRLZXlzIjpbImRpZDprZXk6ejZNa3FIMmlKQzl6M1BQblZwV0tESGFkUVBBaEZFV3JIUXZobmZVUE1nOUVWNmRBIl0sInJvdXRpbmdLZXlzIjpbXX1dfQ";

const DOC = {
  id: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d02",
  type: "https://trusttasks.org/spec/acl/grant/0.1",
  threadId: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d02",
  payload: { entry: { subject: "did:sov:alice", role: "admin" } },
};

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
    config: { label: `ref06v1d-idle-${name}` },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref06v1di-${name}-${Date.now()}`, key: `ref06v1di-testkey-${name}` },
      }),
      didcomm: new DidCommModule({
        connections: { autoAcceptConnections: true },
        mediationRecipient: {
          mediatorInvitationUrl: MEDIATOR_URL,
          // match the wallet: live-mode pickup over the mediator websocket
          mediatorPickupStrategy: DidCommMediatorPickupStrategy.PickUpV2, mediatorPollingInterval: 5000,
        },
      }),
    },
  });
  agent.modules.didcomm.registerOutboundTransport(new DidCommWsOutboundTransport());
  agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport());
  await agent.initialize();
  return agent;
}

console.log(`idle probe — PickUpV2 POLLING delivery (queue store-and-forward test)`);
console.log(`  mediator: ${new URL(MEDIATOR_URL).host}`);

setTimeout(() => {
  console.error("\nFAIL — global watchdog: run exceeded 360s");
  process.exit(1);
}, 360_000);

const alice = await makeMediatedAgent("alice");
console.log("  · alice initialized (mediation granted, live mode)");
const bob = await makeMediatedAgent("bob");
console.log("  · bob initialized (mediation granted, live mode)");

let outcome = 1;
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
  const [alicePending] = await alice.modules.didcomm.connections.findAllByOutOfBandId(invitation.id);
  await alice.modules.didcomm.connections.returnWhenIsConnected(alicePending.id, { timeoutMs: 60000 });
  console.log("  · mediated connection up — now going idle …");

  await new Promise((r) => setTimeout(r, IDLE_MS));
  console.log(`  · ${IDLE_MS / 1000}s idle elapsed — bob sends now`);

  const sender = bob.dependencyManager.resolve(DidCommMessageSender);
  await sender.sendMessage(
    new DidCommOutboundMessageContext(
      new TrustTaskMessage({ document: DOC, threadId: DOC.threadId }),
      { agentContext: bob.context, connection: bobConn }
    )
  );
  console.log("  · sent — waiting for alice's live-mode delivery …");

  const doc = await Promise.race([
    received,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("timeout: no live-mode delivery within 60s after idle")), 60000)
    ),
  ]);
  deepStrictEqual(doc, DOC);
  console.log("\nPASS — delivery survives the idle window (ws-idle theory dead)");
  outcome = 0;
} catch (e) {
  console.error(`\nFAIL — ${e.message}`);
  console.error("      (consistent with the mediator dropping idle websockets; live mode never recovers)");
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
}
process.exit(outcome);
