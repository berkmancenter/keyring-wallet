// node --test e2e/openvtc/style.test.mjs
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { at177 } from './tuiRoles.js';

const tui = (version) => ({ version });
afterEach(() => { delete process.env.OPENVTC_TUI_STYLE; });

test('listed builds are driven in the current style, bare or as the gate names a release', () => {
  assert.equal(at177(tui('ed13d29')), false);
  assert.equal(at177(tui('ed13d29abcdef')), false);
  assert.equal(at177(tui('v0.5.0-2a4fa2b3')), false); // OPENVTC_VERSION as the gate passes it (openvtc 0.5.0)
  assert.equal(at177(tui('2a4fa2b3')), false);
});

test('anything not listed stays 177a218-style, as before', () => {
  assert.equal(at177(tui('177a218')), true);
  assert.equal(at177(tui('v0.4.0-8991f9ca')), true);
  assert.equal(at177(tui('')), true);
  assert.equal(at177(tui('v0.5.0')), true); // no commit to match
});

test('OPENVTC_TUI_STYLE still overrides either way', () => {
  process.env.OPENVTC_TUI_STYLE = '177a218';
  assert.equal(at177(tui('v0.5.0-2a4fa2b3')), true);
  process.env.OPENVTC_TUI_STYLE = 'current';
  assert.equal(at177(tui('v0.4.0-8991f9ca')), false);
});
