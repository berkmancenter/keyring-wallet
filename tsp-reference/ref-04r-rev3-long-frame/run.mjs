#!/usr/bin/env node
// ref-04r-rev3-long-frame — a Rev 3 message past the short-form limit, through
// a real mediator.
//
// Rev 3 widened the leading `-E` count so it covers the ciphertext, and a
// count is 12 bits of quadlets: past 4,095 quadlets (12,285 bytes counted) the
// message is framed LONG — leading byte 0xFB, base64url text "--" — where
// (the count does not cover the whole frame, so the switch comes a little past
// 12,285 bytes on the wire: measured 12,327 B short, 13,167 B long)
// every Rev 2 frame and every small Rev 3 frame begins 0xF8 / "-E". An ingress
// classifier that knows only "-E" drops the large ones; upstream says so in
// `wire.ts`, and the tsp_rev3_subtask §3.3 measurement shows where the line
// falls. The threshold is inside our range: a witnessed exchange carrying both
// parties' attestation chains crosses it.
//
// What this rung proves, against the lab's mediator (affinidi mediator built
// `--features tsp`, which classifies with `affinidi_tsp::is_tsp`):
//
//   • a long-framed Rev 3 message is accepted at ingress, stored, and
//     delivered — Direct (routed on the envelope's receiver VID) and Routed
//     (sealed to the mediator, which opens its own layer and forwards);
//   • it arrives byte-identical, and the receiver unpacks and verifies it;
//   • short frames on either side of the limit still behave.
//
// The receiving side needs a classifier that knows both prefixes.
// `vti-didcomm-js` 0.7.0's session routes only "-E" to its TSP callback (fixed
// upstream in 0.10.0, `src/tsp-frame.js`), so this rung adds the "--" case in
// front of it — the same two prefixes Keyring's own `VtiMediatorSession`
// accepts. The rung is about the mediator; the client classifier is unit-tested
// in Keyring.
//
// NETWORK: talks to the lab mediator (MEDIATOR_DID from ~/vti-stack/stack.env,
// or the environment). Payloads are end-to-end encrypted.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { authenticateToMediator, MediatorSession } from "@openvtc/vti-didcomm-js";
import { pack, packRouted, unpack, isTsp, sha256, TSP_MAGIC_BYTE, TSP_MAGIC_BYTE_LONG } from "@openvtc/vti-tsp-js";

import { mintIdentity, tspKeysForDid } from "./identity.mjs";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };

function stackEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const file = path.join(process.env.STACK_DIR ?? path.join(homedir(), "vti-stack"), "stack.env");
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1);
  } catch {
    return undefined;
  }
}
const MEDIATOR_DID = stackEnv("MEDIATOR_DID");
if (!MEDIATOR_DID) throw new Error("no MEDIATOR_DID — set it, or run the lab stack (~/vti-stack/stack.env)");

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64uDecode = (s) => new Uint8Array(Buffer.from(s, "base64url"));
/** Deterministic payload of `n` bytes, so a truncation or a swap cannot pass. */
function payloadOf(n, tag) {
  const out = new Uint8Array(n);
  const seed = new TextEncoder().encode(tag);
  for (let i = 0; i < n; i++) out[i] = (seed[i % seed.length] + i * 31) & 0xff;
  return out;
}

async function attach(name, id) {
  const auth = await authenticateToMediator({
    mediatorDid: MEDIATOR_DID,
    clientDid: id.did,
    clientX25519Private: id.xSecret,
    clientX25519Public: id.xPublic,
  });
  const inbox = [];
  const waiters = [];
  const deliver = (bytes) => {
    const waiter = waiters.shift();
    if (waiter) waiter(bytes);
    else inbox.push(bytes);
  };
  const session = new MediatorSession({
    mediator: auth.mediator,
    mediatorJwt: auth.accessToken,
    client: { did: id.did, kid: id.kid, privateKey: id.xSecret, publicKey: id.xPublic },
    WebSocketImpl: WebSocket,
    onTspFrame: deliver,
    onError: (e) => say(`  [${name}] socket note: ${e?.message ?? e}`),
  });
  // The long-form prefix, in front of the package's "-E"-only demux.
  const onFrame = session._onFrame.bind(session);
  session._onFrame = async (data) => {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (text.startsWith("--")) return deliver(b64uDecode(text));
    return onFrame(data);
  };
  await session.connect();
  say(`  [${name}] authenticated, live delivery on`);
  const nextTspFrame = (timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      if (inbox.length) return resolve(inbox.shift());
      const timer = setTimeout(() => reject(new Error(`${name}: no TSP frame within ${timeoutMs}ms`)), timeoutMs);
      waiters.push((bytes) => { clearTimeout(timer); resolve(bytes); });
    });
  return { auth, session, nextTspFrame };
}

say("── two parties on the lab mediator ──");
say(`  mediator: ${MEDIATOR_DID.slice(0, 48)}…`);
const alice = mintIdentity();
const bob = mintIdentity();
const bobPub = tspKeysForDid(bob.did);
const alicePub = tspKeysForDid(alice.did);
const A = await attach("alice", alice);
const B = await attach("bob", bob);
const mediatorVid = A.auth.mediator.did;
const mediatorEncPub = A.auth.mediator.x25519Pub;

// Sizes of the PAYLOAD. The frame adds the envelope, the signature and HPKE's
// overhead, so each case asserts the leading byte it actually produced rather
// than assuming it from the payload size.
const CASES = [
  { size: 3000, expect: "short" },
  { size: 12000, expect: "either" }, // near the line: the count excludes part of the frame
  { size: 20000, expect: "long" },
  { size: 60000, expect: "long" },
];
const SHORT_LIMIT = 4095 * 3;

let passed = 0;
const results = [];
try {
  for (const mode of ["direct", "routed"]) {
    say(`\n── ${mode} ──`);
    for (const c of CASES) {
      const body = payloadOf(c.size, `${mode}-${c.size}`);
      const inner = await pack(body, alice.did, bob.did, {
        senderSigningKey: alice.edSecret,
        receiverEncryptionKey: bobPub.encPub,
      });
      const wire =
        mode === "direct"
          ? inner.bytes
          : (
              await packRouted(inner.bytes, [bob.did], alice.did, mediatorVid, {
                senderSigningKey: alice.edSecret,
                receiverEncryptionKey: mediatorEncPub,
              })
            ).bytes;
      const form = wire[0] === TSP_MAGIC_BYTE_LONG ? "long" : wire[0] === TSP_MAGIC_BYTE ? "short" : "unknown";
      if (!isTsp(wire)) throw new Error(`${mode} ${c.size}: packed bytes are not TSP`);
      // The inner frame decides what the receiver gets; for Routed the outer
      // is the mediator's, so report both.
      const innerForm = inner.bytes[0] === TSP_MAGIC_BYTE_LONG ? "long" : "short";
      A.session.sendBinary(wire);
      const got = await B.nextTspFrame();
      const same = hex(sha256(got)) === hex(sha256(inner.bytes));
      const opened = await unpack(got, { receiverDecryptionKey: bob.xSecret, senderSigningKey: alicePub.signPub });
      const intact = hex(sha256(opened.payload)) === hex(sha256(body));
      const line = `${String(c.size).padStart(6)}B payload → ${String(wire.length).padStart(6)}B on the wire (${form}${
        mode === "routed" ? `, inner ${inner.bytes.length}B ${innerForm}` : ""
      }) → delivered ${got.length}B, ${same ? "byte-identical" : "ALTERED"}, ${intact ? "unpacked and verified" : "PAYLOAD MISMATCH"}`;
      say(`  ${line}`);
      results.push({ mode, size: c.size, wire: wire.length, form, innerForm, same, intact });
      if (!same || !intact) throw new Error(`${mode} ${c.size}: ${line}`);
      if (c.expect !== "either" && innerForm !== c.expect) throw new Error(`${mode} ${c.size}: expected a ${c.expect}-form frame, got ${innerForm}`);
      passed++;
    }
  }
  for (const mode of ["direct", "routed"]) {
    if (!results.some((r) => r.mode === mode && r.innerForm === "long")) throw new Error(`${mode}: no long-form frame was exercised`);
  }
} finally {
  A.session.close();
  B.session.close();
}

const longest = Math.max(...results.map((r) => r.wire));
console.log(
  `\nREF-04R PASS — ${passed}/${CASES.length * 2} Rev 3 messages through the lab mediator, direct and routed; ` +
    `long-form frames (0xFB, past ${SHORT_LIMIT}B) delivered byte-identical, up to ${longest}B on the wire`
);
