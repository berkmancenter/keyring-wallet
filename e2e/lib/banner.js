// Clear pass/fail banners printed at the end of every e2e runner script, so a
// completed run is easy to spot when scrolled back through appium/mocha noise.
const RULE = "=".repeat(60);

export function printSuccess(name) {
  console.log(`\n${RULE}\n✅  E2E PASSED — ${name}\n${RULE}\n`);
}

export function printFailure(name, err) {
  console.error(`\n${RULE}\n❌  E2E FAILED — ${name}\n    ${err.message}\n${RULE}\n`);
}

/** A run that could not proceed on this build, for a stated reason (lib/v2Mint.js): not a pass, not a failure. */
export function printSkipped(name, reason) {
  console.log(`\n${RULE}\n⏭️  E2E SKIPPED (not run) — ${name}\n    ${reason}\n${RULE}\n`);
}
