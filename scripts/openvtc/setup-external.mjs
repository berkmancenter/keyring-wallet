#!/usr/bin/env node
// setup-external.mjs — clone the OpenVTC upstream repos at their pinned SHAs.
//
//   node scripts/openvtc/setup-external.mjs            # clone/checkout to pins
//   node scripts/openvtc/setup-external.mjs --status   # report only, change nothing
//
// The clones land in `external/` at the repo root, which is gitignored — they
// are reference and build sources, never part of this repository's history.
// Everything is pinned in PINS.json so two people (and two agents) inspect
// byte-identical trees.
//
// Safe to re-run: existing clones are fetched and checked out to the pin;
// local modifications are never discarded (the script reports and skips).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const externalDir = join(repoRoot, "external");
const pins = JSON.parse(readFileSync(join(here, "PINS.json"), "utf8"));

const STATUS_ONLY = process.argv.includes("--status");
const ORG = "https://github.com/OpenVTC";

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const dirty = (dir) => git(["status", "--porcelain"], dir).length > 0;

mkdirSync(externalDir, { recursive: true });

console.log(`\nOpenVTC upstream clones → ${externalDir}`);
console.log(`pins from PINS.json (updated ${pins.updated})\n`);

let problems = 0;

for (const [name, pin] of Object.entries(pins.repos)) {
  const dir = join(externalDir, name);
  const url = pin.url ?? `${ORG}/${name}.git`;

  if (!existsSync(dir)) {
    if (STATUS_ONLY) {
      console.log(`  ✗ ${name.padEnd(34)} missing`);
      problems++;
      continue;
    }
    console.log(`  … cloning ${name}`);
    execFileSync("git", ["clone", "--quiet", url, dir], { stdio: "inherit" });
  }

  const head = git(["rev-parse", "--short", "HEAD"], dir);
  if (head === pin.sha) {
    console.log(`  ✓ ${name.padEnd(34)} ${pin.sha} (pinned)`);
    continue;
  }

  if (STATUS_ONLY) {
    console.log(`  ~ ${name.padEnd(34)} at ${head}, pin is ${pin.sha}`);
    problems++;
    continue;
  }

  if (dirty(dir)) {
    console.log(`  ! ${name.padEnd(34)} has local changes — leaving it alone (at ${head}, pin ${pin.sha})`);
    problems++;
    continue;
  }

  try {
    git(["fetch", "--quiet", "--tags", "origin"], dir);
    git(["checkout", "--quiet", pin.sha], dir);
    console.log(`  ✓ ${name.padEnd(34)} ${head} → ${pin.sha}`);
  } catch (e) {
    console.log(`  ! ${name.padEnd(34)} could not check out ${pin.sha}: ${e.message.split("\n")[0]}`);
    problems++;
  }
}

console.log(`
Notes
  • The clones are detached at the pinned commit — that is intentional.
    To see what has changed upstream since:  node scripts/openvtc/sync-external.mjs
  • Never commit anything under external/ (it is gitignored).
  • Some of these repos need their own toolchains: Node 24+ for
    vta-browser-plugin, Rust ≥ 1.95 for verifiable-trust-infrastructure.
`);

process.exit(problems > 0 ? 1 : 0);
