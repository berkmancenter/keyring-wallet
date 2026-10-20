// Run a command in its own process group and, past `timeoutS`, kill the whole group. execFileSync's own timeout kills
// only its direct child: a bash script's children (pnm-locked's perl, and pnm, which holds the slug's flock across
// exec) survive it, keep the lock and stall the next pnm call on that agent for PNM_LOCK_WAIT (review on #420).
// Exit 124 means "timed out, the whole group killed".
import { execFileSync } from "node:child_process";

// The child leads its own group (set on both sides of the fork, so neither races); the wrapper stays outside it, kills
// the group on the alarm, reaps the child and exits 124.
const WRAP = 'my $t=shift; my $p=fork; die "fork: $!" unless defined $p; if(!$p){setpgrp(0,0); exec @ARGV; exit 127} setpgrp($p,$p); $SIG{ALRM}=sub{kill "KILL", -$p; waitpid($p,0); exit 124}; alarm $t; waitpid($p,0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)';

/** execFileSync(cmd, args) in its own process group; the group is killed after timeoutS. Throws like execFileSync. */
export function runGrouped(cmd, args, { timeoutS = 180, ...opts } = {}) {
  return execFileSync("perl", ["-e", WRAP, String(timeoutS), cmd, ...args], { ...opts, timeout: (timeoutS + 15) * 1000 });
}

export const TIMED_OUT = 124;
