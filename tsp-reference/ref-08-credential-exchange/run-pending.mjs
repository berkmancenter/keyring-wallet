/**
 * ref-08 phase 3 — the defer -> pending-list -> pending-approve -> present
 * half of credential-exchange/query (trust_tasks_subtask.md §9 step 4's
 * remaining "still open" item). Phases 1-2 (run.mjs, run-messaging.mjs)
 * proved REST auth and the not-found fast path (nothing held could ever
 * match); this rung mints a held credential, receives it into a fresh VTA,
 * queries it from a not-pre-trusted verifier over DIDComm, then acts as the
 * VTA's own admin to read the deferral back and approve it.
 *
 * Self-contained: brings up its own disposable mediator + VTA
 * (e2e/lib/mediator.js, e2e/lib/vta.js) rather than taking them as CLI args
 * like run.mjs/run-messaging.mjs, because this rung needs the daemon paused
 * mid-run for four offline ops (three ACL grants — an issuer "initiator" DID
 * for receive, a verifier "initiator" DID for the query, and an "admin" DID
 * for the pending-* surface — plus minting a VTA-managed holder did:key for
 * the credential's `credentialSubject.id`) — batching them under one
 * pause/resume.
 *
 * Usage: node run-pending.mjs
 */
import WebSocketImpl from "ws";
import { x25519 } from "@noble/curves/ed25519.js";
import * as multibase from "@openvtc/vti-didcomm-js/multibase";
import { connectVtaViaMediator } from "@openvtc/vti-didcomm-js/vta-didcomm";

import { startMediator } from "../../e2e/lib/mediator.js";
import { startVta, importDid, createDidKey } from "../../e2e/lib/vta.js";
import { generateDidKeyHolder, signDocument } from "./di-proof.mjs";

const TASK_AUTH_AUTHENTICATE = "https://trusttasks.org/spec/auth/authenticate/0.1";
const TASK_VAULT_CREDENTIALS_RECEIVE = "https://trusttasks.org/spec/vault/credentials/receive/0.1";
const TASK_CREDENTIAL_EXCHANGE_QUERY =
  process.env.QUERY_TYPE_URI || "https://trusttasks.org/spec/credential-exchange/query/0.1";
// Exact wire constants from vta-sdk/src/protocols/credential_exchange.rs —
// note these are `pending/{list,approve}/0.1`, NOT the `pending-list/1.0`
// spelling vta-service's own doc comments use elsewhere; the dispatch table
// registers the SDK constants, which are the ones below.
const TASK_PENDING_LIST = "https://trusttasks.org/spec/credential-exchange/pending/list/0.1";
const TASK_PENDING_APPROVE = "https://trusttasks.org/spec/credential-exchange/pending/approve/0.1";

const MEMBERSHIP_TYPE = "MembershipCredential";

/** A did:key:z6LS... holder — native X25519 (not derived from an Ed25519 key). */
function generateX25519Holder() {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const did = "did:key:" + multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, publicKey);
  return { did, privateKey, publicKey };
}

async function postTrustTask(url, body, bearer) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** REST DID-auth handshake (challenge -> authenticate) -> bearer access token. */
async function authenticate(vtaUrl, vtaDid, holder) {
  const challenge = await postTrustTask(`${vtaUrl}/auth/challenge`, { subject: holder.did });
  if (challenge.status !== 200) {
    throw new Error(`auth/challenge for ${holder.did} -> ${challenge.status}: ${JSON.stringify(challenge.body)}`);
  }
  const { challenge: nonce, sessionId } = challenge.body;
  const unsigned = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: TASK_AUTH_AUTHENTICATE,
    payload: { challenge: nonce, sessionId, scope: [] },
    issuer: holder.did,
    recipient: vtaDid,
    issuedAt: new Date().toISOString(),
  };
  const authResult = await postTrustTask(`${vtaUrl}/auth/`, signDocument(unsigned, holder));
  if (authResult.status !== 200) {
    throw new Error(`auth/ for ${holder.did} -> ${authResult.status}: ${JSON.stringify(authResult.body)}`);
  }
  return authResult.body.payload?.tokens?.accessToken ?? authResult.body.tokens?.accessToken;
}

async function callTrustTask(vtaUrl, vtaDid, holder, accessToken, type, payload) {
  const doc = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    type,
    payload,
    issuer: holder.did,
    recipient: vtaDid,
    issuedAt: new Date().toISOString(),
  };
  return postTrustTask(`${vtaUrl}/api/trust-tasks`, signDocument(doc, holder), accessToken);
}

function log(label, value) {
  console.log(`[ref-08-pending] ${label}`);
  if (value !== undefined) console.log(JSON.stringify(value, null, 2));
}

async function main() {
  let mediator, vta;
  try {
    log("bringing up a disposable mediator + messaging-enabled VTA...");
    mediator = await startMediator();
    vta = await startVta({ mediatorDid: mediator.mediatorDid });
    log(`VTA ${vta.vtaDid} @ ${vta.vtaUrl}, mediator ${mediator.mediatorDid}`);

    const issuerHolder = generateDidKeyHolder(); // signs + receives the VC (initiator role)
    const verifierHolder = generateX25519Holder(); // sends the query (initiator role, not pre-trusted)
    const adminHolder = generateDidKeyHolder(); // reads/approves the deferral (admin role)

    log("granting ACL roles + minting the holder key (daemon paused for the offline ops)...");
    await vta.pauseDaemon();
    await importDid(vta.configPath, issuerHolder.did, "initiator");
    await importDid(vta.configPath, verifierHolder.did, "initiator");
    await importDid(vta.configPath, adminHolder.did, "admin");
    // The credential's `credentialSubject.id` must be a did:key the VTA
    // itself manages (derived from its own seed) — `resolve_holder_keys`
    // (vta-service/src/operations/holder_keys.rs) refuses to sign a
    // presentation for any subject it doesn't hold the private key for, and
    // an externally-generated did:key (like issuerHolder/adminHolder above)
    // doesn't qualify. Reuses the `"vta"` context `startVta`'s own admin key
    // already created (so it's guaranteed to exist — an unknown context
    // makes the CLI prompt interactively).
    const holderDid = await createDidKey(vta.configPath, "vta", "ref-08-holder");
    await vta.resumeDaemon();
    log(
      `granted: issuer ${issuerHolder.did} (initiator), verifier ${verifierHolder.did} ` +
        `(initiator), admin ${adminHolder.did} (admin); minted VTA-managed holder key ${holderDid}`
    );

    // 1. Mint + receive the held credential.
    const vc = signDocument(
      {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential", MEMBERSHIP_TYPE],
        issuer: issuerHolder.did,
        credentialSubject: { id: holderDid },
      },
      issuerHolder
    );
    log("minted membership VC:", vc);

    const issuerToken = await authenticate(vta.vtaUrl, vta.vtaDid, issuerHolder);
    const receive = await callTrustTask(
      vta.vtaUrl,
      vta.vtaDid,
      issuerHolder,
      issuerToken,
      TASK_VAULT_CREDENTIALS_RECEIVE,
      { credential: vc }
    );
    log(`vault/credentials/receive/0.1 -> ${receive.status}`, receive.body);
    if (receive.status !== 200) throw new Error("receive failed — stopping here");

    // 2. Query it from a not-pre-trusted verifier, over DIDComm via the mediator.
    log("connecting the verifier to the VTA via the mediator...");
    const client = await connectVtaViaMediator({
      vtaDid: vta.vtaDid,
      mediatorDid: mediator.mediatorDid,
      clientDid: verifierHolder.did,
      clientX25519Private: verifierHolder.privateKey,
      clientX25519Public: verifierHolder.publicKey,
      WebSocketImpl,
    });
    // `claims` must name at least one path: an omitted `claims` ("the
    // credential as a whole") leaves the matched disclosure set empty, and
    // `vta-vault/src/consent.rs`'s consent record refuses to authorize an
    // empty reveal set (default-deny) — approval 400s with "consent claims
    // must be non-empty" if this is left out.
    const dcqlQuery = {
      credentials: [
        {
          id: "membership",
          format: "ldp_vc",
          meta: { type_values: [MEMBERSHIP_TYPE] },
          claims: [{ path: ["type"] }],
        },
      ],
    };
    const queryResponse = await client.sendAndWait(TASK_CREDENTIAL_EXCHANGE_QUERY, {
      dcql_query: dcqlQuery,
      nonce: crypto.randomUUID(),
      purpose: "ref-08 phase 3: prove the defer/pending-list/pending-approve/present path",
    });
    log("credential-exchange/query/0.1 response:", queryResponse);

    // 3. As admin: list + approve the deferral (if it deferred rather than
    //    auto-presenting — either outcome is real signal, logged either way).
    const adminToken = await authenticate(vta.vtaUrl, vta.vtaDid, adminHolder);
    const pendingList = await callTrustTask(
      vta.vtaUrl,
      vta.vtaDid,
      adminHolder,
      adminToken,
      TASK_PENDING_LIST,
      {}
    );
    log(`credential-exchange/pending/list/0.1 -> ${pendingList.status}`, pendingList.body);

    const pending = pendingList.body?.payload?.pending ?? pendingList.body?.pending;
    if (!pending || pending.length === 0) {
      log(
        "no pending deferrals — the query above must have auto-answered " +
          "(present, or not-found) rather than deferred; see its response above."
      );
      return;
    }

    const approve = await callTrustTask(
      vta.vtaUrl,
      vta.vtaDid,
      adminHolder,
      adminToken,
      TASK_PENDING_APPROVE,
      { id: pending[0].id }
    );
    log(`credential-exchange/pending/approve/0.1 -> ${approve.status}`, approve.body);
    if (approve.status === 200 && approve.body?.payload?.vp_token) {
      log("SUCCESS: defer -> pending-list -> pending-approve -> present proven (vp_token above).");
    } else {
      throw new Error("pending-approve did not return a vp_token — see response above");
    }
  } finally {
    // Guarded: either can be unset if startMediator/startVta itself threw
    // before assigning — still tear down whichever did come up.
    if (vta) await vta.stop();
    if (mediator) await mediator.stop();
  }
}

main().catch((err) => {
  console.error(`[ref-08-pending] failed: ${err.message}`);
  console.error(err.stack);
  process.exitCode = 1;
});
