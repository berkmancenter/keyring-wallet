#!/usr/bin/env node
// Is a wallet commit's CI test build green? One tested answer for every watcher, instead of ad hoc jq.
//
// Rules, learned the hard way (10-07, 10-08):
//   - a run counts only if its headSha is the commit asked about and its event is the one asked for;
//   - a run is green only when status is "completed" AND conclusion is exactly "success";
//   - an empty or missing conclusion is pending, never done;
//   - a cancelled, failed or skipped run is failed; an older green run of the same commit still counts.
//
//   green.mjs --sha <wallet-sha> [--event push|workflow_dispatch] [--json]
//       prints "green <run-id>" | "pending <run-id>" | "failed <run-id> <conclusion>" | "none"; exit 0 green, 1 not yet, 2 failed
//   green.mjs --newest-main [--json]
//       the newest main commit with a green push build: prints "<sha> <run-id>"; exit 1 when there is none
//
// `gh` must be authenticated with actions:read on the repository.
import { execFileSync } from 'node:child_process';

export const REPO = 'berkmancenter/keyring-wallet';
export const WORKFLOW = 'test-builds.yml';

const newestFirst = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

/** The state of one commit's build of one kind, from a list of runs (any status, any commit). */
export function judge(runs, sha, { event = 'push' } = {}) {
  const mine = (runs || []).filter((r) => r && r.headSha === sha && r.event === event).sort(newestFirst);
  if (mine.length === 0) return { state: 'none' };
  const green = mine.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (green) return { state: 'green', run: green.databaseId };
  const open = mine.find((r) => r.status !== 'completed' || !r.conclusion);
  if (open) return { state: 'pending', run: open.databaseId };
  return { state: 'failed', run: mine[0].databaseId, conclusion: mine[0].conclusion };
}

/** The newest green push build on main, from a list of runs. */
export function newestGreenMain(runs) {
  const ok = (runs || [])
    .filter((r) => r && r.event === 'push' && r.headBranch === 'main' && r.status === 'completed' && r.conclusion === 'success')
    .sort(newestFirst);
  return ok.length ? { sha: ok[0].headSha, run: ok[0].databaseId, createdAt: ok[0].createdAt } : null;
}

const FIELDS = 'databaseId,headSha,headBranch,event,status,conclusion,createdAt';

export function listRuns(args) {
  const out = execFileSync('gh', ['run', 'list', '-R', REPO, '--workflow', WORKFLOW, '--json', FIELDS, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

function cli(argv) {
  const opt = { event: 'push', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sha') opt.sha = argv[++i];
    else if (a === '--event') opt.event = argv[++i];
    else if (a === '--newest-main') opt.newest = true;
    else if (a === '--json') opt.json = true;
    else {
      process.stderr.write(`green.mjs: unknown argument ${a}\n`);
      return 3;
    }
  }
  if (opt.newest) {
    const found = newestGreenMain(listRuns(['--branch', 'main', '--event', 'push', '-L', '30']));
    if (!found) {
      process.stdout.write(opt.json ? 'null\n' : 'none\n');
      return 1;
    }
    process.stdout.write(opt.json ? `${JSON.stringify(found)}\n` : `${found.sha} ${found.run}\n`);
    return 0;
  }
  if (!opt.sha || !/^[0-9a-f]{7,40}$/.test(opt.sha)) {
    process.stderr.write('green.mjs: --sha <wallet-sha> or --newest-main\n');
    return 3;
  }
  // gh matches --commit on the full sha; a short one is resolved by the caller. The judge re-checks headSha.
  const runs = listRuns(['--commit', opt.sha, '--event', opt.event, '-L', '20']);
  const v = judge(runs, opt.sha, { event: opt.event });
  if (opt.json) process.stdout.write(`${JSON.stringify({ sha: opt.sha, event: opt.event, ...v })}\n`);
  else process.stdout.write([v.state, v.run, v.conclusion].filter(Boolean).join(' ') + '\n');
  return v.state === 'green' ? 0 : v.state === 'failed' ? 2 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`green.mjs: ${e.message}\n`);
    process.exit(3);
  }
}
