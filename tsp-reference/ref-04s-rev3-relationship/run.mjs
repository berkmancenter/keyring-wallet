#!/usr/bin/env node
// ref-04s-rev3-relationship — form a Rev 3 relationship with a lab VTA and end
// it, against upstream's own state machine.
//
// Rev 3 gates application messages on a relationship (§7.2.2): a peer that
// enforces it drops traffic from anyone who has not introduced themselves, and
// drops it silently. Keyring sends the introduction (`XRFI`) on every session
// and the two-device ceremony proves the VTA and the VTC accept it. What the
// ceremony cannot show is the rest of the cycle, because no service in the
// ecosystem legs ever invites us and nothing in the app ends a relationship
// yet:
//
//   • the VTA ANSWERS an invite with an accept (`XRFA`) that names our invite's
//     digest — read here and verified, not just acknowledged;
//   • a cancel (`XRFD`) naming that relationship is taken by the VTA's state
//     machine — read from the VTA's own log, since a cancel answers nothing.
//
// The frames are `vti-tsp-js` 0.3.0's; Keyring's `packInviteRev3`,
// `packAcceptRev3` and `packCancelRev3` are byte-identical to them (asserted
// in bifold `packages/trust-tasks`), so what upstream accepts here it accepts
// from the phone.
//
// NETWORK: the lab stack (~/vti-stack/stack.env) — its mediator and the
// `alice` VTA, whose log is read at ~/vti-stack/logs/alice.log.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { authenticateToMediator, MediatorSession, multibase } from "@openvtc/vti-didcomm-js";
import { packInvite, packCancel, unpack } from "@openvtc/vti-tsp-js";

import { mintIdentity } from "./identity.mjs";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };
const STACK_DIR = process.env.STACK_DIR ?? path.join(homedir(), "vti-stack");
function stackEnv(name) {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(path.join(STACK_DIR, "stack.env"), "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1);
}
const MEDIATOR_DID = stackEnv("MEDIATOR_DID");
const VTA_DID = stackEnv("ALICE_VTA_DID");
const VTA_URL = stackEnv("ALICE_URL");
const VTA_LOG = path.join(STACK_DIR, "logs", "alice.log");
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64uDecode = (s) => new Uint8Array(Buffer.from(s, "base64url"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The VTA's TSP keys, from its published did:webvh log: keyAgreement and authentication. */
async function vtaKeys() {
  const lines = (await (await fetch(`${VTA_URL}/.well-known/did.jsonl`)).text()).trim().split("\n");
  const entry = JSON.parse(lines.at(-1));
  const doc = entry.state ?? entry;
  const vm = (ref) => doc.verificationMethod.find((m) => m.id === (typeof ref === "string" ? ref : ref.id));
  const enc = vm(doc.keyAgreement[0]);
  const sig = vm(doc.authentication[0]);
  return {
    encPub: multibase.decodeMultikey(enc.publicKeyMultibase).key,
    signPub: multibase.decodeMultikey(sig.publicKeyMultibase).key,
  };
}

/** Lines the VTA logged since `since`, colour codes removed. */
function vtaLogSince(since) {
  const text = readFileSync(VTA_LOG, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  return text.split("\n").filter((l) => l.slice(0, 27) >= since);
}

say("── one party on the lab mediator, one VTA ──");
say(`  VTA: ${VTA_DID}`);
const me = mintIdentity();
const vta = await vtaKeys();
const auth = await authenticateToMediator({
  mediatorDid: MEDIATOR_DID,
  clientDid: me.did,
  clientX25519Private: me.xSecret,
  clientX25519Public: me.xPublic,
});
const inbox = [];
const waiters = [];
const deliver = (bytes) => {
  const w = waiters.shift();
  if (w) w(bytes);
  else inbox.push(bytes);
};
const session = new MediatorSession({
  mediator: auth.mediator,
  mediatorJwt: auth.accessToken,
  client: { did: me.did, kid: me.kid, privateKey: me.xSecret, publicKey: me.xPublic },
  WebSocketImpl: WebSocket,
  onTspFrame: deliver,
  onError: (e) => say(`  socket note: ${e?.message ?? e}`),
});
const onFrame = session._onFrame.bind(session);
session._onFrame = async (data) => {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  if (text.startsWith("--")) return deliver(b64uDecode(text));
  return onFrame(data);
};
await session.connect();
say(`  us: ${me.did.slice(0, 40)}… (authenticated, live delivery on)`);
const nextFrame = (ms = 30000) =>
  new Promise((resolve, reject) => {
    if (inbox.length) return resolve(inbox.shift());
    const t = setTimeout(() => reject(new Error(`no TSP frame within ${ms}ms`)), ms);
    waiters.push((b) => { clearTimeout(t); resolve(b); });
  });

const keys = { senderSigningKey: me.edSecret, receiverEncryptionKey: vta.encPub };
const since = new Date().toISOString().slice(0, 27);
let passed = 0;
try {
  // ─────────────────────────── invite → accept
  say("\n── XRFI: introduce ourselves, with the path back to us ──");
  // §5.3.3: the hop list ends at our own VID — our mediator, then us.
  const invite = await packInvite(me.did, VTA_DID, keys, { route: [auth.mediator.did, me.did] });
  session.sendBinary(invite.bytes);
  say(`  → invite ${invite.bytes.length}B, digest ${hex(invite.threadDigest).slice(0, 16)}…`);

  const reply = await nextFrame();
  const opened = await unpack(reply, { receiverDecryptionKey: me.xSecret, senderSigningKey: vta.signPub });
  const c = opened.control;
  say(`  ← ${opened.messageType} from ${opened.sender.slice(0, 40)}…: ${c?.controlType ?? "(no control)"}`);
  if (opened.sender !== VTA_DID) throw new Error(`the reply came from ${opened.sender}, not the VTA`);
  if (c?.controlType !== "accept") throw new Error(`expected an accept, got ${c?.controlType ?? opened.messageType}`);
  if (!c.inReplyTo || hex(c.inReplyTo) !== hex(invite.threadDigest))
    throw new Error("the accept does not name our invite");
  say(`  ✓ XRFA names our invite's digest, and its signature verified against the VTA's authentication key`);
  passed++;

  // ─────────────────────────── cancel
  say("\n── XRFD: end the relationship we formed ──");
  const cancel = await packCancel(invite.threadDigest, me.did, VTA_DID, keys);
  session.sendBinary(cancel.bytes);
  say(`  → cancel ${cancel.bytes.length}B naming ${hex(invite.threadDigest).slice(0, 16)}…`);
  // A cancel answers nothing; the VTA's own log is the only witness.
  let seen = [];
  for (let i = 0; i < 20 && !seen.length; i++) {
    await sleep(500);
    seen = vtaLogSince(since).filter((l) => l.includes(me.did.slice(0, 40)) && /cancel|Cancel/.test(l));
  }
  const mine = vtaLogSince(since).filter((l) => l.includes(me.did.slice(0, 40)));
  for (const l of mine) say(`  alice: ${l.replace(/did:key:[A-Za-z0-9]+/g, "did:key:…").slice(0, 200)}`);
  if (!seen.length) throw new Error("the VTA logged no cancel from us");
  say(`  ✓ the VTA's state machine took the cancel`);
  passed++;
  // §7.3: a cancel of a relationship held in both directions is answered with
  // a cancel. Recorded, not required: on vti a96fe02f / tdk-rs 0.26.x the VTA
  // tries and is refused ("SendCancel in state None" — the transport forgets
  // the relationship before the caller can answer). VTI-38.
  const answer = await nextFrame(5000).catch(() => undefined);
  if (answer) {
    const a = await unpack(answer, { receiverDecryptionKey: me.xSecret, senderSigningKey: vta.signPub });
    say(`  ← §7.3 answer: ${a.control?.controlType ?? a.messageType}`);
  } else {
    say("  (no answering XRFD within 5s — §7.3 expects one; see VTI-38)");
  }
} finally {
  session.close();
}

console.log(`\nREF-04S PASS — ${passed}/2: a lab VTA answered our XRFI with an XRFA naming it, and took our XRFD`);
