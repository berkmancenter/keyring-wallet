#!/usr/bin/env node
// The source digest of a checker build: what card-verify-dist/DIST.json records
// when a binary is built, and what bifold's VTI conformance job recomputes from
// the wallet's live main before trusting that binary. It covers everything that
// decides what the binary is (Cargo.toml, Cargo.lock, every file under src/) and
// the VTI commit it was built against, so a change to any of them, or a pin bump,
// without a rebuild makes the job fail instead of judging with a stale checker.
//
//   node digest.mjs <checker dir> <vti pin sha>   → prints the digest
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function sourceDigest(dir, vtiPin) {
  const files = ["Cargo.toml", "Cargo.lock"];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(dir, p));
    }
  };
  walk(join(dir, "src"));
  const h = createHash("sha256");
  h.update(`vti ${vtiPin}\n`);
  for (const f of files) {
    const fh = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
    h.update(`${f.split("\\").join("/")} ${fh}\n`);
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
