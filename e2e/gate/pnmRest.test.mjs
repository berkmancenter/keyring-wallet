// node --test e2e/gate/pnmRest.test.mjs
// The Mac gates' PNM_BIN (pnm-rest.sh): REST by default, a caller's own --transport kept, PNM_TRANSPORT=auto honoured,
// and a per-slug fall back to the default transport when REST fails before reaching the runner. A fake inner pnm logs
// its arguments and answers as told; nothing real is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wrapper = path.join(here, 'pnm-rest.sh');

/** Run the wrapper with a fake inner pnm. `restAnswer` is what a --transport rest call prints (stderr) and its rc. */
function call(args, { restAnswer = { rc: 0, err: '' }, env = {}, setup, wrapperPath = wrapper } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pnmrest-'));
  try {
    const inner = path.join(dir, 'inner');
    writeFileSync(inner, `#!/bin/bash
echo "$*" >> "${dir}/calls"
case " $* " in *" --transport rest "*) echo "rest-out"; printf '%s\\n' "$REST_ERR" >&2; exit "$REST_RC" ;; esac
echo "default-out"; exit 0
`);
    chmodSync(inner, 0o755);
    setup?.(dir);
    const r = spawnSync('bash', [wrapperPath, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, PNM_INNER: inner, GATE_PNM_TRANSPORT_DIR: path.join(dir, 'transport'), REST_RC: String(restAnswer.rc), REST_ERR: restAnswer.err, ...env },
    });
    const calls = existsSync(path.join(dir, 'calls')) ? readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n') : [];
    const mark = path.join(dir, 'transport', 'mini-prague');
    return { ...r, calls, marked: existsSync(mark) ? readFileSync(mark, 'utf8') : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ACL = ['--vta', 'mini-prague', 'acl', 'list', '--json'];

test('a call goes over REST, with --transport rest last, and its answer passes through', () => {
  const r = call(ACL);
  assert.equal(r.status, 0);
  assert.deepEqual(r.calls, ['--vta mini-prague acl list --json --transport rest']);
  assert.equal(r.stdout.trim(), 'rest-out');
});

test('a caller\'s own --transport is kept, and PNM_TRANSPORT=auto adds none (a leg testing pnm\'s own DIDComm/TSP path)', () => {
  assert.deepEqual(call([...ACL, '--transport', 'didcomm']).calls, ['--vta mini-prague acl list --json --transport didcomm']);
  assert.deepEqual(call([...ACL, '--transport=tsp']).calls, ['--vta mini-prague acl list --json --transport=tsp']);
  assert.deepEqual(call(ACL, { env: { PNM_TRANSPORT: 'auto' } }).calls, ['--vta mini-prague acl list --json']);
});

test('no --vta (help, vta list) passes through untouched', () => {
  assert.deepEqual(call(['vta', 'list']).calls, ['vta list']);
});

test('REST failing before the runner (refused, no route, DNS): the call is made again on the default, and the slug is marked', () => {
  for (const err of ['Error: error sending request for url (https://vta-x/acl): Connection refused', 'Error: REST transport not available: no VTARest service', 'dns error: failed to lookup address']) {
    const r = call(ACL, { restAnswer: { rc: 1, err } });
    assert.equal(r.status, 0, err);
    assert.deepEqual(r.calls, ['--vta mini-prague acl list --json --transport rest', '--vta mini-prague acl list --json'], err);
    assert.equal(r.stdout.trim(), 'default-out');
    assert.match(r.stderr, /\[pnm-rest\] mini-prague: REST failed/);
    assert.ok(r.marked, err);
  }
});

test('a slug marked within the window goes straight to the default; an old mark is tried on REST again', () => {
  const fresh = call(ACL, { setup: (d) => { spawnSync('mkdir', ['-p', path.join(d, 'transport')]); writeFileSync(path.join(d, 'transport', 'mini-prague'), 'x'); } });
  assert.deepEqual(fresh.calls, ['--vta mini-prague acl list --json']);
  const old = call(ACL, { env: { GATE_PNM_REST_RETRY_S: '0' }, setup: (d) => { spawnSync('mkdir', ['-p', path.join(d, 'transport')]); writeFileSync(path.join(d, 'transport', 'mini-prague'), 'x'); } });
  assert.deepEqual(old.calls, ['--vta mini-prague acl list --json --transport rest']);
});

test('a timeout: a read is made again; a write is NOT (it may have landed), and returns pnm\'s own failure', () => {
  const read = call(ACL, { restAnswer: { rc: 1, err: 'Error: operation timed out' } });
  assert.equal(read.calls.length, 2);
  const write = call(['--vta', 'mini-prague', 'acl', 'delete', 'did:key:z6Mk'], { restAnswer: { rc: 1, err: 'Error: operation timed out' } });
  assert.deepEqual(write.calls, ['--vta mini-prague acl delete did:key:z6Mk --transport rest']);
  assert.equal(write.status, 1);
  assert.equal(write.marked, null);
});

test('pnm\'s own answer (not found, consent required) is returned as it is, never retried', () => {
  const r = call(['--vta', 'mini-prague', 'policy', 'delete', 'gate-x'], { restAnswer: { rc: 1, err: 'Error: Not found: task failed: not found: policy `gate-x`' } });
  assert.equal(r.status, 1);
  assert.equal(r.calls.length, 1);
  assert.match(r.stderr, /not found: policy/);
});

test('control: a wrapper without the fallback fails the refused-REST case that the real one passes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pnmrest-mut-'));
  try {
    const src = readFileSync(wrapper, 'utf8');
    const cut = src.replace(/\n  exec "\$INNER" "\$@"\nfi\n/, '\nfi\n');
    assert.notEqual(cut, src, 'the mutant was not made');
    const mutant = path.join(dir, 'pnm-rest.sh'); writeFileSync(mutant, cut);
    const err = 'Error: error sending request for url (https://vta-x/acl): Connection refused';
    assert.notEqual(call(ACL, { restAnswer: { rc: 1, err }, wrapperPath: mutant }).stdout.trim(), 'default-out');
    assert.equal(call(ACL, { restAnswer: { rc: 1, err } }).stdout.trim(), 'default-out');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
