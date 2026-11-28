// The CI job's path filter lists every file a rung's tests read, not only tsp-reference/. A rung that reads a file
// outside tsp-reference/ (ref-25 reads Keyring's HCP effect kinds and AGENT_PURPOSES) must run when that file
// changes, or the pull request that changed it never runs the rung, and the red surfaces on the next merge that does.
//
// Found here: every string literal beginning "../" in an opted-in rung's sources (a rung with a `test` script, as the
// job decides), resolved against the file that holds it, as `new URL(path, import.meta.url)` resolves it. Each one
// that lands outside tsp-reference/ must be covered by both of the workflow's lists, pull_request's and push's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const WORKFLOW = join(repo, ".github", "workflows", "tsp-reference.yml");

/** The `paths:` list under `on.<event>`, read line by line (the file's own two-space layout). */
export function pathsOf(yaml, event) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l === `  ${event}:`);
  if (start < 0) return undefined;
  const out = [];
  let inPaths = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break; // the next event, or the next top-level key
    if (/^ {4}paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^ {4}\S/.test(line) && !/^ {4}#/.test(line)) break; // the next key of this event
    const item = line.match(/^ {6}- "([^"]+)"/);
    if (inPaths && item) out.push(item[1]);
  }
  return out;
}

/** Whether `path` (repository-relative, POSIX) is matched by `glob`: an exact path, or a `dir/**` prefix. */
export function covered(path, glob) {
  if (glob.endsWith("/**")) return path === glob.slice(0, -3) || path.startsWith(glob.slice(0, -2));
  return path === glob;
}

const sources = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(mjs|cjs|js|ts)$/.test(name) ? [full] : [];
  });

/** Every opted-in rung's reads outside tsp-reference/, as repository-relative paths, with the file that reads each. */
export function outsideReads() {
  const root = join(repo, "tsp-reference");
  const rungs = readdirSync(root).filter((name) => {
    try {
      return Boolean(JSON.parse(readFileSync(join(root, name, "package.json"), "utf8")).scripts?.test);
    } catch {
      return false;
    }
  });
  const reads = [];
  for (const rung of rungs) {
    for (const file of sources(join(root, rung))) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`](\.\.\/[^"'`$]+)["'`]/g)) {
        const target = relative(repo, resolve(dirname(file), m[1])).split(sep).join("/");
        // `tsp-reference` itself (a script reaching the corpus root) is inside, not an escape.
        const inside = target === "tsp-reference" || target.startsWith("tsp-reference/");
        if (!inside && !target.startsWith("..")) {
          reads.push({ target, from: relative(repo, file).split(sep).join("/") });
        }
      }
    }
  }
  return reads;
}

test("the workflow's two path lists exist and are the same list", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const pr = pathsOf(yaml, "pull_request");
  const push = pathsOf(yaml, "push");
  assert.ok(pr?.length && push?.length, "both pull_request and push carry a paths list");
  assert.deepEqual([...push].sort(), [...pr].sort());
});

test("every file an opted-in rung reads outside tsp-reference/ is in both path lists", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const reads = outsideReads();
  // The reads this was written for, so a scan that stopped finding them cannot pass by finding nothing.
  for (const known of [
    "packages/core/src/modules/connected-agents/hcp",
    "packages/core/src/modules/connected-agents/pairing.ts",
    "docs/plans/agent-connect-plan.md",
  ]) {
    assert.ok(reads.some((r) => r.target === known), `the scan found ${known}`);
  }
  for (const event of ["pull_request", "push"]) {
    const globs = pathsOf(yaml, event);
    const missing = reads.filter((r) => !globs.some((g) => covered(r.target, g)));
    assert.deepEqual(missing, [], `${event}'s paths miss files a rung reads`);
  }
});

test("the matcher: a dir/** covers the directory and below, an exact path only itself (control)", () => {
  assert.ok(covered("packages/core/src/modules/connected-agents/hcp", "packages/core/src/modules/connected-agents/hcp/**"));
  assert.ok(covered("packages/core/src/modules/connected-agents/hcp/types.ts", "packages/core/src/modules/connected-agents/hcp/**"));
  assert.ok(!covered("packages/core/src/modules/connected-agents/hcpx/types.ts", "packages/core/src/modules/connected-agents/hcp/**"));
  assert.ok(!covered("packages/core/src/modules/connected-agents/types.ts", "packages/core/src/modules/connected-agents/pairing.ts"));
  // The old list, before this test: it misses the two Keyring files, which is what this test exists to catch.
  const old = ["tsp-reference/**", "docs/plans/**", ".github/workflows/tsp-reference.yml"];
  const missing = outsideReads().filter((r) => !old.some((g) => covered(r.target, g))).map((r) => r.target);
  assert.ok(missing.includes("packages/core/src/modules/connected-agents/pairing.ts"), String(missing));
});
