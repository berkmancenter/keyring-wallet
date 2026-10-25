/**
 * Import this FIRST in every runner: `import "./lib/cli-guard.js";`.
 *
 * Runners are configured by environment variables and take no arguments, so
 * `node run-x.js --help` used to be read as "run it" — and a run started just
 * to read its options flipped a community's admission criteria on the Farm
 * and wiped a linked phone (2026-09-23, twice in one day). An ES module's
 * imports are evaluated in order, so a guard imported first runs before any
 * other module loads — nothing is opened, started or written.
 *
 *   --help, -h     print the runner's own header comment (its usage) and exit 0
 *   anything else  refuse, and exit 2
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length > 0) {
  const script = process.argv[1] ?? "this runner";
  if (args.some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(`${usageOf(script)}\n`);
    process.exit(0);
  }
  process.stderr.write(
    `${script}: takes no arguments (got: ${args.join(" ")}). It is configured by environment variables — ` +
      `run it with --help to read which. Nothing was started.\n`
  );
  process.exit(2);
}

/** The runner's leading block comment, which is where each one documents its usage and environment. */
function usageOf(script) {
  try {
    const source = readFileSync(script, "utf8");
    const block = /\/\*\*?([\s\S]*?)\*\//.exec(source);
    if (!block) return `${script}: no usage comment found; read the file's header.`;
    return block[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .join("\n")
      .trim();
  } catch {
    return `${script}: could not read its usage comment.`;
  }
}
