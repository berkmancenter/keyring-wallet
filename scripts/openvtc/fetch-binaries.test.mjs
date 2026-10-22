// node --test scripts/openvtc/fetch-binaries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { allowLatest, downloadVerdict, parseManifest } from './binaryPolicy.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const script = path.join(here, 'fetch-binaries.mjs');
const sha = (s) => createHash('sha256').update(s).digest('hex');

// What the moving pointer serves today vs. what was verified.
const SERVED = '#!/bin/sh\necho served\n';
const PINNED = '#!/bin/sh\necho pinned\n';

async function withLab(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fetch-binaries-test-'));
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    res.end(SERVED);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const lab = {
    dir,
    hits,
    binDir: path.join(dir, 'bin'),
    snapshotDir: path.join(dir, 'pins'),
    writePins(binaries) {
      writeFileSync(path.join(dir, 'pins.json'), JSON.stringify({ updated: 'x', releaseChannel: 'dogwood', binaries }));
    },
    run(args, env = {}) {
      return new Promise((resolve) => {
        execFile(process.execPath, [script, ...args], {
          env: {
            ...process.env,
            FETCH_BINARIES_ALLOW_LATEST: '',
            FETCH_BINARIES_ORIGIN: `http://127.0.0.1:${server.address().port}`,
            FETCH_BINARIES_BIN_DIR: lab.binDir,
            FETCH_BINARIES_PINS_FILE: path.join(dir, 'pins.json'),
            // Never the machine's real snapshot.
            FETCH_BINARIES_PINS_DIR: lab.snapshotDir,
            ...env,
          },
        }, (err, stdout) => resolve({ code: err ? err.code : 0, out: stdout }));
      });
    },
    cached: (name) => (existsSync(path.join(lab.binDir, name)) ? readFileSync(path.join(lab.binDir, name), 'utf8') : null),
  };
  try {
    await fn(lab);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const vta = (pinnedSha256) => ({ vta: { urlPath: 'vta/latest/vta', pinnedSha256 } });

test('a moving build that drifted from its pin is refused and the cache is left alone', () =>
  withLab(async (lab) => {
    lab.writePins(vta(sha(PINNED)));
    const { code, out } = await lab.run(['vta']);
    assert.equal(code, 1);
    assert.match(out, /vta .*DRIFT — REFUSED, not cached/);
    assert.equal(lab.cached('vta'), null);
    assert.deepEqual(lab.hits, ['/vta/latest/vta']);
  }));

test('a download matching the pinned sha256 is cached', () =>
  withLab(async (lab) => {
    lab.writePins(vta(sha(SERVED)));
    const { code, out } = await lab.run(['vta']);
    assert.equal(code, 0, out);
    assert.match(out, /✓ vta .*matches pin/);
    assert.equal(lab.cached('vta'), SERVED);
    assert.ok(statSync(path.join(lab.binDir, 'vta')).mode & 0o100, 'cached binary is executable');
  }));

test('a binary with no pin is refused by default', () =>
  withLab(async (lab) => {
    lab.writePins(vta(null));
    const { code, out } = await lab.run(['vta']);
    assert.equal(code, 1);
    assert.match(out, /no pin recorded yet .*REFUSED/);
    assert.equal(lab.cached('vta'), null);
  }));

test('--latest and FETCH_BINARIES_ALLOW_LATEST=1 opt into the moving build, drift still reported', () =>
  withLab(async (lab) => {
    lab.writePins(vta(sha(PINNED)));
    const flag = await lab.run(['vta', '--latest']);
    assert.equal(flag.code, 1, 'drift is still a problem');
    assert.match(flag.out, /LATEST opted in/);
    assert.doesNotMatch(flag.out, /REFUSED/);
    assert.equal(lab.cached('vta'), SERVED);

    rmSync(lab.binDir, { recursive: true });
    lab.writePins(vta(null));
    const env = await lab.run(['vta'], { FETCH_BINARIES_ALLOW_LATEST: '1' });
    assert.equal(env.code, 0, 'an unpinned build taken on purpose is not a problem');
    assert.equal(lab.cached('vta'), SERVED);
  }));

test('--check probes upstream without caching anything', () =>
  withLab(async (lab) => {
    lab.writePins(vta(sha(SERVED)));
    const { code } = await lab.run(['vta', '--check']);
    assert.equal(code, 0);
    assert.equal(lab.cached('vta'), null);
  }));

test('a binary in the pinned snapshot is copied from it, with no download', () =>
  withLab(async (lab) => {
    mkdirSync(lab.snapshotDir);
    writeFileSync(path.join(lab.snapshotDir, 'pnm'), PINNED);
    writeFileSync(
      path.join(lab.snapshotDir, 'MANIFEST.tsv'),
      `# pinned 2026-10-22\npnm\t0.56.0\t${sha(PINNED)}\tsource tag v0.56.0\tfrom /x/pnm\n`,
    );
    lab.writePins({ 'pnm-client': { urlPathTemplate: 'releases/{channel}/{os}/pnm', pinnedSha256: null } });
    const { code, out } = await lab.run(['pnm-client']);
    assert.equal(code, 0, out);
    assert.match(out, /✓ pnm-client +0\.56\.0 .*from pinned/);
    assert.equal(lab.cached('pnm-client'), PINNED);
    assert.deepEqual(lab.hits, []);
  }));

test('a snapshot binary whose bytes differ from its manifest is refused', () =>
  withLab(async (lab) => {
    mkdirSync(lab.snapshotDir);
    writeFileSync(path.join(lab.snapshotDir, 'pnm'), SERVED);
    writeFileSync(path.join(lab.snapshotDir, 'MANIFEST.tsv'), `pnm\t0.56.0\t${sha(PINNED)}\tsrc\tfrom\n`);
    lab.writePins({ 'pnm-client': { urlPathTemplate: 'releases/{channel}/{os}/pnm', pinnedSha256: null } });
    const { code, out } = await lab.run(['pnm-client']);
    assert.equal(code, 1);
    assert.match(out, /pnm-client .*REFUSED: .*manifest says/);
    assert.equal(lab.cached('pnm-client'), null);
  }));

test('parseManifest reads the snapshot format and skips comments and bad hashes', () => {
  const m = parseManifest(`# header\npnm\t0.56.0\t${'a'.repeat(64)}\ttag v0.56.0\tfrom /p\nbad\tx\tnot-a-sha\n\n`);
  assert.deepEqual([...m.keys()], ['pnm']);
  assert.deepEqual(m.get('pnm'), { version: '0.56.0', sha256: 'a'.repeat(64), source: 'tag v0.56.0' });
});

test('downloadVerdict caches only a match unless latest is opted in', () => {
  assert.deepEqual(downloadVerdict({ sha256: 'a', pinnedSha256: 'a', latest: false }), { cache: true, status: 'match', problem: false });
  assert.deepEqual(downloadVerdict({ sha256: 'b', pinnedSha256: 'a', latest: false }), { cache: false, status: 'drift', problem: true });
  assert.deepEqual(downloadVerdict({ sha256: 'b', pinnedSha256: null, latest: false }), { cache: false, status: 'unpinned', problem: true });
  assert.deepEqual(downloadVerdict({ sha256: 'b', pinnedSha256: 'a', latest: true }), { cache: true, status: 'drift', problem: true });
  assert.deepEqual(downloadVerdict({ sha256: 'b', pinnedSha256: null, latest: true }), { cache: true, status: 'unpinned', problem: false });
  assert.equal(allowLatest(['--latest'], {}), true);
  assert.equal(allowLatest([], { FETCH_BINARIES_ALLOW_LATEST: '1' }), true);
  assert.equal(allowLatest([], { FETCH_BINARIES_ALLOW_LATEST: '0' }), false);
});
