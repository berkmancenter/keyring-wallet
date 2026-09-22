/**
 * ref-20 — the applicant half: a join request to a community over DIDComm,
 * through the mediator the community's DID document advertises.
 *
 * This is the wire Keyring speaks as Alice (community_vetting_subtask.md §3.1):
 *
 *   vtc/join-requests/manifest/0.2  → what the community requires
 *   vtc/join-requests/submit/0.2    → the application itself
 *
 * On this build there is no `POST /v1/join-requests` — the VTC's own
 * `openapi.json` publishes only `GET` on that path, so a join is a Trust Task
 * over messaging, not REST. The transport is `connectVtaViaMediator` from
 * `@openvtc/vti-didcomm-js`, the same helper ref-08 used against a VTA; the
 * community answers on its own `#didcomm` service.
 *
 * Usage:
 *   node join.mjs <communityDid> <mediatorDid> <command> [args]
 *     manifest
 *     submit <requirementsDigest> [vpJsonFile]
 *     status [requestId]
 *     withdraw [requestId]
 *
 * Env:
 *   APPLICANT_X25519_SECRET_KEY  reuse a holder across runs (printed on first).
 */
import { connectVtaViaMediator } from "@openvtc/vti-didcomm-js/vta-didcomm";
import * as multibase from "@openvtc/vti-didcomm-js/multibase";
import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { readFileSync } from "node:fs";
import WebSocketImpl from "ws";

const TASK_MANIFEST = "https://trusttasks.org/spec/vtc/join-requests/manifest/0.2";
const TASK_SUBMIT = "https://trusttasks.org/spec/vtc/join-requests/submit/0.2";
const TASK_STATUS = "https://trusttasks.org/spec/vtc/join-requests/status/0.1";
// WITHDRAW_TASK_URI overrides the version, to tell "not implemented" apart
// from "implemented under another version string".
const ENVELOPE_TYPE = "https://trusttasks.org/binding/didcomm/0.1/envelope";
const TASK_WITHDRAW =
  process.env.WITHDRAW_TASK_URI || "https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1";

const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h) => new Uint8Array(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

/**
 * One identity, two key types. The VTC refuses a document whose `issuer` is not
 * the DIDComm sender ("document issuer does not match the authenticated
 * holder"), so an applicant's member DID *is* its messaging DID. A `did:key`
 * Ed25519 identity carries a derived X25519 keyAgreement, which is what
 * authcrypt uses — the same shape Keyring's join persona needs.
 */
function ed25519Holder(seedHex) {
  const seed = hexToBytes(seedHex);
  const edPub = ed25519.getPublicKey(seed);
  const did = "did:key:" + multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, edPub);
  return {
    did,
    privateKey: ed25519.utils.toMontgomerySecret(seed),
    publicKey: ed25519.utils.toMontgomery(edPub),
    secretKeyHex: seedHex,
  };
}

function applicantHolder(secretKeyHex) {
  const privateKey = secretKeyHex ? hexToBytes(secretKeyHex) : x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const did = "did:key:" + multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, publicKey);
  return { did, privateKey, publicKey, secretKeyHex: bytesToHex(privateKey) };
}

async function main() {
  const [communityDid, mediatorDid, command, ...args] = process.argv.slice(2);
  if (!communityDid || !mediatorDid || !command) {
    console.error("usage: node join.mjs <communityDid> <mediatorDid> <manifest|submit> [args]");
    process.exit(1);
  }

  const holder = process.env.APPLICANT_ED25519_SECRET_KEY
    ? ed25519Holder(process.env.APPLICANT_ED25519_SECRET_KEY)
    : applicantHolder(process.env.APPLICANT_X25519_SECRET_KEY);
  console.log(`[ref-20] applicant ${holder.did}`);
  if (!process.env.APPLICANT_X25519_SECRET_KEY) {
    console.log(`[ref-20] (new holder — export APPLICANT_X25519_SECRET_KEY=${holder.secretKeyHex} to reuse it)`);
  }

  console.log(`[ref-20] connecting to ${communityDid.slice(0, 48)}… via the mediator …`);
  const client = await connectVtaViaMediator({
    vtaDid: communityDid,
    mediatorDid,
    clientDid: holder.did,
    clientX25519Private: holder.privateKey,
    clientX25519Public: holder.publicKey,
    WebSocketImpl,
  });
  console.log("[ref-20] connected.");

  // The VTC parses the DIDComm body as a whole Trust Task document
  // (`missing field \`id\`` otherwise), where a VTA accepts a bare payload.
  // The DIDComm identity (X25519) and the identity the community records as
  // the member (Ed25519, which can sign statements) are different keys. The
  // document says who is applying; the envelope says who sent it.
  const memberDid = process.env.APPLICANT_MEMBER_DID || holder.did;
  const doc = (type, payload) => ({
    id: `urn:uuid:${crypto.randomUUID()}`,
    type,
    payload,
    issuer: memberDid,
    recipient: communityDid,
    issuedAt: new Date().toISOString(),
  });

  if (command === "manifest") {
    const res = await client.sendAndWait(TASK_MANIFEST, doc(TASK_MANIFEST, {}));
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === "submit") {
    const [requirementsDigest, vpFile] = args;
    // A presentation the community can read. With no credentials to hand yet,
    // an empty `verifiableCredential` array is the honest shape: the verdict
    // should be `requestMore` naming the vetting need, which is exactly what
    // this rung wants to observe before Keyring builds the real one.
    const vp = vpFile
      ? JSON.parse(readFileSync(vpFile, "utf8"))
      : {
          "@context": ["https://www.w3.org/ns/credentials/v2"],
          type: ["VerifiablePresentation"],
          holder: holder.did,
          verifiableCredential: [],
        };
    const payload = {
      vp,
      registryConsent: false,
      extensions: requirementsDigest ? { requirementsDigest } : {},
    };
    const res = await client.sendAndWait(TASK_SUBMIT, doc(TASK_SUBMIT, payload));
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (command === "status") {
    const res = await client.sendAndWait(TASK_STATUS, doc(TASK_STATUS, { requestId: args[0] }));
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // Close this applicant's own open request. Here to answer one question
  // without a phone in the loop: does the community answer
  // `join-requests/withdraw/0.1` for a request it lists as deferred? A phone
  // that submits, is deferred, and then sees "the community did not answer"
  // cannot tell a reply lost once from a route that never answers — this
  // client asks the same community for the same verb over the same carriage,
  // and its answer (or its silence) is the community's, not the wallet's.
  // The id is optional, as it is for Keyring: without it the community
  // resolves the request from who is asking.
  if (command === "withdraw") {
    const payload = { ...(args[0] ? { requestId: args[0] } : {}), reason: "ref-20 probe" };
    // ENVELOPE=1 sends the same document under the binding envelope's type
    // instead of the task's own. Upstream's DIDComm router keys on the task
    // URI and is a hand-written second list; the envelope's one arm reaches
    // the dispatcher, so this tells "the service lacks the verb" apart from
    // "the DIDComm router was never told about the verb".
    const wireType = process.env.ENVELOPE ? ENVELOPE_TYPE : TASK_WITHDRAW;
    const res = await client.sendAndWait(wireType, doc(TASK_WITHDRAW, payload));
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // `task <typeUri> [jsonPayload]` — any Trust Task, to a VTA or a community,
  // as an identity the peer may not know. Added to read the exact refusal a
  // client receives when it asks before it is authorised: the VTA's own log
  // says "DID not in ACL", but what the wallet must match on is the document
  // that reaches it, which is not the same string.
  if (command === "task") {
    const [typeUri, payloadJson] = args;
    if (!typeUri) throw new Error("usage: task <typeUri> [jsonPayload]");
    const payload = payloadJson ? JSON.parse(payloadJson) : {};
    const res = await client.sendAndWait(typeUri, doc(typeUri, payload));
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  console.error(`unknown command ${command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`[ref-20] ${err.message}`);
  process.exit(1);
});
