// node --test e2e/gate/farm-drift.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciPin, drift, farmVersion, WORKFLOW } from './farm-drift.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FARM = 'vta-service 0.56.0 (openapi 0dffcc36ad56) · Lab Community VTC 7ca44d7a96b6 (0.11.58) · checked 2026-10-11 14:48Z';

test('the real workflow carries a full commit and a version', () => {
  const pin = ciPin(readFileSync(WORKFLOW, 'utf8'));
  assert.match(pin.ref, /^[0-9a-f]{40}$/);
  assert.match(pin.version, /^\d+\.\d+\.\d+$/);
});

test("the Farm's free-text record: the vta-service version only", () => {
  assert.equal(farmVersion(FARM), '0.56.0');
  assert.equal(farmVersion('vta-service v0.57.1 · …'), '0.57.1');
  assert.equal(farmVersion('Lab Community VTC 7ca44d7a96b6 (0.11.58)'), undefined);
  assert.equal(farmVersion(undefined), undefined);
});

test('match, drift and unknown', () => {
  const pin = { ref: '39c801ed091cdd0aaa8247b8c7aa8e564903d4d6', version: '0.56.0' };
  assert.equal(drift({ pin, farm: FARM }).exit, 0);
  const d = drift({ pin, farm: FARM.replace('0.56.0', '0.57.0') });
  assert.equal(d.exit, 1);
  assert.match(d.line, /^DRIFT: .*0\.56\.0 .*the Farm runs 0\.57\.0/);
  assert.equal(drift({ pin, farm: 'unrecorded' }).exit, 2);
  assert.equal(drift({ pin: { ref: pin.ref }, farm: FARM }).exit, 2);
});

test('the command line prints one line and exits by the verdict', () => {
  const run = (farm) => { try { return { out: execFileSync('node', [path.join(here, 'farm-drift.mjs'), '--farm', farm], { encoding: 'utf8' }).trim(), code: 0 }; } catch (e) { return { out: String(e.stdout).trim(), code: e.status }; } };
  const v = ciPin(readFileSync(WORKFLOW, 'utf8')).version;
  assert.equal(run(`vta-service ${v} · x`).code, 0);
  const d = run('vta-service 9.9.9 · x');
  assert.equal(d.code, 1);
  assert.match(d.out, /^DRIFT/);
});
