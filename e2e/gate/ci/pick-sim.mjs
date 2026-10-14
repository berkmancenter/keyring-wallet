#!/usr/bin/env node
/**
 * The simulator a CI smoke runs on: the newest iPhone of the newest iOS runtime the image has, from
 * `xcrun simctl list devices available`. Prints one line, "<udid>\t<name>\t<runtime version>", and the
 * candidates it did not pick to stderr. Exit 1 when the image has no available iPhone.
 *
 *   node e2e/gate/ci/pick-sim.mjs            # newest iPhone, newest runtime
 *   node e2e/gate/ci/pick-sim.mjs 26.3       # that runtime only, when the image has it
 */
import { execFileSync } from "node:child_process";

const wanted = process.argv[2] || "";
const list = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], { encoding: "utf8" }));
const runtimeVersion = (key) => (key.match(/iOS[-.](\d+)[-.](\d+)/) || []).slice(1, 3).map(Number);
const candidates = [];
for (const [runtime, devices] of Object.entries(list.devices ?? {})) {
  const v = runtimeVersion(runtime);
  if (v.length !== 2) continue;
  const version = `${v[0]}.${v[1]}`;
  if (wanted && version !== wanted) continue;
  for (const d of devices) {
    if (!/^iPhone\b/.test(d.name) || d.isAvailable === false) continue;
    const model = Number((d.name.match(/iPhone (\d+)/) || [])[1] || 0);
    candidates.push({ udid: d.udid, name: d.name, version, v, model, plain: /^iPhone \d+$/.test(d.name) ? 0 : 1 });
  }
}
// Newest runtime, then the highest model number, then the plain model before its Pro/Max/Air variants (least memory).
candidates.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.model - a.model || a.plain - b.plain || a.name.localeCompare(b.name));
if (!candidates.length) {
  console.error(`pick-sim: no available iPhone simulator${wanted ? ` on iOS ${wanted}` : ""}`);
  process.exit(1);
}
for (const c of candidates.slice(1, 12)) console.error(`  also: ${c.name} (iOS ${c.version}) ${c.udid}`);
const pick = candidates[0];
process.stdout.write(`${pick.udid}\t${pick.name}\t${pick.version}\n`);
