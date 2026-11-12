#!/usr/bin/env node
// The source digest of a checker build: what card-verify-dist/DIST.json records
// when a binary is built, and what bifold's VTI conformance job recomputes from
// the wallet's live main before trusting that binary. It covers the VTI commit
// the checker was built against and EVERY file in the checker's directory except
// the few named in INERT below, so a new build input (a build.rs, a
// rust-toolchain.toml, a .cargo/config.toml) is covered by default instead of by
// someone remembering to extend a list. A change to any covered file, or a pin
// bump, without a rebuild makes the job fail instead of judging with a stale
// checker.
//
//   node digest.mjs <checker dir> <vti pin sha>   → prints the digest
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Paths (relative to the checker directory) that cannot change the binary.
// `target` is cargo's build output; the conformance job also writes the
// downloaded binary there, after computing this digest.
const INERT = new Set(["README.md", "check-keyring-card.sh", "target", ".DS_Store"]);

export function sourceDigest(dir, vtiPin) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const rel = relative(dir, p).split("\\").join("/");
      if (INERT.has(rel) || name === ".DS_Store") continue;
      if (statSync(p).isDirectory()) walk(p);
      else files.push(rel);
    }
  };
  walk(dir);
  const h = createHash("sha256");
  h.update(`vti ${vtiPin}\n`);
  for (const f of files) {
    const fh = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
    h.update(`${f} ${fh}\n`);
  }
  return h.digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, vtiPin] = process.argv.slice(2);
  if (!dir || !vtiPin) {
    console.error("usage: node digest.mjs <checker dir> <vti pin sha>");
    process.exit(2);
  }
  process.stdout.write(sourceDigest(dir, vtiPin) + "\n");
}
