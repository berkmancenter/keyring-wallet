// binaryPolicy.mjs — what fetch-binaries.mjs may put in external/bin/.
//
// download.firstperson.dev serves only moving pointers (latest/main, a release
// channel), so a plain download can be any build — after upstream's TSP 1.0
// cutover (2026-10-22) a build that no longer talks to our stack. The default
// is therefore to cache only what is pinned:
//   1. a local pinned snapshot (a dir with MANIFEST.tsv, by default
//      ~/vti-stack/pins/current, a symlink to the dated snapshot the gate runs —
//      nightly-2026-10-22 today), checked by sha256 and platform; or
//   2. a download whose sha256 equals BINARY_PINS.json's pinnedSha256 — the
//      server has no versioned URLs, so that sha is the "explicit version".
// Anything else is refused unless latest is opted into (--latest or
// FETCH_BINARIES_ALLOW_LATEST=1).

import { homedir } from "node:os";
import { join } from "node:path";

// A symlink, so moving to a newer snapshot never needs a code change.
export const DEFAULT_PINS_DIR = join(homedir(), "vti-stack", "pins", "current");

// BINARY_PINS.json name → the file name in a pinned snapshot. The snapshot's
// pnm is the keychain-backed client build, never pnm-server.
export const SNAPSHOT_NAMES = { "pnm-client": "pnm", openvtc: "openvtc" };

/**
 * MANIFEST.tsv: `name \t version \t sha256 \t source \t from \t platform`, '#' lines
 * are comments. platform is `${process.platform}-${process.arch}` (darwin-arm64).
 */
export function parseManifest(text) {
  const entries = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, version, sha256, source, , platform] = line.split("\t");
    if (name && /^[0-9a-f]{64}$/.test(sha256 ?? "")) entries.set(name, { version, sha256, source, platform: platform || null });
  }
  return entries;
}

/** A snapshot binary is used only on the platform it was built for; an entry that doesn't say is never used. */
export function runsHere(entry, here = `${process.platform}-${process.arch}`) {
  return entry.platform === here;
}

export function allowLatest(args, env) {
  return args.includes("--latest") || env.FETCH_BINARIES_ALLOW_LATEST === "1";
}

/**
 * Whether a download may be cached. `problem` counts toward the exit code:
 * drift always does, an unpinned binary only when it is refused.
 */
export function downloadVerdict({ sha256, pinnedSha256, latest }) {
  if (pinnedSha256 && sha256 === pinnedSha256) return { cache: true, status: "match", problem: false };
  const status = pinnedSha256 ? "drift" : "unpinned";
  if (latest) return { cache: true, status, problem: status === "drift" };
  return { cache: false, status, problem: true };
}
