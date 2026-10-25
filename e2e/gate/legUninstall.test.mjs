// node --test e2e/gate/legUninstall.test.mjs — the legs' own uninstalls can only reach an emulator: every leg that
// runs `adb -s $E uninstall` sets E to a literal emulator serial (review on #433). The JS side is guarded by
// lib/prodGuard.js; this keeps the shell side from ever being pointed at a phone (E=$ANDROID_SERIAL, say).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'legs');

test('every leg that uninstalls with adb -s $E sets E only to a literal emulator serial', () => {
  const bad = [];
  for (const f of readdirSync(LEGS).filter((n) => n.endsWith('.sh'))) {
    const src = readFileSync(path.join(LEGS, f), 'utf8');
    if (!/adb -s "?\$\{?E\}?"? (shell pm clear|uninstall)/.test(src)) continue;
    const sets = [...src.matchAll(/(?:^|[\s;])E=("?)([^\s;"]*)\1/gm)].map((m) => m[2]);
    // A leg that takes E from elsewhere must refuse anything but an emulator serial before using it.
    const guarded = /\[\[ \$E =~ \^emulator-\[0-9\]\{4\}\$ \]\] \|\|/.test(src);
    if (!sets.length || sets.some((v) => !/^emulator-\d{4}$/.test(v) && !guarded)) bad.push(`${f}: E=${sets.join(', ') || '(not set)'}`);
  }
  assert.deepEqual(bad, []);
});
