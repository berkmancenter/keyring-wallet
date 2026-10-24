// node --test e2e/gate/appLogs.test.mjs
// The app's own log kept by the legs a release check reads it from. 268 (the TSP 1.0 stopgap) is judged on every agent
// and community call going over DIDComm, which only the app's lines show; the waiting leg, a core journey, kept none.
// hv names its per-device logs in its driver (applicant-android.log, vetter-ios.log on 1022-0149) and is not pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const leg = (name) => readFileSync(path.join(here, 'legs', `${name}.sh`), 'utf8');
const finOf = (src) => src.match(/^fin\(\) \{\n([\s\S]*?)\n\}/m)?.[1] ?? '';

for (const name of ['waiting', 'agents', 'testreq', 'p1']) {
  test(`${name} streams the phone's logcat for the whole leg and stops it in its cleanup`, () => {
    const src = leg(name);
    const start = src.indexOf('adb -s $E logcat -c; adb -s $E logcat -v time > "$LEG_DIR/logcat.log" 2>/dev/null & LC=$!');
    assert.ok(start > 0, 'the stream starts');
    assert.ok(start > src.indexOf('emu_start'), 'after the emulator is up');
    assert.ok(start < src.indexOf('cd "$E2E"'), 'before any driver runs');
    assert.match(finOf(src), /kill "\$LC"/, 'and the cleanup stops it');
  });
}

test('kk and signin-ios save the app\'s iOS log', () => {
  assert.match(leg('kk'), /ios_log_save "\$APPLICANT_SIM_UDID" "\$LEG_DIR\/applicant-ios\.log"/);
  assert.match(leg('kk'), /ios_log_save "\$VETTER_SIM_UDID" "\$LEG_DIR\/vetter-ios\.log"/);
  assert.match(leg('signin-ios'), /ios_log_save "\$U" "\$LEG_DIR\/ios\.log"/);
});
