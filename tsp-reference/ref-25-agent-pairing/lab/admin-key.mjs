// The lab VTA's administrator: a did:key from a seed kept outside the repository. Prints the DID.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { identityFromSeed } from "../identity.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node admin-key.mjs <seed file>");
  process.exit(2);
}
if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
console.log(identityFromSeed(Uint8Array.from(Buffer.from(readFileSync(file, "utf8").trim(), "hex"))).did);
