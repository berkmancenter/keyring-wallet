// ref-06v1b — the didcomm-v1 Trust Task binding through the REAL Keyring
// mediator (credo-mediator.asml.berkmancenter.org).
//
// ref-06v1 proved the carriage with the network elided. This rung restores the
// network: two Credo agents each enrol with the production mediator, the
// connection between them is mediator-routed, and the bound document rides
// bob → mediator (store/forward) → alice's pickup session. Everything ref-06v1
// asserted must still hold, including the urn:uuid refusal.

// Native binding first — askar-shared snapshots its export for ESM importers.
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";

import { deepStrictEqual } from "node:assert";

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
  DidCommOutboundMessageContext,
  DidCommHttpOutboundTransport,
  DidCommWsOutboundTransport,
  DidCommMediatorPickupStrategy,
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

const ATTACHMENT_ID = "trust-task";
const DOC = {
  id: "urn:uuid:0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  type: "https://trusttasks.org/spec/acl/grant/0.1",
  threadId: "urn:uuid:0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  parentThreadId: "urn:uuid:7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
  payload: { entry: { subject: "did:sov:alice", role: "admin" } },
};
const DOC_TRANSPORT_SAFE = {
  ...DOC,
  id: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  threadId: "0f39d1f6-2f6b-4e9a-8f21-4e0c0a5b9d01",
  parentThreadId: "7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
};

function buildBindingMessage(doc) {
  const message = new DidCommBasicMessage({ content: `Trust Task: ${doc.type}` });
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

async function makeMediatedAgent(name) {
  const agent = new Agent({
    config: { label: `ref06v1b-${name}` },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref06v1b-${name}-${Date.now()}`, key: `ref06v1b-testkey-${name}` },
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

log("ref-06v1b — the binding through the real Keyring mediator");
log(`  mediator: ${new URL(MEDIATOR_URL).host}`);

const alice = await makeMediatedAgent("alice");
log("  · alice initialized");
const bob = await makeMediatedAgent("bob");
log("  · bob initialized");

try {
  check("both agents hold a granted default mediator", () => {
    // initialization would have thrown otherwise; assert the records exist
    if (!alice.modules.didcomm.mediationRecipient) throw new Error("no mediationRecipient api");
  });

  const invitation = await alice.modules.didcomm.oob.createInvitation({ label: "alice" });
  const inviteService = invitation.outOfBandInvitation.getServices()[0];
  check("alice's invitation routes through the mediator (not a local endpoint)", () => {
    const endpoint =
      typeof inviteService === "string" ? inviteService : inviteService.serviceEndpoint;
    if (!/berkmancenter\.org/.test(String(endpoint)))
      throw new Error(`unexpected endpoint: ${JSON.stringify(endpoint)}`);
  });

  const { connectionRecord } = await bob.modules.didcomm.oob.receiveInvitation(
    invitation.outOfBandInvitation,
    { label: "bob" }
  );
  const bobConn = await bob.modules.didcomm.connections.returnWhenIsConnected(
    connectionRecord.id,
    { timeoutMs: 60000 }
  );
  const [aliceConnPending] = await alice.modules.didcomm.connections.findAllByOutOfBandId(
    invitation.id
  );
  await alice.modules.didcomm.connections.returnWhenIsConnected(aliceConnPending.id, {
    timeoutMs: 60000,
  });
  log(`  · mediated connection up (handshake crossed the real mediator)`);

  const sender = bob.dependencyManager.resolve(DidCommMessageSender);

  // 2a — the urn:uuid refusal must reproduce identically: it is client-side
  // validation, so the mediator must make no difference.
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
    check("SAME BEHAVIOR: Credo refuses urn:uuid: ~thread ids — mediator changes nothing", () => {
      if (!refusal) throw new Error("expected the urn:uuid refusal to reproduce — it did not");
      if (!/threadId/.test(refusal.message))
        throw new Error(`rejected for a different reason: ${refusal.message.slice(0, 200)}`);
    });
  }

  // 2b — transport-safe document through the real store-and-forward path.
  const received = new Promise((resolve) => {
    alice.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageStateChanged, (ev) => {
      if (ev.payload.basicMessageRecord.role === "receiver") resolve(ev.payload);
    });
  });

  const DOC2 = DOC_TRANSPORT_SAFE;
  await sender.sendMessage(
    new DidCommOutboundMessageContext(buildBindingMessage(DOC2), {
      agentContext: bob.context,
      connection: bobConn,
    })
  );
  log("  · sent — waiting for alice's pickup from the mediator …");

  const { message: receivedMessage } = await Promise.race([
    received,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("timeout waiting for mediated delivery (60s)")), 60000)
    ),
  ]);

  check("the ~attach decorator survives the full mediated path", () => {
    const attachments = receivedMessage.appendedAttachments;
    if (!attachments?.length) throw new Error("appendedAttachments empty on receive");
    deepStrictEqual(attachments[0].id, ATTACHMENT_ID);
  });
  check("the recovered document is byte-identical after the real hop", () => {
    deepStrictEqual(receivedMessage.appendedAttachments[0].getDataAsJson(), DOC2);
  });
  check("~thread arrived intact through the mediator", () => {
    deepStrictEqual(receivedMessage.threadId, DOC2.threadId);
    deepStrictEqual(receivedMessage.thread?.parentThreadId, DOC2.parentThreadId);
  });
  check("content stays the human-readable summary", () => {
    deepStrictEqual(receivedMessage.content, `Trust Task: ${DOC2.type}`);
  });
} finally {
  await alice.shutdown().catch(() => {});
  await bob.shutdown().catch(() => {});
}

if (failures) {
  console.error(`\nFAIL — ${failures} of ${checks + failures} checks failed`);
  process.exit(1);
}
console.log(`\nPASS — ${checks} checks (real-mediator carriage)`);
process.exit(0);
