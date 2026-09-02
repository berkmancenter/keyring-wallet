/**
 * ref-08 phase 2 — the actual credential-exchange/query send, over DIDComm
 * via the mediator (the piece run.mjs's REST client structurally cannot
 * reach — see its README's "What this proves" #3).
 *
 * Uses @openvtc/vti-didcomm-js's connectVtaViaMediator/sendAndWait — the
 * real ecosystem's own DIDComm v2 client, not a hand-rolled encryption
 * layer (unlike run.mjs's Data-Integrity proof, which deliberately mirrors
 * the Rust construction by hand to prove Keyring's signer independently;
 * there is no equivalent reason to hand-roll ECDH-1PU here).
 *
 * Usage: node run-messaging.mjs <vtaConfigPath> <vtaDid> <mediatorDid>
 *   vtaConfigPath — the running VTA's config.toml, for the offline
 *                   `vta import-did` ACL grant this script prints if needed.
 */
import { connectVtaViaMediator } from "@openvtc/vti-didcomm-js/vta-didcomm";
import { x25519 } from "@noble/curves/ed25519.js";
import * as multibase from "@openvtc/vti-didcomm-js/multibase";
import WebSocketImpl from "ws";

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}

/** A did:key:z6LS... holder — native X25519 (not derived from an Ed25519 key). */
function generateX25519Holder(secretKeyHex) {
  const privateKey = secretKeyHex ? hexToBytes(secretKeyHex) : x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const did = "did:key:" + multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, publicKey);
  return { did, privateKey, publicKey, secretKeyHex: bytesToHex(privateKey) };
}

const TASK_CREDENTIAL_EXCHANGE_QUERY =
  process.env.QUERY_TYPE_URI || "https://trusttasks.org/spec/credential-exchange/query/0.1";

function minimalDcqlQuery(vct) {
  return { credentials: [{ id: "membership", format: "dc+sd-jwt", meta: { vct_values: [vct] } }] };
}

async function main() {
  const [vtaConfigPath, vtaDid, mediatorDid] = process.argv.slice(2);
  if (!vtaConfigPath || !vtaDid || !mediatorDid) {
    console.error("usage: node run-messaging.mjs <vtaConfigPath> <vtaDid> <mediatorDid>");
    process.exit(1);
  }

  const holder = generateX25519Holder(process.env.VERIFIER_X25519_SECRET_KEY);
  console.log(`[ref-08-messaging] verifier holder: ${holder.did}`);
  if (!process.env.VERIFIER_X25519_SECRET_KEY) {
    console.log(`[ref-08-messaging] (new holder — export VERIFIER_X25519_SECRET_KEY=${holder.secretKeyHex} to reuse it,`);
    console.log(`[ref-08-messaging]  and grant it ACL — stop the VTA daemon, then:`);
    console.log(`[ref-08-messaging]  vta --config ${vtaConfigPath} import-did --did ${holder.did} --role initiator`);
    console.log(`[ref-08-messaging]  — then restart the daemon and re-run with the env var set.)`);
  }

  console.log(`[ref-08-messaging] connecting to VTA ${vtaDid} via mediator ${mediatorDid} ...`);
  let client;
  try {
    client = await connectVtaViaMediator({
      vtaDid,
      mediatorDid,
      clientDid: holder.did,
      clientX25519Private: holder.privateKey,
      clientX25519Public: holder.publicKey,
      WebSocketImpl,
    });
  } catch (err) {
    console.error(`[ref-08-messaging] connect failed: ${err.message}`);
    console.error(err.stack);
    return;
  }
  console.log("[ref-08-messaging] connected.");

  const body = {
    dcql_query: minimalDcqlQuery("https://openvtc.org/credentials/MembershipCredential"),
    nonce: crypto.randomUUID(),
    purpose: "ref-08: prove the query/defer wire path over DIDComm",
  };

  try {
    const response = await client.sendAndWait(TASK_CREDENTIAL_EXCHANGE_QUERY, body);
    console.log("[ref-08-messaging] response:");
    console.log(JSON.stringify(response, null, 2));
  } catch (err) {
    console.error(`[ref-08-messaging] sendAndWait failed: ${err.message}`);
    console.error(err.stack);
  }
}

main();
