// node --test e2e/gate/pairIos.test.mjs
// The pair-ios leg (share link #453, message-wake tap #452): in the iOS group, not a core journey; a build without the
// features' testIDs SKIPs every row instead of failing them; its rows carry what they do not prove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const leg = readFileSync(path.join(here, 'legs', 'pair-ios.sh'), 'utf8');
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const driver = readFileSync(path.join(here, '..', 'run-pair-ios.mjs'), 'utf8');

test('pair-ios runs in the iOS group and is not a core journey', () => {
  assert.match(gate.match(/^LEGS_IOS="([^"]*)"/m)[1], /\bpair-ios\b/);
  assert.doesNotMatch(gate.match(/^CORE_JOURNEYS="([^"]*)"/m)[1], /pair-ios/);
});

test('a build without the testIDs is a SKIP of every row', () => {
  const check = leg.match(/^miss=.*$/m)[0];
  const run = (bundle) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pair-'));
    writeFileSync(path.join(dir, 'main.jsbundle'), bundle);
    return execFileSync('bash', ['-c', `set -u; CAND_APP=${dir}; ${check}; echo "[$miss]"`], { encoding: 'utf8' }).trim();
  };
  assert.equal(run('…"MyQRShareLink"…"MessagesFetchingNew"…'), '[]');
  assert.equal(run('…"MyQRShareLink"…'), '[ MessagesFetchingNew]');
  assert.match(leg, /for r in \$PAIR_ROWS; do row "\$r" SKIP "the build lacks\$miss/);
});

test('the rows say what they do not prove, and the wake is judged by the screen', () => {
  assert.match(driver, /\(iOS; Android unproven\)/);
  assert.match(driver, /tap path only; the mediator wake isn't exercised/);
  assert.match(driver, /return \{ ok: chat, detail/);
  assert.match(driver, /return \{ ok: list && !chat, detail/);
  assert.doesNotMatch(leg + driver, /simctl (erase|delete)/, 'the simulators are never erased or deleted');
});

test('the wake rows are NOT RUN on a build that names no push gateway, and run on one that does', () => {
  const check = leg.match(/^PAIR_WAKE=on$[\s\S]*?PAIR_WAKE=off; fi$/m)[0];
  const run = (keys) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pair-'));
    writeFileSync(path.join(dir, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>KeyRing</string></dict></plist>');
    writeFileSync(path.join(dir, 'KeyRing'), keys.map((k) => `\0${k}\0`).join('padding'));
    return execFileSync('bash', ['-c', `set -u; CAND_APP=${dir}; ${check}; echo $PAIR_WAKE`], { encoding: 'utf8' }).trim();
  };
  assert.equal(run(['MEDIATOR_URL']), 'off', 'the push-off build: the testers\' configuration');
  assert.equal(run(['MEDIATOR_URL', 'PUSH_GATEWAY_URL']), 'on', 'a build that names the gateway');
  assert.equal(run([]), 'on', 'a binary whose config could not be read is not taken for push-off');
  assert.match(driver, /NOT RUN \(no push permission in gate builds\)/);
  assert.equal((driver.match(/\{ skip: WAKE_NOT_RUN \}/g) ?? []).length, 2);
});
