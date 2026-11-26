// Does the proposal's TypeScript TSP library read a frame marked TSP 1.0?
// It packs one frame with the library, then rewrites only the version marker in the cleartext
// envelope from 0.1 (`YTSP-AAB`) to 1.0 (`YTSP-BAA`, what Keyring packs to a VTA and what the VTA's
// affinidi-tsp reads) and asks the library who sent it.
import { packTrustTask, advertisedSender } from "@openvtc/trust-tasks-tsp";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

const party = () => {
  const s = ed25519.utils.randomSecretKey();
  const xs = ed25519.utils.toMontgomerySecret(s);
  return { s, xs, xp: x25519.getPublicKey(xs) };
};
const a = party();
const b = party();
const sealed = await packTrustTask(
  { id: "urn:uuid:00000000-0000-4000-8000-000000000001", type: "https://example.org/x", payload: {} },
  { senderVid: "did:key:a", receiverVid: "did:key:b", keys: { senderSigningKey: a.s, senderEncryptionKey: a.xs, receiverEncryptionKey: b.xp } },
);
const bytes = sealed.bytes ?? sealed;
const head = Buffer.from(bytes.slice(0, 12)).toString("base64url");
console.log(`as packed:        ${head}  -> sender ${advertisedSender(bytes)}`);
const v1 = Buffer.from(bytes);
Buffer.from(head.replace("YTSP-AAB", "YTSP-BAA"), "base64url").copy(v1, 0);
let sender;
try {
  sender = advertisedSender(new Uint8Array(v1));
} catch (e) {
  sender = `refused (${e.message})`;
}
console.log(`marked TSP 1.0:   ${Buffer.from(v1.slice(0, 12)).toString("base64url")}  -> sender ${sender}`);
const ok = head.includes("YTSP-AAB") && sender === undefined;
console.log(ok ? "RESULT: the library writes TSP 0.1 and does not recognise a 1.0 frame" : "RESULT: differs from the recorded finding; read the lines above");
process.exit(ok ? 0 : 1);
