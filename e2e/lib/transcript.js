// Every run writes its own transcript, without anyone having to remember to
// redirect it.
//
// Written after a failing vetting run was diagnosed from a screenshot and a
// page-source dump because its console output no longer existed: the run had
// been piped through `tail`, which buffers until the process exits and then
// keeps only the last lines — so the one line naming what the runner was
// waiting for was gone, and the failure had to be reconstructed from the DOM.
// The artifacts survived and the reasoning did not.
//
// stdout and stderr are wrapped rather than `console.*` because the useful
// detail is mostly NOT ours: WebdriverIO logs every command and its result
// through its own logger straight to stdout, and that is the part that says
// which selector was being waited on when a run died.
//
// The terminal still gets everything, unchanged — this only adds a copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(here, "..", "artifacts");

export let transcriptPath;

if (process.env.E2E_NO_TRANSCRIPT !== "1") {
  try {
    fs.mkdirSync(artifacts, { recursive: true });
    // Name it after the runner, so a chain of rungs leaves a readable trail
    // rather than several files distinguishable only by their timestamps.
    const runner = path.basename(process.argv[1] ?? "run", ".js");
    const when = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    transcriptPath = path.join(artifacts, `${runner}-${when}.log`);
    const fd = fs.openSync(transcriptPath, "a");

    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      stream.write = (chunk, encoding, callback) => {
        // Best effort: a transcript must never be the reason a run fails, so
        // a write error here is swallowed rather than propagated.
        try {
          fs.writeSync(fd, typeof chunk === "string" ? chunk : Buffer.from(chunk));
        } catch {
          /* ignore */
        }
        return write(chunk, encoding, callback);
      };
    }

    // Relative, because that is what a reader pastes back into a command.
    writeLine(`[e2e] transcript: artifacts/${path.basename(transcriptPath)}`);
  } catch {
    // No artifacts directory, a read-only checkout: run without a transcript
    // rather than refusing to run at all.
  }
}

function writeLine(line) {
  process.stdout.write(`${line}\n`);
}
