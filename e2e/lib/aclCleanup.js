/**
 * Remove the ACL entries a run created on the runner VTA — and only those.
 *
 * Every link run leaves admin keys behind: the phone's temporary key, and the
 * permanent key it rotates onto. On 2026-09-23 the Farm runner VTA held 25 of
 * them, each a full admin, from phones long since wiped. A run now cleans up
 * after itself:
 *
 *   const before = snapshotAcl({ slug, pnmHome })        // before the phone shows its key
 *   ...
 *   finally { removeRunKeys({ slug, pnmHome, before, tempDid, failed }) }
 *
 * What is removed is decided by ownership, not by "new since the snapshot":
 * two runs on one VTA can overlap by seconds when they hand it back and forth,
 * and a pure diff would delete the other run's keys. So only this run's own
 * temporary DID, and every entry whose `createdBy` chain leads back to it
 * (the rotated key, and whatever that key created), are removed. Anything else
 * that is new is logged as "not mine, left alone".
 *
 * DIDs are compared in full, from `pnm acl list --json`: the table view
 * truncates a ~350-character did:peer:2, and a prefix is not an identity.
 *
 * On a failed run the keys are KEPT by default — a grant that did not work is
 * evidence (VTI-Q19 was one) — and the exact delete commands are printed.
 * E2E_ACL_CLEANUP=always removes them anyway; E2E_ACL_CLEANUP=never keeps
 * them even on success.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const PNM = process.env.PNM_BIN || path.join(os.homedir(), "Documents/vti-main/target/debug/pnm");
/** A person's own agents: never touched by a runner. */
const REFUSED = new Set(["alice", "farm"]);

function pnm(slug, pnmHome, args) {
  return execFileSync(PNM, ["--vta", slug, ...args], {
    encoding: "utf8",
    env: { ...process.env, PNM_HOME: pnmHome },
    // pnm prints its banner on stderr; keep it out of the run's log.
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}

/** The ACL as full entries: subject, createdBy, createdAt, label. */
export function listAcl({ slug, pnmHome }) {
  if (REFUSED.has(slug)) throw new Error(`[acl] refusing to read "${slug}": a person's own agent, not a runner's`);
  const out = pnm(slug, pnmHome, ["acl", "list", "--json"]);
  const entries = JSON.parse(out.slice(out.indexOf("[")));
  return entries.map((e) => ({ subject: e.subject, createdBy: e.createdBy, createdAt: e.createdAt, label: e.label }));
}

/** The subjects present before the run touched the VTA. */
export function snapshotAcl({ slug, pnmHome }) {
  return new Set(listAcl({ slug, pnmHome }).map((e) => e.subject));
}

/**
 * This run's entries among `entries`: `tempDid` itself, and everything whose
 * createdBy chain reaches it. Pure — exported for its test.
 */
export function ownedBy(entries, tempDid) {
  const mine = new Set([tempDid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of entries) {
      if (!mine.has(e.subject) && mine.has(e.createdBy)) {
        mine.add(e.subject);
        grew = true;
      }
    }
  }
  return entries.filter((e) => mine.has(e.subject));
}

/**
 * Remove this run's entries. Never throws: a cleanup that fails is logged, and
 * must not turn a passing run red or hide the real failure of a failing one.
 */
export function removeRunKeys({ slug, pnmHome, before, tempDid, failed = false, log = console.log }) {
  try {
    if (!tempDid) {
      log("[acl] no temporary key recorded for this run — nothing to clean up");
      return;
    }
    const entries = listAcl({ slug, pnmHome });
    const added = entries.filter((e) => !before?.has(e.subject));
    const mine = ownedBy(added, tempDid);
    for (const e of added) {
      if (!mine.includes(e)) log(`[acl] not mine, left alone: ${e.subject.slice(0, 40)}… (${e.label ?? "-"}, created by ${e.createdBy.slice(0, 30)}…)`);
    }
    if (!mine.length) {
      log("[acl] this run left no ACL entries on the VTA");
      return;
    }
    const mode = process.env.E2E_ACL_CLEANUP || "";
    const keep = mode === "never" || (failed && mode !== "always");
    if (keep) {
      log(`[acl] keeping ${mine.length} entr${mine.length === 1 ? "y" : "ies"} from this ${failed ? "failed " : ""}run, as evidence. To remove them:`);
      for (const e of mine) log(`  PNM_HOME=${pnmHome} ${PNM} --vta ${slug} acl delete '${e.subject}'`);
      return;
    }
    for (const e of mine) {
      try {
        pnm(slug, pnmHome, ["acl", "delete", e.subject]);
        log(`[acl] removed ${e.subject.slice(0, 40)}… (${e.label ?? "-"}, granted ${e.createdAt})`);
      } catch (err) {
        log(`[acl] could not remove ${e.subject}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
      }
    }
  } catch (err) {
    log(`[acl] cleanup skipped: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
}
