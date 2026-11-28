// Settled send (VtiMediatorSession.sendToSettled), measured on a local affinidi-messaging-mediator.
//
// The question: when a client sends a routing/2.0 forward on its socket and then a messagepickup/3.0
// status-request (the "fence"), does the mediator's refusal of the forward (a problem-report, pthid = the forward's
// id) always arrive BEFORE the status answering the fence (thid = the fence's id)? And for a forward it takes, does
// the status arrive with no refusal at all? Also: how long a refusal takes (the plain bound's input).
//
// Frames are numbered as the socket delivers them, before any decrypt, so the order read is the wire order.
// The forward is built as VtiMediatorSession.forward builds it (data.json attachment, body.next, from the session DID).
//
// Rows:
//   R  CONTROL refused: a DID that never set SEND_FORWARDED forwards to an account here (e.p.authorization.send_forwarded)
//   D  CONTROL refused later in the handler: flag on, next hop has no account here (e.p.delivery.refused)
//   A  CONTROL accepted: flag on, next hop is an account here; it must receive every forward
//   P  plain bound: refusal latency over R and D; for A, no refusal within BOUND_MS after the forward
//
//   MEDIATOR_DID=... MEDIATOR_COMMIT=... TRIALS=20 BOUND_MS=5000 node settled-send-probe.mjs
// Run it from a folder with the same modules as wallet-s2.mjs (Credo 0.7.1-pr-2704, @openvtc/vti-didcomm-js, ws,
// canonicalize), against tsp-reference/ref-25-agent-pairing/lab/mediator.sh up mailbox.
import { createHash, randomUUID } from "node:crypto";
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";
import {
  Agent, PeerDidNumAlgo, Kms, TypedArrayEncoder, getPublicJwkFromVerificationMethod,
  createPeerDidDocumentFromServices, NewDidCommV2Service, NewDidCommV2ServiceEndpoint,
} from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { DidCommModule, DidCommV2EnvelopeService } from "@credo-ts/didcomm";
import canonicalize from "canonicalize";
import WebSocket from "ws";
import * as vti from "@openvtc/vti-didcomm-js";

const MEDIATOR_DID = process.env.MEDIATOR_DID;
if (!MEDIATOR_DID) throw new Error("MEDIATOR_DID is required");
const TRIALS = Number(process.env.TRIALS ?? 20);
const BOUND_MS = Number(process.env.BOUND_MS ?? 5000);

const ENVELOPE = "https://trusttasks.org/binding/didcomm/0.1/envelope";
const FORWARD = "https://didcomm.org/routing/2.0/forward";
const STATUS_REQUEST = "https://didcomm.org/messagepickup/3.0/status-request";
const STATUS = "https://didcomm.org/messagepickup/3.0/status";
const PLAIN = "application/didcomm-plain+json";
const T = (p) => `https://trusttasks.org/spec/messaging/${p}/0.1`;
const nowSec = () => Math.floor(Date.now() / 1000);
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => `urn:uuid:${randomUUID()}`;
let passed = 0, failed = 0;
async function row(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); }
}
const ok = (v, m) => { if (!v) throw new Error(m ?? "assertion failed"); };
const note = (s) => console.log(`      ${s}`);
const short = (d) => `${String(d).slice(0, 18)}…${String(d).slice(-6)}`;
const stats = (xs) => {
  if (!xs.length) return "none";
  const s = [...xs].sort((a, b) => a - b);
  return `n=${s.length} min=${s[0]} median=${s[Math.floor(s.length / 2)]} max=${s.at(-1)} ms`;
};

async function makeWallet(name) {
  const w = { name, frames: [], seq: 0, stored: 0 };
  w.agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: `settled-${name}-${Date.now()}`, key: `settled-${name}`, database: { type: "sqlite", config: { inMemory: true } } } }),
      didcomm: new DidCommModule({ didcommVersions: ["v1", "v2"], transports: { outbound: [] } }),
    },
  });
  await w.agent.initialize();
  return w;
}
async function mintDid(w, uri) {
  const key = await w.agent.kms.createKey({ type: { kty: "OKP", crv: "Ed25519" } });
  const publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk);
  const { didDocument, keys } = createPeerDidDocumentFromServices(
    [{ id: "x", serviceEndpoint: "https://example.invalid", recipientKeys: [publicJwk], routingKeys: [] }], true);
  didDocument.service = [new NewDidCommV2Service({ id: "#didcomm", serviceEndpoint: new NewDidCommV2ServiceEndpoint({ uri, accept: ["didcomm/v2"] }) })];
  const created = await w.agent.dids.create({ method: "peer", didDocument, options: { numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc, keys } });
  ok(created.didState.did, `mint failed: ${created.didState.state}`);
  return created.didState.did;
}
async function identityFor(w, did) {
  const { didDocument, keys } = await w.agent.dids.resolveCreatedDidDocumentWithKeys(did);
  const vmFor = (rel) => {
    const ref = didDocument[rel][0];
    const vm = typeof ref === "string" ? didDocument.dereferenceKey(ref, [rel]) : ref;
    const k = (keys ?? []).find((x) => vm.id.endsWith(x.didDocumentRelativeKeyId));
    ok(k, `no KMS key for ${vm.id}`);
    const jwk = getPublicJwkFromVerificationMethod(vm);
    jwk.keyId = k.kmsKeyId;
    return { vm, jwk };
  };
  const ka = vmFor("keyAgreement");
  const auth = vmFor("authentication");
  const authVmId = auth.vm.id.startsWith("#") ? `${did}${auth.vm.id}` : auth.vm.id;
  return { did, kid: ka.vm.id, senderKey: ka.jwk, authKey: auth.jwk, authVmId };
}
async function pack(w, plaintext) {
  const env = w.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
  const recipientKey = Kms.PublicJwk.fromPublicKey({ kty: "OKP", crv: "X25519", publicKey: w.mediator.x25519Pub });
  recipientKey.keyId = w.mediator.kid;
  return env.pack(w.agent.context, plaintext, { recipientKey, senderKey: w.me.senderKey, senderKeySkid: w.me.kid });
}
const wireTime = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
async function signTask(w, type, payload) {
  const doc = { id: uuid(), type, issuer: w.me.did, recipient: w.mediator.did, issuedAt: wireTime(), payload };
  const proofConfig = { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created: wireTime(), verificationMethod: w.me.authVmId, proofPurpose: "authentication" };
  const h = (v) => createHash("sha256").update(canonicalize(v)).digest();
  const { signature } = await w.agent.kms.sign({ keyId: w.me.authKey.keyId, data: new Uint8Array(Buffer.concat([h(proofConfig), h(doc)])), algorithm: "EdDSA" });
  return { ...doc, proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(signature)}` } };
}
/** The mediator's frames on w's socket, by wire order, waited for by `pred`. */
async function frameWhere(w, pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = w.frames.find((x) => x.plaintext && pred(x.plaintext));
    if (f) return f;
    await sleep(5);
  }
  return undefined;
}
async function login(w) {
  const res = await fetch(`${w.mediator.authEndpoint}/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ did: w.me.did }) });
  const challenge = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`challenge HTTP ${res.status} ${JSON.stringify(challenge).slice(0, 200)}`);
  const message = {
    id: uuid(), typ: PLAIN, type: "https://affinidi.com/atm/1.0/authenticate",
    from: w.me.did, to: [w.mediator.did], created_time: nowSec(), expires_time: nowSec() + 300,
    body: { challenge: challenge?.data?.challenge, session_id: challenge?.data?.session_id ?? challenge?.sessionId },
  };
  const resp = await fetch(w.mediator.authEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await pack(w, message)) });
  const auth = await resp.json().catch(() => ({}));
  if (!auth?.data?.access_token) throw new Error(`authenticate HTTP ${resp.status} ${JSON.stringify(auth).slice(0, 200)}`);
  w.jwt = auth.data.access_token;
}
async function openSocket(w) {
  const ws = new WebSocket(w.mediator.wsEndpoint, [`bearer.${w.jwt}`, "didcomm"]);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.on("message", (d) => {
    // Numbered on arrival, before the decrypt: the wire order, whatever order the decrypts finish in.
    const entry = { seq: ++w.seq, at: Date.now(), plaintext: undefined };
    w.frames.push(entry);
    const text = typeof d === "string" ? d : d.toString("utf8");
    (async () => {
      if (!vti.peekSkid(text)?.startsWith(w.mediator.did)) { w.stored++; return; }
      const env = w.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
      const mediatorJwk = Kms.PublicJwk.fromPublicKey({ kty: "OKP", crv: "X25519", publicKey: w.mediator.x25519Pub });
      const { plaintext } = await env.unpack(w.agent.context, JSON.parse(text), { recipientKey: w.me.senderKey, matchedKid: w.me.kid, resolveSenderKey: async () => mediatorJwk });
      if (plaintext.type === "https://didcomm.org/messagepickup/3.0/delivery") {
        const ids = (plaintext.attachments ?? []).map((a) => a.id).filter(Boolean);
        w.stored += ids.length;
        if (ids.length) ws.send(JSON.stringify(await pack(w, vti.buildMessagesReceived({ from: w.me.did, mediatorDid: w.mediator.did, messageIds: ids }))));
      }
      entry.plaintext = plaintext;
    })().catch((e) => note(`(${w.name} frame: ${e.message.slice(0, 120)})`));
  });
  w.socket = ws;
  ws.send(JSON.stringify(await pack(w, vti.buildLiveDeliveryChange({ from: w.me.did, mediatorDid: w.mediator.did }))));
  await sleep(300);
}
async function setFlag(w) {
  const doc = await signTask(w, T("account/update"), { did: sha256Hex(w.me.did), acl: { sendForwarded: true } });
  const msg = { id: uuid(), typ: PLAIN, type: ENVELOPE, from: w.me.did, to: [w.mediator.did], created_time: nowSec(), expires_time: nowSec() + 300, body: doc };
  w.socket.send(JSON.stringify(await pack(w, msg)));
  const f = await frameWhere(w, (p) => p.thid === msg.id || p.pthid === msg.id, 8000);
  ok(f && !String(f.plaintext.type).includes("problem-report"), `account/update: ${JSON.stringify(f?.plaintext?.body ?? "no answer").slice(0, 200)}`);
  ok(/"sendForwarded":true/.test(JSON.stringify(f.plaintext.body)), "the answer does not show sendForwarded on");
}

/** One settled send as the session makes it: the forward, then the fence, back to back on the socket. */
async function trial(w, next, { fence = true } = {}) {
  const inner = { protected: "e30", recipients: [{ header: { kid: `${next}#key-1` } }], iv: "aXY", ciphertext: "Y2lwaGVy", tag: "dGFn" };
  const forward = {
    id: uuid(), typ: PLAIN, type: FORWARD, from: w.me.did, to: [w.mediator.did],
    created_time: nowSec(), expires_time: nowSec() + 300, body: { next },
    attachments: [{ id: randomUUID(), data: { json: inner } }],
  };
  const fenceMsg = {
    id: uuid(), typ: PLAIN, type: STATUS_REQUEST, from: w.me.did, to: [w.mediator.did],
    created_time: nowSec(), expires_time: nowSec() + 300, return_route: "all", body: { recipient_did: w.me.did },
  };
  const packedForward = JSON.stringify(await pack(w, forward));
  const packedFence = fence ? JSON.stringify(await pack(w, fenceMsg)) : undefined;
  const t0 = Date.now();
  w.socket.send(packedForward);
  if (packedFence) w.socket.send(packedFence);
  const isRefusal = (p) => String(p.type).includes("problem-report") && (p.pthid === forward.id || p.thid === forward.id);
  const isFence = (p) => p.type === STATUS && p.thid === fenceMsg.id;
  // Wait for the fence (if asked), then the rest of the bound for any refusal, so a late refusal is seen too.
  const fenceFrame = fence ? await frameWhere(w, isFence, BOUND_MS) : undefined;
  const refusal = await frameWhere(w, isRefusal, Math.max(0, BOUND_MS - (Date.now() - t0)));
  // A frame still being decrypted is not lost: give the last ones a moment.
  await sleep(50);
  return {
    refusal: refusal && { seq: refusal.seq, ms: refusal.at - t0, code: refusal.plaintext.body?.code },
    fence: fenceFrame && { seq: fenceFrame.seq, ms: fenceFrame.at - t0 },
  };
}

const mediator = await vti.resolveMediator(MEDIATOR_DID, { allowInsecure: true });
console.log(`settled-send-probe — ${process.env.MEDIATOR_COMMIT ?? "commit unstated"}, mediator ${short(MEDIATOR_DID)}, ${TRIALS} trials a row, bound ${BOUND_MS} ms`);
const sender = await makeWallet("sender"), unflagged = await makeWallet("unflagged"), addressee = await makeWallet("addressee");
const all = [sender, unflagged, addressee];
try {
  for (const w of all) { w.mediator = mediator; w.me = await identityFor(w, await mintDid(w, mediator.did)); await login(w); await openSocket(w); }
  const nowhere = await mintDid(addressee, "did:web:elsewhere.example");
  const refusedMs = [];

  await row(`R CONTROL refused (no SEND_FORWARDED): every refusal arrives on the wire before the fence's status`, async () => {
    const order = [];
    for (let i = 0; i < TRIALS; i++) {
      const r = await trial(unflagged, addressee.me.did);
      ok(r.refusal, `trial ${i}: no refusal`);
      ok(r.fence, `trial ${i}: no fence answer`);
      ok(/send_forwarded/.test(r.refusal.code), `trial ${i}: refusal ${r.refusal.code}`);
      order.push(r.refusal.seq < r.fence.seq);
      refusedMs.push(r.refusal.ms);
    }
    note(`refusal before fence in ${order.filter(Boolean).length}/${TRIALS}; code e.p.authorization.send_forwarded`);
    ok(order.every(Boolean), "a fence answer arrived before its forward's refusal");
  });

  await row("set SEND_FORWARDED on the sender (messaging/account/update, the self-grant)", async () => { await setFlag(sender); });

  await row(`D CONTROL refused later in the handler (flag on, next hop has no account): refusal before the fence's status`, async () => {
    const order = [];
    for (let i = 0; i < TRIALS; i++) {
      const r = await trial(sender, nowhere);
      ok(r.refusal, `trial ${i}: no refusal`);
      ok(r.fence, `trial ${i}: no fence answer`);
      order.push(r.refusal.seq < r.fence.seq);
      refusedMs.push(r.refusal.ms);
      if (i === 0) note(`code ${r.refusal.code}`);
    }
    note(`refusal before fence in ${order.filter(Boolean).length}/${TRIALS}`);
    ok(order.every(Boolean), "a fence answer arrived before its forward's refusal");
  });

  const fenceMs = [];
  await row(`A CONTROL accepted (flag on, next hop an account here): the fence's status, no refusal within ${BOUND_MS} ms, and the addressee gets every forward`, async () => {
    const before = addressee.stored;
    for (let i = 0; i < TRIALS; i++) {
      const r = await trial(sender, addressee.me.did);
      ok(r.fence, `trial ${i}: no fence answer`);
      ok(!r.refusal, `trial ${i}: refused ${r.refusal?.code}`);
      fenceMs.push(r.fence.ms);
    }
    await sleep(500);
    note(`addressee received ${addressee.stored - before} of ${TRIALS}; fence answered: ${stats(fenceMs)}`);
    ok(addressee.stored - before === TRIALS, "the addressee did not receive every accepted forward");
  });

  await row(`P plain bound: how long a refusal takes (R and D), and an accepted forward without a fence draws no refusal within ${BOUND_MS} ms`, async () => {
    note(`refusal after the forward: ${stats(refusedMs)}`);
    const r = await trial(sender, addressee.me.did, { fence: false });
    ok(!r.refusal, `refused ${r.refusal?.code}`);
  });
} finally {
  for (const w of all) { try { w.socket?.close(); } catch {} try { await w.agent.shutdown(); } catch {} }
}
console.log(`\nsettled-send-probe: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
