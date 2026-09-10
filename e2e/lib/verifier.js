// A minimal `credential-exchange/query` verifier for the e2e harness.
//
// Not a real vta-service: this is a raw, disposable Credo Node agent
// (Askar-backed, HTTP transport through a cloudflared tunnel — the same
// reachability pattern e2e/lib/witness.js already proves for a real Android
// emulator/device) that speaks binding 0.2's TrustTaskMessage directly, the
// same wire format the wallet's own DidCommV1Carriage uses. Modeled on
// tsp-reference/ref-06v1-didcomm-v1-binding's makeAgent (two Credo agents
// speaking the binding) and witness-server/src/trustTasks/
// WitnessTaskSessions.ts's registerMessageHandler shape — both already
// proven; this file itself has NOT been run against a real device (see
// e2e/README.md and docs/plans/openvtc-integration-plan/2026-09-04-bam.md).
//
// A full vta-service binary is unnecessary here: credential-exchange/query
// is just a Trust Task document over an authenticated DIDComm connection,
// same as every other Trust Task in this codebase — no ACL/REST/DID-auth
// handshake is part of the spec itself (that machinery is vta-service's own
// admin surface, exercised separately by tsp-reference/ref-08).
//
// Imports resolve into `bifold/node_modules`/`bifold/packages` by RELATIVE
// PATH rather than as e2e's own npm dependencies: e2e is deliberately
// outside the yarn workspaces (root CLAUDE.md), so it has no ordinary way to
// depend on `@bifold/trust-tasks` (a workspace-only package) or on the exact
// PATCHED `@credo-ts/*` versions bifold's own install already resolved
// (`.yarn/patches/`) without those patches. Reusing bifold's already-correct
// install avoids silently running against unpatched crypto. Verified these
// specific paths resolve (Node's exports-aware resolution, `node -e`
// smoke-checks) before relying on them; not otherwise exercised.
import { randomUUID } from "node:crypto";

import { askarNodeJS as askar } from "../../bifold/node_modules/@openwallet-foundation/askar-nodejs/build/index.js";
import { Agent } from "../../bifold/node_modules/@credo-ts/core/build/index.mjs";
import { agentDependencies, DidCommHttpInboundTransport } from "../../bifold/node_modules/@credo-ts/node/build/index.mjs";
import { AskarModule } from "../../bifold/node_modules/@credo-ts/askar/build/index.mjs";
import {
  DidCommModule,
  DidCommMessageHandlerRegistry,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
  DidCommHttpOutboundTransport,
} from "../../bifold/node_modules/@credo-ts/didcomm/build/index.mjs";
import { TrustTaskMessage } from "../../bifold/packages/trust-tasks/build/index.js";

import { startTunnel, assertPortFree } from "./witness.js";

const CREDENTIAL_EXCHANGE_PRESENT_TYPE_URI =
  "https://trusttasks.org/spec/credential-exchange/present/0.1";
const CREDENTIAL_EXCHANGE_QUERY_TYPE_URI =
  "https://trusttasks.org/spec/credential-exchange/query/0.1";

/**
 * Start the verifier agent. Returns a handle with everything the e2e script
 * needs: an invitation URL for the wallet to paste, a way to wait for the
 * resulting connection, sending the query, and awaiting the answer.
 */
export async function startVerifier(port = Number(process.env.VERIFIER_PORT || 9201)) {
  await assertPortFree(port);
  const tunnel = await startTunnel(port);

  const agent = new Agent({
    config: { label: "e2e-verifier" },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `e2e-verifier-${Date.now()}`, key: "e2e-verifier-testkey" },
      }),
      didcomm: new DidCommModule({
        endpoints: [tunnel.url],
        connections: { autoAcceptConnections: true },
      }),
    },
  })
  agent.modules.didcomm.registerInboundTransport(new DidCommHttpInboundTransport({ port }))
  agent.modules.didcomm.registerOutboundTransport(new DidCommHttpOutboundTransport())
  await agent.initialize()

  let presentResolvers = [];
  const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry);
  registry.registerMessageHandler({
    supportedMessages: [TrustTaskMessage],
    handle: async (ctx) => {
      const document = ctx.message.document;
      if (document?.type === CREDENTIAL_EXCHANGE_PRESENT_TYPE_URI) {
        presentResolvers.forEach((resolve) => resolve(document));
        presentResolvers = [];
      }
    },
  });

  return {
    agent,

    async stop() {
      await agent.shutdown().catch(() => {});
      await tunnel.stop();
    },

    /** An OOB invitation URL, in the same format acceptInvitationViaPaste expects. */
    async createInvitation() {
      const invitation = await agent.modules.didcomm.oob.createInvitation({ label: "e2e-verifier" });
      return {
        url: invitation.outOfBandInvitation.toUrl({ domain: tunnel.url }),
        invitationId: invitation.id,
      };
    },

    /**
     * Poll until the wallet's connection to this invitation completes.
     * `returnWhenIsConnected` has its OWN internal timeout (Credo's default:
     * 20s — DidCommConnectionService.returnWhenIsConnected), independent of
     * this function's own `timeoutMs` poll loop; a real mediator round trip
     * through a live cloudflared tunnel can exceed that default under load,
     * so it must be passed through explicitly rather than left to default.
     */
    async waitForConnection(invitationId, timeoutMs = 60000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [pending] = await agent.modules.didcomm.connections.findAllByOutOfBandId(invitationId);
        if (pending) {
          return agent.modules.didcomm.connections.returnWhenIsConnected(pending.id, {
            timeoutMs: Math.max(deadline - Date.now(), 1000),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error("timed out waiting for the wallet to connect");
    },

    /** Send credential-exchange/query on an established connection. */
    async sendCredentialExchangeQuery(connection, { dcqlQuery, nonce, purpose }) {
      const sender = agent.dependencyManager.container.resolve(DidCommMessageSender);
      const id = randomUUID();
      const document = {
        id,
        type: CREDENTIAL_EXCHANGE_QUERY_TYPE_URI,
        threadId: id,
        issuer: connection.did,
        recipient: connection.theirDid,
        issuedAt: new Date().toISOString(),
        payload: { dcql_query: dcqlQuery, nonce, purpose },
      };
      await sender.sendMessage(
        new DidCommOutboundMessageContext(new TrustTaskMessage({ document }), {
          agentContext: agent.context,
          connection,
        })
      );
      return id;
    },

    /** Resolves with the payload of the next credential-exchange/present received. */
    waitForPresent(timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        presentResolvers.push(resolve);
        setTimeout(() => reject(new Error("timed out waiting for credential-exchange/present")), timeoutMs);
      });
    },
  };
}
