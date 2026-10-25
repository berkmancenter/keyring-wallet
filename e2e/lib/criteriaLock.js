/**
 * The lab community's admission criteria are one shared setting: the invite
 * runner drops `vetted-member` for its run, the vetting runner drops
 * `invited-member` for its own, and each restores on the way out. Two sessions
 * running them at once flip the criteria under each other's applicant — on
 * 2026-09-22 an apply landed while no vetting criterion existed and was
 * referred, not admitted.
 *
 * One lock, held for the whole run, in the stack directory so every worktree
 * shares it. A lock whose owner process is gone is taken over.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOCK = path.join(process.env.STACK_DIR || path.join(os.homedir(), "vti-stack"), "criteria.lock");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

export async function holdCriteriaLock(who, { timeoutMs = 45 * 60 * 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  let told = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(path.join(LOCK, "owner"), `${process.pid} ${who} ${new Date().toISOString()}\n`);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let owner = "";
      try {
        owner = readFileSync(path.join(LOCK, "owner"), "utf8").trim();
      } catch {
        /* being written */
      }
      const pid = Number(owner.split(" ")[0]);
      if (pid && !alive(pid)) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > until) throw new Error(`community criteria lock still held after ${timeoutMs / 60000} min: ${owner}`);
      if (!told) console.log(`[e2e] waiting for the community criteria lock (held by ${owner || "?"})`);
      told = true;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  const release = () => {
    try {
      if (readFileSync(path.join(LOCK, "owner"), "utf8").startsWith(`${process.pid} `)) rmSync(LOCK, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  };
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { release(); process.exit(130); });
  return release;
}
