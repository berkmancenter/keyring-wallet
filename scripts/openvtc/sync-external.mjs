#!/usr/bin/env node
// sync-external.mjs — upstream digest for the external/ OpenVTC clones.
//
// Policy: fetching is free; advancing is a decision.
//   node scripts/openvtc/sync-external.mjs                  → fetch + digest, mutates nothing
//   node scripts/openvtc/sync-external.mjs --advance <repo> --why "reason"
//                                                 → ff-pull that repo, update PINS.json,
//                                                   append SYNC_LOG.md
//
// The digest per repo: commits ahead of pin, CHANGELOG delta, watchlist paths
// touched, newest tags (Cypress detector). Plus npm tripwires for the
// @openvtc packages. Exit code 1 if any tripwire fired (usable in CI later).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const externalDir = resolve(repoRoot, "external");
const ladderDir = resolve(repoRoot, "tsp-reference");
const pinsPath = resolve(here, "PINS.json");
const logPath = resolve(here, "SYNC_LOG.md");

const pins = JSON.parse(readFileSync(pinsPath, "utf8"));

const args = process.argv.slice(2);
const advanceIdx = args.indexOf("--advance");
const advanceRepo = advanceIdx >= 0 ? args[advanceIdx + 1] : null;
const whyIdx = args.indexOf("--why");
const advanceWhy = whyIdx >= 0 ? args[whyIdx + 1] : "manual advance";

function git(repo, cmd) {
  return execSync(`git -C "${resolve(externalDir, repo)}" ${cmd}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function defaultBranch(repo) {
  try {
    return git(repo, "rev-parse --abbrev-ref origin/HEAD").replace("origin/", "");
  } catch {
    return "main";
  }
}

let tripwires = 0;

console.log(`\n=== sync-external digest · ${new Date().toISOString().slice(0, 10)} ===`);
console.log(`pins last updated: ${pins.updated}\n`);

for (const [repo, pin] of Object.entries(pins.repos)) {
  let head;
  try {
    git(repo, "fetch -q --tags origin");
    head = git(repo, `rev-parse --short origin/${defaultBranch(repo)}`);
  } catch (e) {
    console.log(`-- ${repo}: FETCH FAILED (${e.message.split("\n")[0]})`);
    continue;
  }

  const range = `${pin.sha}..origin/${defaultBranch(repo)}`;
  let ahead = "?";
  try {
    ahead = git(repo, `rev-list --count ${range}`);
  } catch {
    console.log(`-- ${repo}: pin ${pin.sha} not found (history rewritten?) — TRIPWIRE`);
    tripwires++;
    continue;
  }

  const marker = ahead === "0" ? "·" : "▲";
  console.log(`${marker} ${repo}  pin ${pin.sha} (${pin.pinnedOn}) → origin ${head}  [+${ahead}]`);

  if (ahead !== "0") {
    const subjects = git(repo, `log --oneline ${range}`).split("\n").slice(0, 6);
    for (const s of subjects) console.log(`     ${s}`);
    if (Number(ahead) > 6) console.log(`     … ${Number(ahead) - 6} more`);

    const watchHits = git(
      repo,
      `diff --name-only ${range} -- ${pin.watch.map((w) => `"${w}"`).join(" ")}`,
    );
    if (watchHits) {
      const files = watchHits.split("\n");
      console.log(`     WATCHLIST touched (${files.length}): ${files.slice(0, 5).join(", ")}${files.length > 5 ? " …" : ""}`);
      if (files.some((f) => f.endsWith("CHANGELOG.md")))
        console.log(`     → read: git -C external/${repo} diff ${pin.sha}..origin/${defaultBranch(repo)} -- CHANGELOG.md`);
    }
    const breaking = git(repo, `log --oneline ${range}`).split("\n").filter((l) => /!:|BREAKING/.test(l));
    if (breaking.length) console.log(`     BREAKING commits: ${breaking.length}`);
  }

  const tags = git(repo, `for-each-ref refs/tags --sort=-creatordate --format="%(refname:short)" --count=3`);
  if (tags) console.log(`     newest tags: ${tags.split("\n").join(", ")}`);
  const cypressFinal = git(repo, `tag -l`).split("\n").filter((t) => /cypress/i.test(t) && !/RC/i.test(t));
  if (cypressFinal.length) {
    console.log(`     ⚑ CYPRESS FINAL TAG PRESENT: ${cypressFinal.join(", ")} — TRIPWIRE`);
    tripwires++;
  }
}

console.log("\n-- npm tripwires --");
for (const [pkg, info] of Object.entries(pins.npm)) {
  let current = "?";
  try {
    current = execSync(`npm view ${pkg} version`, { encoding: "utf8" }).trim();
  } catch {
    console.log(`   ${pkg}: npm view failed`);
    continue;
  }
  if (current !== info.expected) {
    const majorMinorChanged =
      current.split(".").slice(0, 2).join(".") !== info.expected.split(".").slice(0, 2).join(".");
    const isTrustTasksPatch = pkg.endsWith("trust-tasks") && !majorMinorChanged;
    const fired = !isTrustTasksPatch;
    console.log(`   ${fired ? "⚑" : "·"} ${pkg}: ${info.expected} → ${current}${fired ? `  TRIPWIRE (${info.tripwire})` : "  (patch churn, expected)"}`);
    if (fired) tripwires++;
  } else {
    console.log(`   · ${pkg}: ${current} (unchanged)`);
  }
}

if (advanceRepo) {
  if (!pins.repos[advanceRepo]) {
    console.error(`\n--advance: unknown repo "${advanceRepo}". Known: ${Object.keys(pins.repos).join(", ")}`);
    process.exit(2);
  }
  const branch = defaultBranch(advanceRepo);
  const before = pins.repos[advanceRepo].sha;
  git(advanceRepo, `pull -q --ff-only origin ${branch}`);
  const after = git(advanceRepo, "rev-parse --short HEAD");
  const date = git(advanceRepo, "log -1 --format=%cd --date=short");
  pins.repos[advanceRepo] = { ...pins.repos[advanceRepo], sha: after, commitDate: date, pinnedOn: new Date().toISOString().slice(0, 10), why: advanceWhy };
  pins.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
  appendFileSync(logPath, `\n- **${pins.updated}** · \`${advanceRepo}\` ${before} → ${after} — ${advanceWhy}. **Re-run the reference ladder bottom-up.**`);
  console.log(`\nADVANCED ${advanceRepo}: ${before} → ${after}. PINS.json + SYNC_LOG.md updated.`);
  console.log(`Now re-run the ladder: for d in ${ladderDir}/ref-*; do (cd "$d" && npm run -s check); done`);
}

console.log(`\n=== digest done · ${tripwires} tripwire(s) ===`);
process.exit(tripwires > 0 ? 1 : 0);
