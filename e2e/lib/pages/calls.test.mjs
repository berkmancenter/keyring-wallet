// Every page-object call a driver makes must exist. A driver that names a step its page object does not have only
// fails on a device, mid-run (1011-0039: run-several-agents called agents.readOwnerCode, a reader exported beside
// `agents`, not a step on it, and row swap-held-add-returns threw "is not a function"). Read here instead: each
// driver's imports from lib/pages, and every `<object>.<name>(` on an imported page object.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const e2e = path.resolve(here, "../..");
const drivers = readdirSync(e2e).filter((f) => /^run-.*\.(mjs|js)$/.test(f));

/** `import { a, b as c } from "./lib/pages/x.js"` → [{ module: "x.js", names: [["a","a"],["b","c"]] }]. */
export function pageImports(source) {
  const found = [];
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/lib\/pages\/([\w.-]+)["']/g)) {
    const names = m[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const [orig, local] = n.split(/\s+as\s+/);
        return [orig.trim(), (local ?? orig).trim()];
      });
    found.push({ module: m[2], names });
  }
  return found;
}

/** Every `local.member(` in the source, outside line comments. */
export function memberCalls(source, local) {
  const code = source.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/[^\n"'`]*$/gm, "");
  const re = new RegExp(`(?<![\\w.$])${local.replace(/\$/g, "\\$")}\\.(\\w+)\\s*\\(`, "g");
  return [...new Set([...code.matchAll(re)].map((m) => m[1]))];
}

test("the reader finds page imports and their member calls", () => {
  const src = 'import { agents, readOwnerCode as roc } from "./lib/pages/agents.js";\n// agents.notThis(d)\nawait agents.add(d);\nawait agents.readOwnerCode(d);\nx.agents.other(d);';
  assert.deepEqual(pageImports(src), [{ module: "agents.js", names: [["agents", "agents"], ["readOwnerCode", "roc"]] }]);
  assert.deepEqual(memberCalls(src, "agents"), ["add", "readOwnerCode"]);
});

test("drivers call only steps their page objects have", async () => {
  const missing = [];
  let checked = 0;
  for (const file of drivers) {
    const source = readFileSync(path.join(e2e, file), "utf8");
    for (const { module, names } of pageImports(source)) {
      const mod = await import(pathToFileURL(path.join(here, module)).href);
      for (const [orig, local] of names) {
        if (!(orig in mod)) {
          missing.push(`${file}: ${orig} is not exported by lib/pages/${module}`);
          continue;
        }
        const value = mod[orig];
        if (value === null || typeof value !== "object") continue;
        for (const member of memberCalls(source, local)) {
          checked++;
          if (typeof value[member] !== "function") missing.push(`${file}: ${local}.${member}(…) — lib/pages/${module}'s ${orig} has no ${member}`);
        }
      }
    }
  }
  assert.ok(checked > 0, "no page-object calls found: the reader is broken");
  assert.deepEqual(missing, []);
});
