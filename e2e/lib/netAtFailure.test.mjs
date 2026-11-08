// node --test e2e/lib/netAtFailure.test.mjs
// The network probe a failed link run logs (netAtFailure.js), with a fake exec: nothing real is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { netAtFailure } from './netAtFailure.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = 'mediator.example.org';
const fake = (answers) => { const calls = []; return { calls, exec: (cmd, args) => { calls.push([cmd, ...args].join(' ')); for (const [re, r] of answers) if (re.test([cmd, ...args].join(' '))) return r; return { ok: false, out: 'unanswered' }; } }; };
const now = () => '2026-11-08T10:35:00Z';

test('android: the emulator side (tcp, ping, dns servers) and the Mac side (name, https) are all logged', () => {
  const f = fake([
    [/nc -w 3/, { ok: true, out: 'no-tcp\r' }],
    [/ping -c 1/, { ok: true, out: 'ping: unknown host mediator.example.org\r' }],
    [/getprop/, { ok: true, out: '10.0.2.3\n\n' }],
    [/dscacheutil/, { ok: true, out: 'name: mediator.example.org\nip_address: 203.0.113.7\n' }],
    [/curl/, { ok: true, out: '200 connect 0.05s total 0.20s' }],
  ]);
  const lines = netAtFailure({ host: HOST, serial: 'emulator-5572', platform: 'android', exec: f.exec, now });
  assert.equal(lines[0], '[net] at failure 2026-11-08T10:35:00Z: probing mediator.example.org');
  assert.match(lines[1], /^\[net\] emulator emulator-5572: tcp 443 no-tcp · ping "ping: unknown host mediator\.example\.org" · dns 10\.0\.2\.3$/);
  assert.equal(lines[2], '[net] mac: mediator.example.org resolves to 203.0.113.7');
  assert.equal(lines[3], '[net] mac: https://mediator.example.org/ 200 connect 0.05s total 0.20s');
  assert.ok(f.calls.every((c) => c.startsWith('adb -s emulator-5572 ') || /^(dscacheutil|curl) /.test(c)));
});

test('ios (the simulator shares the Mac\'s network): only the Mac side, no adb', () => {
  const f = fake([[/dscacheutil/, { ok: true, out: '' }], [/curl/, { ok: false, out: 'curl: (6) Could not resolve host: mediator.example.org' }]]);
  const lines = netAtFailure({ host: HOST, platform: 'ios', exec: f.exec, now });
  assert.ok(!f.calls.some((c) => c.startsWith('adb')));
  assert.equal(lines[1], '[net] mac: mediator.example.org resolves to nothing');
  assert.match(lines[2], /failed: curl: \(6\) Could not resolve host/);
});

test('no host configured: says so and probes nothing', () => {
  const f = fake([]);
  assert.deepEqual(netAtFailure({ host: '', platform: 'android', serial: 'emulator-5572', exec: f.exec }), ['[net] at failure: no probe host (GATE_NET_PROBE_HOST / RUNNER_MEDIATOR_HOST), not checked']);
  assert.equal(f.calls.length, 0);
});

test('the link driver logs it on every failure, after the screenshot and page source, and a probe error cannot change the outcome', () => {
  const src = readFileSync(path.join(here, '..', 'run-vta-link.js'), 'utf8');
  const i = src.indexOf('await dumpSource(driver, "link-failure")'), j = src.indexOf('netAtFailure({ host: process.env.GATE_NET_PROBE_HOST || process.env.RUNNER_MEDIATOR_HOST'), k = src.indexOf('printFailure(LINK_MODE === "manual"');
  assert.ok(i > 0 && j > i && k > j, `order ${i} < ${j} < ${k}`);
  assert.match(src.slice(j - 200, j + 300), /try \{[\s\S]*\} catch \(e\) \{[\s\S]*the probe itself failed/);
});
