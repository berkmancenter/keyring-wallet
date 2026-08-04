// party.mjs — one TSP participant (Alice or Bob), a real OS process.
//
// Gets its identity and the peer's PUBLIC keys via environment variables
// (the out-of-band step — in real life a QR code or invitation; here the
// orchestrator plays phonebook). Talks to the world only through the dumb
// relay's HTTP mailbox.
//
// Role "initiator": pack greeting → send → await reply → unpack → done.
// Role "responder": await message → unpack → pack reply → send → done.

import { pack, unpack } from "@openvtc/vti-tsp-js";

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

const ROLE = env("ROLE");
const RELAY = env("RELAY_URL");
const MY_VID = env("MY_VID");
const PEER_VID = env("PEER_VID");
const me = { signPriv: unhex(env("MY_SIGN_PRIV")), encPriv: unhex(env("MY_ENC_PRIV")) };
const peer = { signPub: unhex(env("PEER_SIGN_PUB")), encPub: unhex(env("PEER_ENC_PUB")) };

const packKeys = { senderSigningKey: me.signPriv, senderEncryptionKey: me.encPriv, receiverEncryptionKey: peer.encPub };
const unpackKeys = { receiverDecryptionKey: me.encPriv, senderEncryptionKey: peer.encPub, senderSigningKey: peer.signPub };

async function send(bytes) {
  const res = await fetch(`${RELAY}/send?to=${encodeURIComponent(PEER_VID)}`, { method: "POST", body: bytes });
  if (!res.ok) throw new Error(`relay send failed: ${res.status}`);
}

async function receive(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${RELAY}/recv?vid=${encodeURIComponent(MY_VID)}`);
    if (res.status === 200) return new Uint8Array(await res.arrayBuffer());
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for a message");
}

const utf8 = (s) => new TextEncoder().encode(s);
const deutf8 = (u8) => new TextDecoder().decode(u8);

if (ROLE === "initiator") {
  const packed = await pack(utf8(`hello from ${MY_VID} (pid ${process.pid})`), MY_VID, PEER_VID, packKeys);
  await send(packed.bytes);
  console.log(`[${MY_VID}] sent ${packed.bytes.length}B via the dumb relay`);
  const reply = await unpack(await receive(), unpackKeys);
  console.log(`[${MY_VID}] got reply: "${deutf8(reply.payload)}" from ${reply.sender}`);
  if (!deutf8(reply.payload).startsWith("reply from")) throw new Error("bad reply");
} else {
  const msg = await unpack(await receive(), unpackKeys);
  console.log(`[${MY_VID}] received: "${deutf8(msg.payload)}" from ${msg.sender}`);
  const packed = await pack(utf8(`reply from ${MY_VID} (pid ${process.pid})`), MY_VID, PEER_VID, packKeys);
  await send(packed.bytes);
  console.log(`[${MY_VID}] replied ${packed.bytes.length}B`);
}
