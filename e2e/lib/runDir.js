/**
 * Where a run's artifacts go: `E2E_RUN_DIR` when the gate runner sets one per
 * leg (so an iOS and an Android leg running side by side never write over each
 * other's screenshots), else `artifacts/` relative to where the driver runs,
 * exactly as before.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

/** The run's artifact directory. */
export const runDir = () => process.env.E2E_RUN_DIR || "artifacts";

/** A path for an artifact in this run's directory, which is created if missing. */
export function runPath(name) {
  const dir = runDir();
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
