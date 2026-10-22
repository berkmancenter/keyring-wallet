// node --test e2e/gate/refused.test.mjs
// The refused leg (IN-350): in the Android group, not a core journey; a build without the notice SKIPs every row; the
// only ACL it removes mid-run is the phone's own grant (linkedPhoneEntries), and its no-toast row needs evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const leg = readFileSync(path.join(here, 'legs', 'refused.sh'), 'utf8');
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const driver = readFileSync(path.join(here, '..', 'run-agent-refused.mjs'), 'utf8');

test('refused runs in the Android group and is not a core journey', () => {
  assert.match(gate.match(/^LEGS_ANDROID="([^"]*)"/m)[1], /\brefused\b/);
  assert.doesNotMatch(gate.match(/^CORE_JOURNEYS="([^"]*)"/m)[1], /refused/);
});

test('a build without PersonaAgentNotice SKIPs every row before any device work', () => {
  const skip = leg.indexOf('row "$r" SKIP "the build lacks PersonaAgentNotice');
  assert.ok(skip > 0 && skip < leg.indexOf('emu_start'), 'the SKIP comes before the emulator starts');
});

test('the mid-run removal is the phone\'s own grant only, chosen as the cleanup chooses', () => {
  assert.match(driver, /const mine = linkedPhoneEntries\(listAcl\(/);
  assert.equal((driver.match(/deleteAcl\(/g) ?? []).length, 1, 'one deleteAcl, over `mine`');
  assert.match(driver, /for \(const e of mine\) \{\s*deleteAcl\(/);
});

test('the control comes first, and no toast is a verdict only with the refusal in the log', () => {
  assert.ok(driver.indexOf('"refused-before"') < driver.indexOf('linkedPhoneEntries(listAcl('), 'the control runs before the grant goes');
  assert.match(driver, /if \(!toast && !evidence\) rows\.skip\(N\("refused-no-toast"\), `no verdict/);
  assert.match(driver, /never "didn't\s+answer"|UNREACHABLE_LINE/);
});

test('both paths run, each on a fresh link: heartbeat (open past the 5 min tick) and relaunch (the inbox asks again)', () => {
  assert.match(leg, /for path in \$\{REFUSED_PATHS:-heartbeat relaunch\}; do/, 'both by default');
  assert.match(leg, /case \$path in heartbeat\|relaunch\) ;; \*\) broken/, 'an unknown path is broken, not skipped');
  assert.match(leg, /REFUSED_PATH=\$path/);
  assert.match(driver, /const windowMs = HEARTBEAT \? HEARTBEAT_S \* 1000 : 95000;/);
  const heartbeatS = Number(driver.match(/REFUSED_HEARTBEAT_S \|\| (\d+)\)/)[1]);
  assert.ok(heartbeatS >= 2 * 300, `two 5 min presence ticks, not one (362 s missed it): ${heartbeatS}`);
  assert.match(driver, /if \(!HEARTBEAT\) \{ await restartApp\(d\); await unlockToHome\(d\); \}/);
});

test('logcat is dumped only with the emulator there (a missing one hung adb 53 min)', () => {
  const dump = leg.match(/^dump_logcat\(\) \{\n([\s\S]*?)\n\}/m)?.[1] ?? '';
  assert.match(dump, /^\s*adb devices \| grep -q "\^\$E\[\[:space:\]\]" \|\| return 0$/m, 'the guard is the first line');
  assert.ok(dump.indexOf('|| return 0') < dump.indexOf('logcat -d'), 'no adb logcat before the guard');
  assert.match(dump, /logcat -d -v time > "\$LEG_DIR\/logcat-\$1\.log"/);
  assert.match(dump, /logcat -c/, 'cleared after the dump, so the next path starts with its own lines');
});

test('each path keeps its own logcat, dumped before its rows are read; the cleanup keeps the rest', () => {
  const loop = leg.slice(leg.indexOf('for path in ${REFUSED_PATHS:-heartbeat relaunch}; do'));
  assert.ok(loop.indexOf('dump_logcat $path') > loop.indexOf('node run-agent-refused.mjs'), 'after the driver');
  assert.ok(loop.indexOf('dump_logcat $path') < loop.indexOf('take_rows'), 'before the rows are taken');
  assert.match(leg.match(/^fin\(\) \{\n([\s\S]*?)\n\}/m)[1], /^\s*dump_logcat end$/m);
  assert.doesNotMatch(leg.replace(/^dump_logcat\(\) \{[\s\S]*?\n\}/m, ''), /logcat -d/, 'every dump goes through the guard');
});

test('each path reads its own link record, never the other path\'s', () => {
  assert.match(leg, /rm -f "\$LEG_DIR\/last-link.json"/);
  assert.match(leg, /mv "\$LEG_DIR\/last-link.json" "\$LEG_DIR\/last-link-\$path.json"/);
  assert.match(leg, /LINK_FILE="\$LEG_DIR\/last-link-\$path.json"/);
});

test('after a refusal that unlinked the phone, C\'s route asks to link first; the notice is checked only when the link stays', () => {
  const row = driver.slice(driver.indexOf('rows.row(N("refused-community-notice")'));
  const unlinked = row.indexOf('if (removedShown) {');
  assert.ok(unlinked > 0, 'the unlinked case is its own branch');
  assert.ok(unlinked < row.indexOf('PersonaAgentNoticeOpen'), 'decided before the notice\'s own checks');
  const branch = row.slice(unlinked, row.indexOf('let opened = false;\n    if (n.shown'));
  assert.ok(branch.length < row.length, 'the branch ends before the notice\'s own checks');
  assert.match(branch, /existsTestId\(d, "JoinNeedsAgent"/);
  assert.match(branch, /ok: needsAgent && !unreachable/, 'and never "didn\'t answer"');
  assert.ok(driver.indexOf('removedShown = await existsTestId(d, "RemovedPhone"') < driver.indexOf(row), 'RemovedPhone is read first (refused-link-removed)');
});

test('the link status is read before the removal, and each minute of the heartbeat window', () => {
  const before = driver.indexOf('const statusBefore = await linkStatus();');
  assert.ok(before > 0 && before < driver.indexOf('const removedAt = Date.now();'), 'before the removal');
  assert.match(driver, /existsTestId\(d, "RemovedPhone", 3000\)\) \? "removed" : await textOf\(d, "VtaStatusText"\)/);
  assert.match(driver, /if \(!HEARTBEAT \|\| removedSeenAt \|\| Date\.now\(\) < nextSample\) continue;\s*nextSample = Date\.now\(\) \+ 60000;/);
  assert.match(driver, /link before: \$\{statusBefore\} · after: \$\{statuses\.join/, 'the row says both');
});

test('each path streams logcat across the driver, stopped after it; heartbeat gets the longer alarm', () => {
  const loop = leg.slice(leg.indexOf('for path in ${REFUSED_PATHS:-heartbeat relaunch}; do'));
  const start = loop.indexOf('logcat -v time > "$LEG_DIR/logcat-stream-$path.log" 2>/dev/null & lc=$!');
  assert.ok(start > 0 && start < loop.indexOf('node run-agent-refused.mjs'), 'started before the driver');
  assert.ok(loop.indexOf('kill $lc') > loop.indexOf('node run-agent-refused.mjs'), 'stopped after it');
  assert.match(loop, /galarm \$\(\[ \$path = heartbeat \] && echo 2100 \|\| echo 1500\) node run-agent-refused\.mjs/);
});

test('with bifold #473 in the build the unlinked row expects JoinAgentRefused and Open My Agent; without it, link first', () => {
  assert.match(leg, /grep -aq JoinAgentRefused && JOIN_REFUSED=1/);
  assert.match(leg, /REFUSED_JOIN_LINE=\$JOIN_REFUSED/);
  const branch = driver.slice(driver.indexOf('if (removedShown) {'), driver.indexOf('let opened = false;\n    if (n.shown'));
  const withLine = branch.slice(branch.indexOf('if (JOIN_LINE) {'));
  assert.match(withLine, /existsTestId\(d, "JoinAgentRefused", 15000\)/, 'waited for: the identity is read async');
  assert.match(withLine, /ok: shown && refused && !silent && !needsAgent && opened/);
  assert.match(withLine, /tapTestId\(d, "JoinOpenMyAgent"/);
  assert.match(branch.slice(branch.lastIndexOf('const needsAgent')), /ok: needsAgent && !unreachable[\s\S]*\(pre-fix\)/);
});
