#!/usr/bin/env node
/**
 * Standalone feasibility check: can this machine run the number of
 * emulated/simulated devices a new game's e2e test needs, concurrently,
 * right now? Run this BEFORE writing that test — see
 * .claude/skills/new-game/SKILL.md's "Planning the e2e test" section.
 *
 * Usage:
 *   node check-device-budget.js --android 3
 *   node check-device-budget.js --android 1 --ios 2
 *
 * Exits 0 if feasible, 1 if not (so a skill/script can branch on it), but
 * always prints the full numbers either way — this is a planning tool, not
 * a pass/fail test.
 */
import { checkDeviceBudget } from "./lib/multiDevice.js";

function parseArgs(argv) {
  const out = { android: 0, ios: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--android") out.android = Number(argv[++i] ?? 0);
    if (argv[i] === "--ios") out.ios = Number(argv[++i] ?? 0);
  }
  return out;
}

const { android, ios } = parseArgs(process.argv.slice(2));
const result = checkDeviceBudget({ android, ios });

console.log(`Host: ${result.platform}`);
console.log(
  `Available: ${result.availableRamGb}GB RAM, ${result.availableCpuCores} CPU cores ` +
    `(after reserving ${result.budget.hostReserveRamGb}GB / ${result.budget.hostReserveCpuCores} cores for the host)`
);
console.log(
  `Budget per device: Android emulator ${result.budget.androidEmulatorRamGb}GB / ${result.budget.androidEmulatorCpuCores} cores, ` +
    `iOS Simulator ${result.budget.iosSimulatorRamGb}GB / ${result.budget.iosSimulatorCpuCores} cores`
);
console.log(
  `Requested: ${result.requested.android} Android, ${result.requested.ios} iOS`
);
console.log(
  `Room for at most: ${result.maxFeasible.android} Android, ${result.maxFeasible.ios} iOS`
);

if (result.feasible) {
  console.log("\n✓ Feasible — this machine can run the requested devices concurrently.");
  process.exit(0);
} else {
  console.log("\n✗ Not feasible on this machine:");
  for (const reason of result.reasons) console.log(`  - ${reason}`);
  process.exit(1);
}
