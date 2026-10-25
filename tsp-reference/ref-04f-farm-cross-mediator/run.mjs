#!/usr/bin/env node
// ref-04f-farm-cross-mediator — a fresh client on the VTA Farm's mediator asks
// a community that lives on ANOTHER mediator for its join manifest, and
// measures the round trip.
//
// On the lab everything shares one mediator, so a reply never has to cross
// operators. On the Farm it does: the Farm's mediator (mediator.ic3.dev) holds
// our inbox, while the ecosystem's first community (`first-vtc`) names the
// storm mediator (mediator.vtc.storm.ws) in its DIDCommMessaging and
// TSPTransport services. This rung asks the one question a tester's phone would
// ask first — the read-only `vtc/join-requests/manifest/0.2` — and records:
//
//   • does the request arrive (does first-vtc answer at all);
//   • does the answer come back storm → Farm;
//   • how long it takes;
//   • is it delivered live on the open socket, or only on a later pickup.
//
// DIDComm, two ways out:
//   A  a forward to the Farm mediator, `next` = first-vtc — the Farm has to
//      relay to storm;
//   B  an anoncrypt forward straight to storm's inbound endpoint — the
//      standard sender-side route.
// Each with two sender DIDs: a bare did:key (no service: first-vtc has
// nowhere to answer but the socket we came in on) and a did:peer:2 from the
// same key whose DIDCommMessaging service names the Farm mediator.
//
// TSP Rev 3: an XRFI whose route is [Farm mediator, us] (§5.3.3), then the
// manifest as a Trust Task binding envelope once a relationship stands, then
// an XRFD so nothing is left behind.
//
// Read-only: no join is submitted, nothing is administered. The identity is
// minted fresh for every run and discarded.
//
// NETWORK: the public Farm and storm mediators and first-vtc's DID hosts.

import { ed25519 } from "@noble/curves/ed25519.js";
import { WebSocket } from "ws";
import {
  authenticateToMediator,
  MediatorSession,
  buildForward,
  pack as packDidcomm,
  packAnoncrypt,
  multibase,
  jwk,
  didPeer,
  resolveX25519KeyAgreement,
} from "@openvtc/vti-didcomm-js";
import { pack as packTsp, packInvite, packCancel, packRouted, unpack as unpackTsp } from "@openvtc/vti-tsp-js";

import { mintIdentity } from "./identity.mjs";

const FARM_MEDIATOR = process.env.FARM_MEDIATOR_DID ?? "did:webvh:QmagBwJ5NMNVqSBAEcFs3WmTRu4kWNPXBM6a9Sav1VGEAV:dids.ic3.dev:firstperson-mediator";
const COMMUNITY = process.env.COMMUNITY_DID ?? "did:webvh:QmXi1PZD4NEvcvjfErAzVoCGtBFEv7dhXZQJHvcFY4U83F:webvh.storm.ws:first-vtc";
const TASK_MANIFEST = "https://trusttasks.org/spec/vtc/join-requests/manifest/0.2";
const TSP_ENVELOPE = "https://trusttasks.org/binding/tsp/0.1/envelope";
const WAIT_MS = Number(process.env.WAIT_MS ?? 30000);
const ONLY = process.env.ONLY; // "didcomm" | "tsp" — one family per run

const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const say = (...a) => console.log(at().padStart(7), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64u = (s) => Buffer.from(s).toString("base64url");
const b64uDecode = (s) => new Uint8Array(Buffer.from(s, "base64url"));
const results = [];
const record = (leg, outcome, detail = {}) => {
  results.push({ leg, outcome, ...detail });
  say(`  ⇒ ${leg}: ${outcome}${detail.ms != null ? ` in ${detail.ms} ms` : ""}${detail.delivery ? ` (${detail.delivery})` : ""}${detail.note ? ` — ${detail.note}` : ""}`);
};

/** The last state of a did:webvh log, fetched from its host. */
async function webvhState(did) {
  const parts = did.split(":");
  const host = decodeURIComponent(parts[3]);
  const pathParts = parts.slice(4);
  const url = pathParts.length ? `https://${host}/${pathParts.join("/")}/did.jsonl` : `https://${host}/.well-known/did.jsonl`;
  const text = await (await fetch(url)).text();
  const entry = JSON.parse(text.trim().split("\n").at(-1));
  return { url, versionId: entry.versionId, versionTime: entry.versionTime, doc: entry.state };
}
const vmKey = (doc, ref) => {
  const vm = doc.verificationMethod.find((m) => m.id === (typeof ref === "string" ? ref : ref.id));
  return { id: vm.id, key: multibase.decodeMultikey(vm.publicKeyMultibase).key };
};
const httpEndpoints = (doc) =>
  doc.service
    .filter((s) => [].concat(s.type).includes("DIDCommMessaging"))
    .flatMap((s) => [].concat(s.serviceEndpoint))
    .map((e) => (typeof e === "string" ? e : e.uri))
    .filter((u) => /^https:/.test(u));

/** A did:peer:2 from our keys, with a DIDCommMessaging service naming the Farm mediator. */
function peerDidOf(me) {
  const V = multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, me.edPublic);
  const E = multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, me.xPublic);
  const S = b64u(JSON.stringify({ t: "dm", s: { uri: FARM_MEDIATOR, a: ["didcomm/v2"] } }));
  const did = `did:peer:2.V${V}.E${E}.S${S}`;
  const doc = didPeer.resolve(did).didDocument;
  const kid = doc.keyAgreement[0].id ?? doc.keyAgreement[0];
  return { did, kid };
}

// ─────────────────────────────────────────── the parties, from public sources
say("── the parties, from their public DID logs ──");
const farm = await webvhState(FARM_MEDIATOR);
const community = await webvhState(COMMUNITY);
const stormDid = community.doc.service.find((s) => [].concat(s.type).includes("DIDCommMessaging")).serviceEndpoint;
const storm = await webvhState(stormDid);
say(`  Farm mediator  ${farm.versionId.slice(0, 12)}… ${farm.versionTime}  ${httpEndpoints(farm.doc).join(" ")}`);
say(`  first-vtc      ${community.versionId.slice(0, 12)}… ${community.versionTime}  services ${community.doc.service.map((s) => [].concat(s.type).join("|")).join(", ")}`);
say(`  storm mediator ${storm.versionId.slice(0, 12)}… ${storm.versionTime}  ${httpEndpoints(storm.doc).join(" ")}`);
const communityEnc = vmKey(community.doc, community.doc.keyAgreement[0]);
const communitySig = vmKey(community.doc, community.doc.authentication[0]);
const stormEnc = vmKey(storm.doc, storm.doc.keyAgreement[0]);
const farmEnc = vmKey(farm.doc, farm.doc.keyAgreement[0]);

const me = mintIdentity();
const peer = peerDidOf(me);
say(`  us (fresh)     ${me.did.slice(0, 32)}… and ${peer.did.slice(0, 32)}… (same key)`);

// ─────────────────────────────────────────── one socket per sender DID
async function openInbox(did, kid) {
  const authStart = Date.now();
  const auth = await authenticateToMediator({
    mediatorDid: FARM_MEDIATOR,
    clientDid: did,
    clientX25519Private: me.xSecret,
    clientX25519Public: me.xPublic,
    clientKid: kid,
  });
  const inbox = { didcomm: [], tsp: [], waiters: [] };
  const push = (kind, item) => {
    const entry = { kind, item, atMs: Date.now() };
    const i = inbox.waiters.findIndex((w) => w.kind === kind);
    if (i >= 0) inbox.waiters.splice(i, 1)[0].resolve(entry);
    else inbox[kind].push(entry);
  };
  const session = new MediatorSession({
    mediator: auth.mediator,
    mediatorJwt: auth.accessToken,
    client: { did, kid, privateKey: me.xSecret, publicKey: me.xPublic },
    senderKeys: new Map([[COMMUNITY, { publicJwk: jwk.publicJwk("X25519", communityEnc.key) }]]),
    resolveSender: async (d) => ({ publicJwk: jwk.publicJwk("X25519", (await resolveX25519KeyAgreement(d)).x25519Pub) }),
    WebSocketImpl: WebSocket,
    // Pickup bookkeeping (status, delivery) is the mediator talking, not the peer.
    onMessage: (m) => {
      if (String(m?.type).startsWith("https://didcomm.org/messagepickup/")) return;
      if (String(m?.type).includes("problem-report") && m?.from === FARM_MEDIATOR) return say(`  mediator problem-report: ${m.body?.code} — ${m.body?.comment}`);
      push("didcomm", m);
    },
    onTspFrame: (b) => push("tsp", b),
    onError: (e) => say(`  socket note: ${e?.message ?? e}`),
  });
  const onFrame = session._onFrame.bind(session);
  session._onFrame = async (data) => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (text.startsWith("--")) return push("tsp", b64uDecode(text));
    return onFrame(data);
  };
  await session.connect();
  const next = (kind, ms = WAIT_MS) =>
    new Promise((resolve) => {
      if (inbox[kind].length) return resolve(inbox[kind].shift());
      const w = { kind, resolve };
      inbox.waiters.push(w);
      setTimeout(() => {
        const i = inbox.waiters.indexOf(w);
        if (i >= 0) inbox.waiters.splice(i, 1);
        resolve(undefined);
      }, ms);
    });
  say(`  authenticated to the Farm mediator as ${did.slice(0, 24)}… in ${Date.now() - authStart} ms, live delivery on`);
  return { auth, session, next, inbox };
}

const manifestDoc = (issuer) => ({
  id: `urn:uuid:${crypto.randomUUID()}`,
  type: TASK_MANIFEST,
  payload: {},
  issuer,
  recipient: COMMUNITY,
  issuedAt: new Date().toISOString(),
});
const summarize = (m) => {
  const body = m?.body ?? m;
  const p = body?.payload ?? body;
  if (p?.criteria) return `manifest: ${p.criteria.length} criteria${p.requirementsDigest ? `, digest ${String(p.requirementsDigest).slice(0, 16)}…` : ""}`;
  return JSON.stringify(body).slice(0, 220);
};

/** One DIDComm manifest request; `route` A (via Farm) or B (direct to storm). */
async function didcommLeg(inbox, did, kid, route) {
  const name = { A: "A via Farm, next = first-vtc", B: "B direct to storm", C: "C via Farm, next = storm (double forward)" }[route];
  const leg = `DIDComm ${name}, sender ${did.startsWith("did:key") ? "did:key" : "did:peer:2"}`;
  say(`\n── ${leg} ──`);
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const sender = { kid, privateJwk: jwk.privateJwk("X25519", me.xSecret, me.xPublic) };
  const inner = {
    id,
    typ: "application/didcomm-plain+json",
    type: TASK_MANIFEST,
    from: did,
    to: [COMMUNITY],
    created_time: Math.floor(Date.now() / 1000),
    body: manifestDoc(did),
  };
  const innerJwe = await packDidcomm({ message: inner, sender, recipient: { kid: communityEnc.id, publicJwk: jwk.publicJwk("X25519", communityEnc.key) } });
  const sent = Date.now();
  if (route === "A") {
    const fwd = buildForward({ next: COMMUNITY, from: did, mediatorDid: FARM_MEDIATOR, innerJwe });
    const fwdJwe = await packDidcomm({
      message: fwd,
      sender,
      recipient: { kid: inbox.session.mediator.kid, publicJwk: jwk.publicJwk("X25519", inbox.session.mediator.x25519Pub) },
    });
    inbox.session.send(fwdJwe);
    say(`  → forward to the Farm mediator, next = first-vtc (${fwdJwe.length} B)`);
  } else if (route === "C") {
    // Upstream's own cross-mediator example (affinidi-messaging-helpers
    // examples/cross_mediator_forwarding.rs): the sender wraps for the far
    // mediator first, then hands that to its own mediator addressed to it.
    const toStorm = buildForward({ next: COMMUNITY, from: did, mediatorDid: stormDid, innerJwe });
    const toStormJwe = await packDidcomm({ message: toStorm, sender, recipient: { kid: stormEnc.id, publicJwk: jwk.publicJwk("X25519", stormEnc.key) } });
    const toFarm = buildForward({ next: stormDid, from: did, mediatorDid: FARM_MEDIATOR, innerJwe: toStormJwe });
    const toFarmJwe = await packDidcomm({
      message: toFarm,
      sender,
      recipient: { kid: inbox.session.mediator.kid, publicJwk: jwk.publicJwk("X25519", inbox.session.mediator.x25519Pub) },
    });
    inbox.session.send(toFarmJwe);
    say(`  → forward to the Farm, next = storm, wrapping a forward to storm, next = first-vtc (${toFarmJwe.length} B)`);
  } else {
    // Upstream's mediator refuses an anonymous inbound message
    // (`w.m.message.anonymous`), so the forward is authcrypted from us.
    const fwd = buildForward({ next: COMMUNITY, from: did, mediatorDid: stormDid, innerJwe });
    const fwdJwe = await packDidcomm({ message: fwd, sender, recipient: { kid: stormEnc.id, publicJwk: jwk.publicJwk("X25519", stormEnc.key) } });
    let accepted;
    // The DID document's URI, then upstream's own inbound route under it.
    for (const url of httpEndpoints(storm.doc).flatMap((u) => [u, `${u.replace(/\/$/, "")}/inbound`])) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/didcomm-encrypted+json" }, body: fwdJwe }).catch((e) => ({ status: 0, text: async () => e.message }));
      const text = (await res.text()).slice(0, 160);
      say(`  → POST ${url} → ${res.status} ${text.replace(/\s+/g, " ")}`);
      if (res.status >= 200 && res.status < 300) { accepted = url; break; }
    }
    if (!accepted) return record(leg, "storm's inbound refused the forward");
  }
  // Wait for OUR thread. Anything else (a late answer to an earlier leg) is
  // counted, not mistaken for this leg's reply.
  let reply;
  let strays = 0;
  const deadline = sent + WAIT_MS;
  while (Date.now() < deadline) {
    const got = await inbox.next("didcomm", Math.max(1, deadline - Date.now()));
    if (!got) break;
    if (got.item?.thid === id) { reply = got; break; }
    strays++;
    say(`  (a message for another thread: ${got.item?.type} thid ${String(got.item?.thid).slice(0, 20)}…)`);
  }
  if (reply) {
    const m = reply.item;
    return record(leg, "answered", { ms: reply.atMs - sent, delivery: "live, on the open socket", note: `${m?.type ?? "?"} from ${String(m?.from).slice(0, 28)}… ${summarize(m)}${strays ? ` (${strays} stray)` : ""}` });
  }
  // Not live — is it queued? A fresh socket's live-delivery switch flushes the queue.
  // The mediator allows one socket per DID: a second one terminates the first
  // (`w.websocket.duplicate-channel`), so close before reconnecting.
  say(`  … nothing live within ${WAIT_MS / 1000}s; closing and reconnecting to pick up anything queued`);
  inbox.session.close();
  await sleep(1000);
  const again = await openInbox(did, kid);
  const queued = await again.next("didcomm", 10000);
  again.session.close();
  if (queued) return record(leg, queued.item?.thid === id ? "answered, poll-only" : "queued message, not our thread", { ms: queued.atMs - sent, delivery: "only on pickup", note: summarize(queued.item) });
  return record(leg, "no answer", { note: `nothing live in ${WAIT_MS / 1000}s, nothing queued on reconnect` });
}

/** TSP Rev 3: XRFI routed back through the Farm, then the manifest, then XRFD. */
async function tspLeg(inbox, did) {
  const leg = `TSP Rev 3, sender ${did.startsWith("did:key") ? "did:key" : "did:peer:2"}`;
  say(`\n── ${leg} ──`);
  const keys = { senderSigningKey: me.edSecret, receiverEncryptionKey: communityEnc.key };
  const unpackKeys = { receiverDecryptionKey: me.xSecret, senderSigningKey: communitySig.key };
  const invite = await packInvite(did, COMMUNITY, keys, { route: [FARM_MEDIATOR, did] });
  const routedTo = async (inner, label) => {
    // Hand the Farm a routed frame whose next hop is storm, then first-vtc.
    const routed = await packRouted(inner, [stormDid, COMMUNITY], did, FARM_MEDIATOR, { senderSigningKey: me.edSecret, receiverEncryptionKey: farmEnc.key });
    return { label, bytes: routed.bytes };
  };
  const attempts = [
    { label: "direct frame to the Farm", bytes: invite.bytes },
    await routedTo(invite.bytes, "routed via Farm → storm"),
    // The TSP twin of DIDComm route B: hand the frame to first-vtc's own
    // mediator, which stores a frame for a local recipient as it is.
    { label: "direct frame POSTed to storm", bytes: invite.bytes, post: true },
  ].filter((a) => !process.env.TSP_ATTEMPTS || process.env.TSP_ATTEMPTS.split(",").includes(String(["direct frame to the Farm", "routed via Farm → storm", "direct frame POSTed to storm"].indexOf(a.label))));
  let accept;
  for (const a of attempts) {
    const sent = Date.now();
    if (a.post) {
      const url = `${httpEndpoints(storm.doc)[0].replace(/\/$/, "")}/inbound`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: a.bytes }).catch((e) => ({ status: 0, text: async () => e.message }));
      say(`  → XRFI (${a.label}, ${a.bytes.length} B) → ${res.status} ${(await res.text()).slice(0, 200).replace(/\s+/g, " ")}`);
    } else {
      inbox.session.sendBinary(a.bytes);
      say(`  → XRFI (${a.label}, ${a.bytes.length} B), digest ${hex(invite.threadDigest).slice(0, 16)}…`);
    }
    const frame = await inbox.next("tsp");
    if (!frame) { record(`${leg} XRFI ${a.label}`, "no answer", { note: `nothing within ${WAIT_MS / 1000}s` }); continue; }
    const opened = await unpackTsp(frame.item, unpackKeys).catch((e) => ({ error: e.message }));
    if (opened.error) { record(`${leg} XRFI ${a.label}`, "a frame arrived that did not open", { ms: frame.atMs - sent, note: opened.error }); continue; }
    const c = opened.control;
    const named = c?.inReplyTo && hex(c.inReplyTo) === hex(invite.threadDigest);
    record(`${leg} XRFI ${a.label}`, c?.controlType === "accept" && named ? "XRFA naming our invite" : `answered ${c?.controlType ?? opened.messageType}`, { ms: frame.atMs - sent, delivery: "live, on the open socket" });
    if (c?.controlType === "accept" && named) { accept = a; break; }
  }
  if (!accept) return;
  const doc = manifestDoc(did);
  const body = new TextEncoder().encode(JSON.stringify({ type: TSP_ENVELOPE, document: doc }));
  const msg = await packTsp(body, did, COMMUNITY, keys);
  const wire = accept.label.startsWith("routed") ? (await routedTo(msg.bytes, accept.label)).bytes : msg.bytes;
  const sent = Date.now();
  const sendOn = async (bytes) =>
    accept.post
      ? fetch(`${httpEndpoints(storm.doc)[0].replace(/\/$/, "")}/inbound`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes })
      : inbox.session.sendBinary(bytes);
  await sendOn(wire);
  say(`  → manifest in a Trust Task envelope (${wire.length} B)`);
  const frame = await inbox.next("tsp");
  if (!frame) record(`${leg} manifest`, "no answer", { note: `nothing within ${WAIT_MS / 1000}s` });
  else {
    const opened = await unpackTsp(frame.item, unpackKeys).catch((e) => ({ error: e.message }));
    let answer = opened.error;
    if (!answer) { try { answer = summarize(JSON.parse(new TextDecoder().decode(opened.payload)).document); } catch { answer = `${opened.messageType}`; } }
    record(`${leg} manifest`, opened.error ? "a frame that did not open" : "answered", { ms: frame.atMs - sent, delivery: "live, on the open socket", note: answer });
  }
  const cancel = await packCancel(invite.threadDigest, did, COMMUNITY, keys);
  await sendOn(accept.label.startsWith("routed") ? (await routedTo(cancel.bytes, accept.label)).bytes : cancel.bytes);
  say("  → XRFD, ending the relationship");
  await sleep(1500);
}

// ─────────────────────────────────────────── run
const SENDERS = (process.env.SENDERS ?? "key,peer").split(",");
for (const { did, kid } of [{ did: me.did, kid: me.kid, name: "key" }, { ...peer, name: "peer" }].filter((x) => SENDERS.includes(x.name))) {
  const legs = [
    ...(ONLY === "tsp" ? [] : (process.env.ROUTES ?? "A,B,C").split(",").map((r) => (inbox) => didcommLeg(inbox, did, kid, r))),
    ...(ONLY === "didcomm" ? [] : [(inbox) => tspLeg(inbox, did)]),
  ];
  // A fresh socket per leg, so one leg's reconnect cannot cost the next its channel.
  for (const leg of legs) {
    let inbox;
    try {
      inbox = await openInbox(did, kid);
    } catch (e) {
      record(`Farm mediator authentication, ${did.slice(0, 12)}`, "refused", { note: e.message.slice(0, 200) });
      continue;
    }
    try {
      await leg(inbox);
    } catch (e) {
      record(`leg with ${did.slice(0, 12)}`, "error", { note: e.message.slice(0, 240) });
    } finally {
      inbox.session.close();
      await sleep(1000);
    }
  }
}

console.log("\n── REF-04F results ──");
for (const r of results) console.log(`  ${r.leg}: ${r.outcome}${r.ms != null ? ` (${r.ms} ms)` : ""}${r.delivery ? ` [${r.delivery}]` : ""}`);
console.log(JSON.stringify({ at: new Date().toISOString(), farm: farm.versionId, community: community.versionId, storm: storm.versionId, results }, null, 1));
process.exit(0);
