// M3 S2 + wake, on affinidi-messaging-mediator v0.53.0 (f6ed8159), open sign-up (explicit_deny).
//
// The mailbox design of ../affinidi-local-1120/wallet-mailbox.mjs (one mailbox DID per phone, pairwise contact DIDs,
// sends as routing/2.0 forwards over the sender's own session), plus signed Trust Tasks to the mediator:
//   messaging/account/update  the phone turns on its own SEND_FORWARDED (the default grants only SEND_FORWARDED_CHANGE)
//   messaging/wake/set        the phone gives its mediator a push-gateway handle
//   messaging/wake/request    a sender asks the addressee's mediator to ring it, naming the stored message ids
// A stand-in gateway ("gw") is an account on the same mediator, so rings are stored and delivered to it like mail.
//
// PHASE=main          rows A1-A4, B, W1-W4, F (pauses for the Redis search), rate probe
// PHASE=after-switch  E: alice (same keys, same mailbox DID) signs in again; a new DID is refused
// PHASE=relay         an anonymous forward POSTed to /inbound; EXPECT=refused|accepted
//
//   MEDIATOR_DID=... STATE_DIR=... PHASE=main node wallet-s2.mjs
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";
import {
  Agent, PeerDidNumAlgo, Kms, TypedArrayEncoder, getPublicJwkFromVerificationMethod,
  createPeerDidDocumentFromServices, NewDidCommV2Service, NewDidCommV2ServiceEndpoint,
} from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { DidCommModule, DidCommBasicMessageEventTypes, DidCommMessageReceiver, DidCommV2EnvelopeService } from "@credo-ts/didcomm";
import canonicalize from "canonicalize";
import WebSocket from "ws";
import * as vti from "@openvtc/vti-didcomm-js";

const MEDIATOR_DID = process.env.MEDIATOR_DID;
const STATE_DIR = process.env.STATE_DIR;
const PHASE = process.env.PHASE ?? "main";
const EXPECT = process.env.EXPECT ?? "refused";
if (!MEDIATOR_DID || !STATE_DIR) throw new Error("MEDIATOR_DID and STATE_DIR are required");
mkdirSync(STATE_DIR, { recursive: true });

const ENVELOPE = "https://trusttasks.org/binding/didcomm/0.1/envelope";
const T = (p) => `https://trusttasks.org/spec/messaging/${p}/0.1`;
const PUSH_WAKE = "https://trusttasks.org/spec/push/wake/0.2";
const FORWARD = "https://didcomm.org/routing/2.0/forward";
const nowSec = () => Math.floor(Date.now() / 1000);
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout (${ms} ms) waiting for ${what}`)), ms))]);
let passed = 0, failed = 0;
async function row(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e?.message ?? e).split("\n")[0].slice(0, 400)}`); }
}
const ok = (v, m) => { if (!v) throw new Error(m ?? "assertion failed"); };
const short = (d) => `${String(d).slice(0, 18)}…${String(d).slice(-6)}`;
const note = (s) => console.log(`      ${s}`);

class MailboxOutbound {
  supportedSchemes = ["did"];
  constructor(w) { this.w = w; this.sent = []; }
  async start() {}
  async stop() {}
  async sendMessage(pkg) {
    const w = this.w;
    let next = pkg.endpoint ?? "";
    if (pkg.connectionId) {
      const conn = await w.agent.didcomm.connections.getById(pkg.connectionId);
      const doc = await w.agent.dids.resolveDidDocument(conn.theirDid);
      const svc = (doc.service ?? [])[0];
      const uri = typeof svc?.serviceEndpoint === "string" ? svc.serviceEndpoint : svc?.serviceEndpoint?.uri ?? svc?.serviceEndpoint?.[0]?.uri;
      if (uri?.startsWith("did:")) next = uri;
    }
    ok(w.socket?.readyState === WebSocket.OPEN, `${w.name} has no open socket`);
    // The inner JWE goes as base64 of its exact bytes: the mediator stores those bytes and ids the message by their
    // sha256 (routing.rs: a `data.json` attachment is re-serialised by the mediator, so its id is not the sender's).
    const inner = typeof pkg.payload === "string" ? pkg.payload : JSON.stringify(pkg.payload);
    const forward = {
      id: `urn:uuid:${randomUUID()}`, typ: "application/didcomm-plain+json", type: FORWARD,
      from: w.mailbox.did, to: [w.mediator.did], created_time: nowSec(), expires_time: nowSec() + 300,
      body: { next }, attachments: [{ id: randomUUID(), data: { base64: Buffer.from(inner, "utf8").toString("base64url") } }],
    };
    this.sent.push({ next, forwardId: forward.id, innerHash: sha256Hex(inner), kid: pkg.payload?.recipients?.[0]?.header?.kid });
    w.socket.send(JSON.stringify(await pack(w, forward)));
  }
}

async function makeWallet(name, { persist = false } = {}) {
  const w = { name, inbox: [], waiters: [], medFrames: [], medWaiters: [], received: [] };
  w.outbound = new MailboxOutbound(w);
  const database = persist
    ? { type: "sqlite", config: { path: `${STATE_DIR}/${name}.sqlite` } }
    : { type: "sqlite", config: { inMemory: true } };
  w.agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: persist ? `afs2-${name}` : `afs2-${name}-${Date.now()}`, key: `afs2-${name}`, database } }),
      didcomm: new DidCommModule({
        didcommVersions: ["v1", "v2"],
        peerDidNumAlgoForV2OOB: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc,
        transports: { outbound: [w.outbound] },
        connections: { autoAcceptConnections: true, autoCreateConnectionOnFirstMessage: true },
      }),
    },
  });
  await w.agent.initialize();
  w.receiver = w.agent.dependencyManager.resolve(DidCommMessageReceiver);
  w.agent.events.on(DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged, (ev) => {
    const rec = ev.payload.basicMessageRecord;
    if (rec.role !== "receiver") return;
    const item = { content: rec.content, connectionId: rec.connectionId };
    const waiter = w.waiters.shift();
    waiter ? waiter(item) : w.inbox.push(item);
  });
  return w;
}
const nextMessage = (w, ms = 15000) =>
  withTimeout(w.inbox.length ? Promise.resolve(w.inbox.shift()) : new Promise((r) => w.waiters.push(r)), ms, `a message at ${w.name}`);
async function waitFor(w, content, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const got = await nextMessage(w, ms - (Date.now() - t0));
    if (got.content === content) return got;
  }
  throw new Error(`"${content}" never reached ${w.name}`);
}
/** A mediator frame (not a delivery) matching `pred`, within `ms`; undefined if none. */
async function medFrame(w, pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const i = w.medFrames.findIndex(pred);
    if (i >= 0) return w.medFrames.splice(i, 1)[0];
    await sleep(100);
  }
  return undefined;
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
async function pack(w, plaintext, { anon = false } = {}) {
  const env = w.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
  const recipientKey = Kms.PublicJwk.fromPublicKey({ kty: "OKP", crv: "X25519", publicKey: w.mediator.x25519Pub });
  recipientKey.keyId = w.mediator.kid;
  return anon
    ? env.pack(w.agent.context, plaintext, { recipientKey })
    : env.pack(w.agent.context, plaintext, { recipientKey, senderKey: w.mailbox.senderKey, senderKeySkid: w.mailbox.kid });
}

// --- Trust Tasks: eddsa-jcs-2022, proofPurpose authentication (bifold trust-tasks documentProof.ts, same hashing).
const wireTime = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
async function signTask(w, type, payload) {
  const doc = { id: `urn:uuid:${randomUUID()}`, type, issuer: w.mailbox.did, recipient: w.mediator.did, issuedAt: wireTime(), payload };
  const proofConfig = { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created: wireTime(), verificationMethod: w.mailbox.authVmId, proofPurpose: "authentication" };
  const h = (v) => createHash("sha256").update(canonicalize(v)).digest();
  const input = Buffer.concat([h(proofConfig), h(doc)]);
  const { signature } = await w.agent.kms.sign({ keyId: w.mailbox.authKey.keyId, data: new Uint8Array(input), algorithm: "EdDSA" });
  return { ...doc, proof: { ...proofConfig, proofValue: `z${TypedArrayEncoder.toBase58(signature)}` } };
}
/** Send a Trust Task to the mediator over the socket; resolve with its answer (a mediator frame threaded to it). */
async function task(w, type, payload, ms = 8000) {
  const doc = await signTask(w, type, payload);
  const msg = { id: randomUUID(), typ: "application/didcomm-plain+json", type: ENVELOPE, from: w.mailbox.did, to: [w.mediator.did], created_time: nowSec(), expires_time: nowSec() + 300, body: doc };
  w.socket.send(JSON.stringify(await pack(w, msg)));
  const f = await medFrame(w, (p) => p.thid === msg.id || p.pthid === msg.id, ms);
  ok(f, `no answer to ${type.split("/spec/")[1]}`);
  return f;
}

async function login(w) {
  const res = await fetch(`${w.mediator.authEndpoint}/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ did: w.mailbox.did }) });
  const challenge = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`challenge HTTP ${res.status} ${JSON.stringify(challenge).slice(0, 200)}`);
  const message = {
    id: `urn:uuid:${randomUUID()}`, typ: "application/didcomm-plain+json", type: "https://affinidi.com/atm/1.0/authenticate",
    from: w.mailbox.did, to: [w.mediator.did], created_time: nowSec(), expires_time: nowSec() + 300,
    body: { challenge: challenge?.data?.challenge, session_id: challenge?.data?.session_id ?? challenge?.sessionId },
  };
  const resp = await fetch(w.mediator.authEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await pack(w, message)) });
  const auth = await resp.json().catch(() => ({}));
  if (!auth?.data?.access_token) throw new Error(`authenticate HTTP ${resp.status} ${JSON.stringify(auth).slice(0, 200)}`);
  w.jwt = auth.data.access_token;
}
async function onFrame(w, text) {
  let jwe;
  try { jwe = JSON.parse(text); } catch { return; }
  if (vti.peekSkid(text)?.startsWith(w.mediator.did)) {
    const env = w.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
    const mediatorJwk = Kms.PublicJwk.fromPublicKey({ kty: "OKP", crv: "X25519", publicKey: w.mediator.x25519Pub });
    const { plaintext } = await env.unpack(w.agent.context, jwe, { recipientKey: w.mailbox.senderKey, matchedKid: w.mailbox.kid, resolveSenderKey: async () => mediatorJwk });
    if (plaintext.type === "https://didcomm.org/messagepickup/3.0/delivery") {
      const ids = [];
      for (const a of plaintext.attachments ?? []) {
        const inner = a.data?.json ?? (a.data?.base64 ? JSON.parse(Buffer.from(a.data.base64, "base64url").toString("utf8")) : undefined);
        if (inner) await take(w, inner, a.data?.base64 ? Buffer.from(a.data.base64, "base64url").toString("utf8") : JSON.stringify(inner));
        if (a.id) ids.push(a.id);
      }
      if (ids.length) w.socket.send(JSON.stringify(await pack(w, vti.buildMessagesReceived({ from: w.mailbox.did, mediatorDid: w.mediator.did, messageIds: ids }))));
      return;
    }
    w.medFrames.push(plaintext);
    return;
  }
  await take(w, jwe, text);
  w.socket.send(JSON.stringify(await pack(w, vti.buildMessagesReceived({ from: w.mailbox.did, mediatorDid: w.mediator.did, messageIds: [sha256Hex(text)] }))));
}
async function take(w, jwe, text) {
  w.received.push({ hash: sha256Hex(text), kid: jwe?.recipients?.[0]?.header?.kid });
  let kid = jwe?.recipients?.[0]?.header?.kid ?? "";
  if (!w.contactDids.has(kid.split("#")[0])) {
    try {
      const env = w.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
      const { plaintext } = await env.unpack(w.agent.context, jwe, { recipientKey: w.mailbox.senderKey, matchedKid: kid });
      if (plaintext.type === FORWARD) {
        const a = plaintext.attachments?.[0];
        jwe = a?.data?.json ?? JSON.parse(Buffer.from(a.data.base64, "base64url").toString("utf8"));
      } else if (plaintext.type === ENVELOPE) {
        w.medFrames.push(plaintext); // a ring authcrypted by the mediator to the gateway, stored as mail
        return;
      }
    } catch (e) {
      // A frame for the stand-in gateway is authcrypted by the mediator to gw's DID: open it with the mediator's key.
      try {
        const env = w.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
        const mediatorJwk = Kms.PublicJwk.fromPublicKey({ kty: "OKP", crv: "X25519", publicKey: w.mediator.x25519Pub });
        const { plaintext } = await env.unpack(w.agent.context, jwe, { recipientKey: w.mailbox.senderKey, matchedKid: kid, resolveSenderKey: async () => mediatorJwk });
        w.medFrames.push(plaintext);
        return;
      } catch {}
      note(`(${w.name} could not open a frame: ${e.message.slice(0, 160)})`);
      return;
    }
  }
  await w.receiver.receiveMessage(jwe, {}).catch((e) => note(`(${w.name} receiver: ${e.message.slice(0, 160)})`));
}
async function openSocket(w) {
  const ws = new WebSocket(w.mediator.wsEndpoint, [`bearer.${w.jwt}`, "didcomm"]);
  await withTimeout(new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); }), 10000, "socket open");
  ws.on("message", (d) => onFrame(w, typeof d === "string" ? d : d.toString("utf8")).catch((e) => note(`(${w.name} frame: ${e.message.slice(0, 120)})`)));
  w.socket = ws;
  ws.send(JSON.stringify(await pack(w, vti.buildLiveDeliveryChange({ from: w.mailbox.did, mediatorDid: w.mediator.did }))));
}
async function goOffline(w) {
  await new Promise((r) => { w.socket.once("close", r); w.socket.close(); setTimeout(r, 2000); });
  await sleep(500);
}
async function comeBack(w) {
  await login(w);
  await openSocket(w);
  w.socket.send(JSON.stringify(await pack(w, { id: randomUUID(), type: "https://didcomm.org/messagepickup/3.0/delivery-request", from: w.mailbox.did, to: [w.mediator.did], created_time: nowSec(), body: { limit: 10 } })));
}
async function connect(inviter, invitee) {
  const inviterDid = await mintDid(inviter, inviter.mailbox.did);
  const inviteeDid = await mintDid(invitee, invitee.mailbox.did);
  inviter.contactDids.add(inviterDid);
  invitee.contactDids.add(inviteeDid);
  const oob = await inviter.agent.didcomm.oob.createInvitation({ didCommVersion: "v2", label: inviter.name, invitationDid: inviterDid, ourDid: inviterDid });
  const url = oob.outOfBandInvitation.toUrl({ domain: "https://example.test" });
  const { connectionRecord } = await invitee.agent.didcomm.oob.receiveInvitationFromUrl(url, { label: invitee.name, ourDid: inviteeDid });
  const inviteeSide = await invitee.agent.didcomm.connections.returnWhenIsConnected(connectionRecord.id, { timeoutMs: 10000 });
  const hello = `hello ${inviter.name}, from ${invitee.name}`;
  await invitee.agent.didcomm.basicMessages.sendMessage(inviteeSide.id, hello);
  const got = await waitFor(inviter, hello);
  const inviterSide = await inviter.agent.didcomm.connections.getById(got.connectionId);
  return { [invitee.name]: inviteeSide, [inviter.name]: inviterSide };
}
const problemFor = (forwardId) => (p) => String(p.type).includes("problem-report") && (p.thid === forwardId || p.pthid === forwardId);
const describeProblem = (p) => p ? `${p.body?.code ?? "?"} "${String(p.body?.comment ?? "").slice(0, 120)}"` : "no problem report";
async function setup(w, mediator, { mintMailbox = true } = {}) {
  w.mediator = mediator;
  w.contactDids = new Set();
  if (mintMailbox) w.mailbox = await identityFor(w, await mintDid(w, mediator.did));
}

const mediator = await vti.resolveMediator(MEDIATOR_DID, { allowInsecure: true });
const all = [];
console.log(`wallet-s2 PHASE=${PHASE} — ${process.env.MEDIATOR_COMMIT ?? "commit unstated"}, mediator ${short(MEDIATOR_DID)}`);
try {
  if (PHASE === "main") {
    const alice = await makeWallet("alice", { persist: true });
    const bob = await makeWallet("bob"), carol = await makeWallet("carol"), gw = await makeWallet("gw");
    all.push(alice, bob, carol, gw);
    for (const w of all) await setup(w, mediator);
    writeFileSync(`${STATE_DIR}/alice.json`, JSON.stringify({ mailbox: alice.mailbox.did }));

    await row("A0 open sign-up: four new DIDs sign in with no admin step, one socket each", async () => {
      for (const w of all) { await login(w); await openSocket(w); }
    });

    let links;
    await row("A1 CONTROL: before the flag, a mailbox send (a forward to bob's mailbox) is refused and nothing reaches bob", async () => {
      // The gate runs before the attachment is read, so a placeholder JWE measures it (A4 does the same).
      const fwd = vti.buildForward({ next: bob.mailbox.did, from: alice.mailbox.did, mediatorDid: mediator.did, innerJwe: { protected: "e30", recipients: [], iv: "", ciphertext: "", tag: "" } });
      fwd.created_time = nowSec(); fwd.expires_time = nowSec() + 300;
      alice.socket.send(JSON.stringify(await pack(alice, fwd)));
      const p = await medFrame(alice, problemFor(fwd.id), 4000);
      note(`refusal: ${describeProblem(p)}`);
      ok(!bob.received.length, `bob received ${bob.received.length} frame(s)`);
      ok(p && /send_forwarded/.test(JSON.stringify(p.body)), "no send_forwarded refusal");
    });

    await row("A2 each phone sets its own SEND_FORWARDED with a signed messaging/account/update, and the answer shows it on", async () => {
      for (const w of [alice, bob, carol]) {
        // The mediator keys accounts by sha256(DID) (its `did_hash`), and account/update's `did` is that key.
        const f = await task(w, T("account/update"), { did: sha256Hex(w.mailbox.did), acl: { sendForwarded: true } });
        const body = JSON.stringify(f.body?.payload ?? f.body);
        ok(!String(f.type).includes("problem-report"), `${w.name}: ${describeProblem(f)}`);
        ok(/"sendForwarded":true/.test(body), `${w.name}: answer type ${String(f.body?.type ?? f.type).split("/spec/")[1] ?? f.type}; ${body.slice(0, 900)}`);
      }
    });

    await row("A3 then mailbox sends work: alice↔bob and alice↔carol connect over v2 OOB and deliver both ways", async () => {
      links = { ab: await connect(alice, bob), ac: await connect(alice, carol) };
      for (const [k, x, y] of [["ab", alice, bob], ["ac", alice, carol]]) {
        for (const [from, to] of [[x, y], [y, x]]) {
          const text = `${from.name}→${to.name} ${randomUUID().slice(0, 6)}`;
          await from.agent.didcomm.basicMessages.sendMessage(links[k][from.name].id, text);
          await waitFor(to, text);
        }
      }
    });

    await row("A4 CONTROL: gw never set its flag, and its forward is still refused", async () => {
      const fwd = vti.buildForward({ next: bob.mailbox.did, from: gw.mailbox.did, mediatorDid: mediator.did, innerJwe: { protected: "e30", recipients: [], iv: "", ciphertext: "", tag: "" } });
      fwd.created_time = nowSec(); fwd.expires_time = nowSec() + 300;
      gw.socket.send(JSON.stringify(await pack(gw, fwd)));
      const p = await medFrame(gw, problemFor(fwd.id), 4000);
      note(`refusal: ${describeProblem(p)}`);
      ok(p && /send_forwarded/.test(JSON.stringify(p.body)), "no send_forwarded refusal");
    });

    await row("B external_forwarding off: a forward whose next is a DID with no account here is refused; CONTROL A3 delivered to an account", async () => {
      const stranger = await makeWallet("stranger");
      await setup(stranger, mediator, { mintMailbox: false });
      const nowhere = await mintDid(stranger, "did:web:elsewhere.example");
      const fwd = vti.buildForward({ next: nowhere, from: alice.mailbox.did, mediatorDid: mediator.did, innerJwe: { protected: "e30", recipients: [], iv: "", ciphertext: "", tag: "" } });
      fwd.created_time = nowSec(); fwd.expires_time = nowSec() + 300;
      alice.socket.send(JSON.stringify(await pack(alice, fwd)));
      const p = await medFrame(alice, problemFor(fwd.id), 4000);
      note(`refusal: ${describeProblem(p)}`);
      writeFileSync(`${STATE_DIR}/b-nowhere.txt`, nowhere);
      await stranger.agent.shutdown();
      ok(p, "no refusal for a next hop with no account");
    });

    await row("W1 wake/set: bob and gw give the mediator a handle; wakeCapable true (gw's DID names a DIDComm service with key agreement)", async () => {
      const f = await task(bob, T("wake/set"), { wakeHandle: { gateway: gw.mailbox.did, handle: "wh_bob" } });
      note(`answer: ${JSON.stringify(f.body?.payload ?? f.body).slice(0, 200)}`);
      ok(f.body?.payload?.wakeCapable === true, "wakeCapable is not true");
    });

    const ringsAt = (w) => (p) => p.body?.type === PUSH_WAKE || JSON.stringify(p.body ?? {}).includes(PUSH_WAKE);
    await row("W2 CONTROL: bob is online; alice sends and asks for a wake; no ring", async () => {
      const text = `online ${randomUUID().slice(0, 6)}`;
      await alice.agent.didcomm.basicMessages.sendMessage(links.ab.alice.id, text);
      await waitFor(bob, text);
      const sent = alice.outbound.sent.at(-1);
      const ans = await task(alice, T("wake/request"), { addressee: bob.mailbox.did, msgIds: [sent.innerHash], urgency: "interactive" });
      note(`answer: ${JSON.stringify(ans.body?.payload ?? {})}`);
      const ring = await medFrame(gw, ringsAt(gw), 6000);
      ok(!ring, `rang: ${JSON.stringify(ring?.body ?? null).slice(0, 200)}`);
    });

    await row("W3 CONTROL: carol is offline with no handle; alice sends and asks; no ring", async () => {
      await goOffline(carol);
      await alice.agent.didcomm.basicMessages.sendMessage(links.ac.alice.id, `to carol ${randomUUID().slice(0, 6)}`);
      await sleep(800);
      const sent = alice.outbound.sent.at(-1);
      await task(alice, T("wake/request"), { addressee: carol.mailbox.did, msgIds: [sent.innerHash], urgency: "interactive" });
      const ring = await medFrame(gw, ringsAt(gw), 6000);
      ok(!ring, `rang: ${JSON.stringify(ring?.body ?? null).slice(0, 200)}`);
    });

    let wakeSent;
    await row("W4 bob offline with a handle; alice sends, asks with msgIds = sha256 of the forward's inner JWE as she sent it; gw gets ONE push/wake for wh_bob", async () => {
      await goOffline(bob);
      await sleep(16000); // past the addressee coalesce window from W2
      await alice.agent.didcomm.basicMessages.sendMessage(links.ab.alice.id, "while bob is away");
      await sleep(800);
      wakeSent = alice.outbound.sent.at(-1);
      await task(alice, T("wake/request"), { addressee: bob.mailbox.did, msgIds: [wakeSent.innerHash], urgency: "interactive" });
      const ring = await medFrame(gw, ringsAt(gw), 10000);
      ok(ring, "no ring within 10 s");
      const doc = ring.body?.type === PUSH_WAKE ? ring.body : ring.body;
      note(`ring: issuer ${short(doc.issuer)} recipient ${short(doc.recipient)} payload ${JSON.stringify(doc.payload)} proofPurpose ${doc.proof?.proofPurpose}`);
      ok(doc.payload?.handle === "wh_bob", "wrong handle");
      const again = await medFrame(gw, ringsAt(gw), 4000);
      ok(!again, "a second ring");
    });

    await row("F the stored mail holds no contact-DID string (pause for the Redis search, then bob collects)", async () => {
      const contacts = all.flatMap((w) => [...w.contactDids]);
      writeFileSync(`${STATE_DIR}/f-ready.json`, JSON.stringify({ contacts, mailboxes: all.map((w) => w.mailbox.did), positive: wakeSent?.kid }, null, 1));
      for (let i = 0; i < 180 && !existsSync(`${STATE_DIR}/f-done.json`); i++) await sleep(1000);
      ok(existsSync(`${STATE_DIR}/f-done.json`), "the Redis search never ran");
      const r = JSON.parse(readFileSync(`${STATE_DIR}/f-done.json`, "utf8"));
      note(`search: ${JSON.stringify(r)}`);
      ok(r.positiveHits > 0, "positive control (the stored JWE's recipient kid) not found: the search is blind");
      ok(r.contactHits === 0, `${r.contactHits} contact-DID hit(s)`);
      await comeBack(bob);
      await waitFor(bob, "while bob is away");
      const got = bob.received.at(-1);
      note(`id check: sender's sha256(inner) ${wakeSent.innerHash.slice(0, 12)}… vs bob's sha256(frame) ${got?.hash.slice(0, 12)}…  ${got?.hash === wakeSent.innerHash ? "MATCH" : "DIFFER"}`);
    });

    await row("C per-DID limit: 60 /whoami-style authenticated requests in a burst from one DID; record 429s", async () => {
      const base = mediator.authEndpoint.replace(/\/authenticate$/, "");
      const results = await Promise.all(Array.from({ length: 60 }, () =>
        fetch(`${base}/whoami`, { headers: { authorization: `Bearer ${alice.jwt}` } }).then((r) => r.status).catch(() => -1)));
      const counts = results.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
      note(`statuses: ${JSON.stringify(counts)}  (EXPECT_LIMIT=${process.env.EXPECT_LIMIT ?? "unset"})`);
      if (process.env.EXPECT_LIMIT === "on") ok(counts[429] > 0, "no 429");
      if (process.env.EXPECT_LIMIT === "off") ok(!counts[429], "429 with the limit off");
    });
  } else if (PHASE === "after-switch") {
    const saved = JSON.parse(readFileSync(`${STATE_DIR}/alice.json`, "utf8"));
    const alice = await makeWallet("alice", { persist: true });
    const dave = await makeWallet("dave");
    all.push(alice, dave);
    await setup(alice, mediator, { mintMailbox: false });
    alice.mailbox = await identityFor(alice, saved.mailbox);
    await setup(dave, mediator);
    await row("E1 after open → enrolled across a restart: alice's existing account signs in again", async () => {
      await login(alice);
      await openSocket(alice);
    });
    await row("E2 a new DID is refused at sign-in", async () => {
      let err;
      try { await login(dave); } catch (e) { err = e; }
      note(`refusal: ${err?.message?.slice(0, 200) ?? "none"}`);
      ok(err, "dave signed in");
    });
  } else if (PHASE === "relay") {
    // Can an UNAUTHENTICATED sender (no session, a plain POST to /inbound) get an anoncrypt message into a phone's
    // mailbox queue? Real anoncrypt envelopes (Credo packAnoncrypt), so an acceptance would be a real delivery.
    const probe = await makeWallet("probe");
    all.push(probe);
    probe.mediator = mediator;
    const env = probe.agent.dependencyManager.resolve(DidCommV2EnvelopeService);
    const target = JSON.parse(readFileSync(`${STATE_DIR}/alice.json`, "utf8")).mailbox;
    const base = mediator.authEndpoint.replace(/\/authenticate$/, "");
    const post = async (jwe) => {
      const res = await fetch(`${base}/inbound`, { method: "POST", headers: { "content-type": "application/didcomm-encrypted+json" }, body: JSON.stringify(jwe) });
      return { status: res.status, text: (await res.text()).replace(/\s+/g, " ").slice(0, 220) };
    };
    const mediatorKey = () => { const k = Kms.PublicJwk.fromPublicKey({ kty: "OKP", crv: "X25519", publicKey: mediator.x25519Pub }); k.keyId = mediator.kid; return k; };
    const doc = await probe.agent.dids.resolveDidDocument(target);
    const kaRef = doc.keyAgreement[0];
    const kaVm = typeof kaRef === "string" ? doc.dereferenceKey(kaRef, ["keyAgreement"]) : kaRef;
    const mailboxKey = getPublicJwkFromVerificationMethod(kaVm);
    mailboxKey.keyId = kaVm.id;
    const inner = await env.packAnoncrypt(probe.agent.context,
      { id: randomUUID(), typ: "application/didcomm-plain+json", type: "https://didcomm.org/basicmessage/2.0/message", to: [target], created_time: nowSec(), body: { content: "unsolicited" } },
      { recipientKey: mailboxKey });
    const verdict = (r) => { note(`HTTP ${r.status} ${r.text}`); if (EXPECT === "refused") ok(r.status >= 400, "ACCEPTED"); else ok(r.status < 300, "refused"); };
    await row(`R1 UNAUTHENTICATED POST /inbound: an anoncrypt routing/2.0 forward, next = a phone's mailbox DID: expected ${EXPECT}`, async () => {
      const fwd = {
        id: `urn:uuid:${randomUUID()}`, typ: "application/didcomm-plain+json", type: FORWARD, to: [mediator.did],
        created_time: nowSec(), expires_time: nowSec() + 300, body: { next: target },
        attachments: [{ id: randomUUID(), data: { base64: Buffer.from(JSON.stringify(inner), "utf8").toString("base64url") } }],
      };
      verdict(await post(await env.packAnoncrypt(probe.agent.context, fwd, { recipientKey: mediatorKey() })));
    });
    await row(`R2 UNAUTHENTICATED POST /inbound: an anoncrypt message addressed straight to the mailbox DID: expected ${EXPECT}`, async () => {
      verdict(await post(inner));
    });
  }
} catch (e) {
  failed++;
  console.log(`  ✗ aborted: ${e.stack?.split("\n").slice(0, 5).join("\n    ")}`);
} finally {
  for (const w of all) { try { w.socket?.close(); } catch {} await withTimeout(w.agent.shutdown(), 5000, "shutdown").catch(() => {}); }
}
console.log(`\nwallet-s2 ${PHASE}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
