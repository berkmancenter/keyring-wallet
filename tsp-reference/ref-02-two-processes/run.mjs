#!/usr/bin/env node
// ref-02-two-processes — the pipe is dumb, the envelope is everything.
//
// Spawns THREE real OS processes:
//   relay.mjs — an HTTP mailbox with zero TSP code (can't read anything)
//   party.mjs (bob, responder)   — awaits, unpacks, replies
//   party.mjs (alice, initiator) — packs, sends, awaits the reply
//
// The orchestrator mints identities and hands each party its own private
// keys + the peer's PUBLIC keys via env — that's the out-of-band step (QR /
// invitation in real life). After this rung, "transport" should feel
// boring: ref-01's in-process function calls became HTTP and nothing about
// the crypto changed. Run: npm install && npm start   (--quiet for CI)

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

const QUIET = process.argv.includes("--quiet");
const here = dirname(fileURLToPath(import.meta.url));
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

const mintKey = (curve) => (curve.utils.randomSecretKey ?? curve.utils.randomPrivateKey)();
function mint(name) {
  const signPriv = mintKey(ed25519);
  const encPriv = mintKey(x25519);
  return { name, signPriv, encPriv, signPub: ed25519.getPublicKey(signPriv), encPub: x25519.getPublicKey(encPriv) };
}

const alice = mint("alice");
const bob = mint("bob");
const ALICE = "did:web:alice.example";
const BOB = "did:web:bob.example";

const children = [];
const outputs = { relay: [], alice: [], bob: [] };

function launch(tag, args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: here, env: { ...process.env, ...env } });
  children.push(child);
  child.stdout.on("data", (d) => {
    for (const line of d.toString().trim().split("\n")) {
      outputs[tag].push(line);
      if (!QUIET) console.log(`  ${line}`);
    }
  });
  child.stderr.on("data", (d) => console.error(`  [${tag}:err] ${d.toString().trim()}`));
  return child;
}

const done = (child) => new Promise((res, rej) => {
  child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
});

// 1. relay up, grab its port
const relay = launch("relay", [join(here, "relay.mjs")]);
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("relay never became ready")), 5000);
  relay.stdout.on("data", (d) => {
    const m = d.toString().match(/RELAY_READY (\d+)/);
    if (m) { clearTimeout(t); res(m[1]); }
  });
});
const RELAY_URL = `http://127.0.0.1:${port}`;
if (!QUIET) console.log(`\nrelay listening on ${RELAY_URL} — knows nothing, stores blobs\n`);

// 2. the out-of-band step: each party gets its privs + the peer's pubs
const partyEnv = (self, selfVid, peer, peerVid, role) => ({
  ROLE: role, RELAY_URL, MY_VID: selfVid, PEER_VID: peerVid,
  MY_SIGN_PRIV: hex(self.signPriv), MY_ENC_PRIV: hex(self.encPriv),
  PEER_SIGN_PUB: hex(peer.signPub), PEER_ENC_PUB: hex(peer.encPub),
});

const bobProc = launch("bob", [join(here, "party.mjs")], partyEnv(bob, BOB, alice, ALICE, "responder"));
const aliceProc = launch("alice", [join(here, "party.mjs")], partyEnv(alice, ALICE, bob, BOB, "initiator"));

try {
  await Promise.all([done(aliceProc), done(bobProc)]);
} finally {
  for (const c of children) c.kill();
}

// 3. assertions over the collected transcripts
const all = [...outputs.alice, ...outputs.bob].join("\n");
if (!/got reply: "reply from did:web:bob.example/.test(all)) throw new Error("alice never got bob's reply");
if (!/received: "hello from did:web:alice.example/.test(all)) throw new Error("bob never got alice's hello");
const relayLog = outputs.relay.join("\n");
if (!/no idea, it's sealed/.test(relayLog)) throw new Error("relay transcript missing");
const pids = new Set(all.match(/pid (\d+)/g));
if (pids.size !== 2) throw new Error(`expected 2 distinct party processes, saw ${pids.size}`);

console.log(`\nREF-02 PASS — round trip across 3 OS processes; the relay moved sealed bytes it could not read`);
