// node --test e2e/gate/target.test.mjs
// Every run says which infrastructure it tested against (farm or local), so a local pass is never read as a Farm pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const fn = (file, name) => readFileSync(path.join(here, file), 'utf8').match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];

function bash(script, home) {
  return execFileSync('bash', ['-c', `set -u; say() { echo "$*"; }; die() { echo "STOP $*"; exit 1; }; stamp() { echo 2026-10-11T00:00:00; }
    GATE_HOME=${JSON.stringify(home)}; REPO=${JSON.stringify(repo)}
    ${script}`], { encoding: 'utf8' }).trim();
}

test('the target comes from the env file, else from its name', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'target-'));
  try {
    const env = (name, body) => { const p = path.join(home, name); writeFileSync(p, body); return p; };
    const gateEnv = fn('lib.sh', 'gate_env');
    const run = (p) => bash(`GATE_ENV=${JSON.stringify(p)}; ${gateEnv}; gate_env; echo "$GATE_TARGET"`, home);
    assert.equal(run(env('farm.env', 'PNM_BIN=x\n')), 'farm');
    assert.equal(run(env('local.env', 'GATE_TARGET=\n')), 'local');
    assert.equal(run(env('other.env', 'GATE_TARGET=local\n')), 'local');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a new run records its target in meta, and the report says it on its first line', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'target-'));
  try {
    mkdirSync(path.join(home, 'runs'));
    const rd = bash(`GATE_TARGET=local; ${fn('gate.sh', 'new_run')}; new_run 20fc1b2aea3ae3329b9d59d276c79b79a7c3ca3e gate`, home);
    const meta = readFileSync(path.join(rd, 'meta'), 'utf8');
    assert.match(meta, /^target=local$/m);
    writeFileSync(path.join(rd, 'legs.tsv'), 'kk\t0\t100\t160\n');
    mkdirSync(path.join(rd, 'kk'));
    writeFileSync(path.join(rd, 'kk', 'leg.log'), '');
    const report = bash(`leg_rows() { :; }; ${fn('gate.sh', 'cmd_report')}; cmd_report ${JSON.stringify(path.basename(rd))}`, home);
    assert.match(report.split('\n')[0], /· target=local /);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
