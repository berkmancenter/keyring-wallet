// node --test e2e/gate/removalNotice.test.mjs
// IN-621 / IN-627: the Android legs that join C removed their member AFTER uninstalling the app and stopping the
// emulator, so the phone could never collect C's removal notice. Each notice then sat in C's outbox for its 30-day
// window (vtc-service REMOVAL_NOTICE_DELIVER_BY), polled every 10 s. c_members_remove_collected removes the member while
// the app still runs and waits for the app's own "[VTI] applied a removal notice" line, logged after the removal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const fn = (src, name) => src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];
const helper = [fn(lib, 'c_members_remove_collected')].concat(['_crc_notices', '_crc_remove'].map((n) => lib.match(new RegExp(`^${n}\\(\\) \\{[^\\n]*(?:\\n  [^\\n]*)*`, 'm'))?.[0])).join('\n');

const A = 'did:webvh:QmA:dids.ic3.dev:frown-coral';
const CLOCK = 1794300000;
const applied = (t) => `${t}.120  4321  4400 I ReactNativeJS: [VTI] applied a removal notice from did:webvh:QmCC… (adminRemoved)`;
const ignored = (t) => `${t}.500  4321  4400 W ReactNativeJS: [VTI] ignored a removal notice (already removed)`;

/**
 * Runs the helper against a fake phone: `pid` ('' = the app is not running), `readable` (false = `logcat -d` fails), and
 * `logcat` (what `logcat -d` prints before any removal). `collects` is how many removals the phone answers by
 * logging a notice (`line`): the fake removal appends it, as the real phone logs it after
 * the removal. Returns the admin calls, the adb calls and what was printed.
 */
function run({ pid = '4321', readable = true, status = 'member-removed -> 3', skip = '', slow = 0, rollAfterRemoval = false, logcat = '', wait = '2', out = `JOIN_MEMBER ${A}\n`, tags = '', collects = 1, line = applied(CLOCK + 1) } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'notice-'));
  try {
    writeFileSync(path.join(dir, 'leg.out'), out);
    writeFileSync(path.join(dir, 'logcat'), logcat);
    const calls = path.join(dir, 'calls'), adbs = path.join(dir, 'adbs');
    const printed = execFileSync('bash', ['-c', `set -u
      D=${JSON.stringify(dir)}; BID=asml.bkc.harvard.wallet; GATE_NOTICE_WAIT=${wait}${tags ? `; NOTICE_TAGS=${JSON.stringify(tags)}` : ""}${skip ? `; NOTICE_SKIP=${JSON.stringify(skip)}` : ""}
      galarm() { shift; "$@"; }
      c_admin() {
        echo "$*" >> ${JSON.stringify(calls)}; sleep ${slow}; echo ${JSON.stringify(status)}
        [ "$(wc -l < ${JSON.stringify(calls)})" -le ${collects} ] && echo ${JSON.stringify(line)} >> "$D/logcat"
        ${rollAfterRemoval ? 'tail -n +2 "$D/logcat" > "$D/l2"; mv "$D/l2" "$D/logcat"' : ':'}; return 0
      }
      adb() {
        echo "$*" >> ${JSON.stringify(adbs)}
        case "$*" in
          *"shell pidof"*) printf '%s\\r\\n' ${JSON.stringify(pid)} ;;
          *"logcat -d"*) ${readable ? 'cat "$D/logcat"' : 'return 1'} ;;
        esac
      }
      ${helper}
      c_members_remove_collected emulator-5572 "gate: flow B member, removed after the leg" "$D/leg.out"`]).toString();
    const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
    return { calls: read(calls), adbs: read(adbs), printed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('lib.sh has the helper', () => assert.ok(helper));

test('a notice the app logs after the removal is collected: one removal, NOTICE_DELIVERED with the seconds', () => {
  const r = run({ logcat: `${applied(CLOCK - 300)}\n` });
  assert.deepEqual(r.calls, [`member-remove ${A} gate: flow B member, removed after the leg`]);
  assert.match(r.printed, new RegExp(`^NOTICE_DELIVERED ${A} \\d+ removal=3$`, 'm'));
  assert.ok(r.adbs.some((a) => /monkey -p asml\.bkc\.harvard\.wallet/.test(a)), 'the app is brought to the front first');
});

test('"ignored a removal notice" also means the phone collected it', () => {
  assert.match(run({ line: ignored(CLOCK + 1) }).printed, /^NOTICE_DELIVERED /m);
});

test('control: a notice line from BEFORE the removal does not count, so it waits out the cap and says not collected', () => {
  const t = Date.now();
  const r = run({ logcat: `${applied(CLOCK - 1)}\n${applied(CLOCK - 3600)}\n`, collects: 0, wait: '2' });
  assert.match(r.printed, new RegExp(`^NOTICE_NOT_DELIVERED ${A} none in 2 s removal=3$`, 'm'));
  assert.doesNotMatch(r.printed, /^NOTICE_DELIVERED /m);
  assert.ok(Date.now() - t >= 1500, 'it waited for the notice');
  assert.equal(r.calls.length, 1, 'the member is removed either way');
});

test('control: an app that is not running cannot collect; the member is still removed, with no wait', () => {
  const r = run({ pid: '' });
  assert.match(r.printed, new RegExp(`^NOTICE_NOT_DELIVERED ${A} app not running removal=3$`, 'm'));
  assert.equal(r.calls.length, 1);
  assert.ok(!r.adbs.some((a) => /logcat/.test(a)), 'nothing to read');
});

test('an unreadable log before the removal: nothing is counted, and the member is still removed', () => {
  const r = run({ readable: false });
  assert.match(r.printed, /^NOTICE_NOT_DELIVERED \S+ log unreadable removal=3$/m);
  assert.equal(r.calls.length, 1);
});

test('no JOIN_MEMBER line: no removal and no adb call (control)', () => {
  const r = run({ out: 'nothing here\n' });
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.adbs, []);
});

test('NOTICE_TAGS picks the driver\'s own member lines (agents: R2/R6/R10_MEMBER), each once, and only those', () => {
  const B = 'did:webvh:QmB:dids.ic3.dev:pause-canyon';
  const out = `R2_MEMBER ${A}\nR6_MEMBER ${B}\nR10_MEMBER ${A}\nJOIN_MEMBER did:webvh:QmZ:dids.ic3.dev:not-this-leg\nR3_MEMBER did:webvh:QmY:x\n`;
  const r = run({ out, tags: 'R2_MEMBER|R6_MEMBER|R10_MEMBER', collects: 2 });
  assert.deepEqual(r.calls.map((c) => c.split(' ')[1]).sort(), [A, B].sort());
  assert.equal((r.printed.match(/^NOTICE_DELIVERED /gm) ?? []).length, 2);
});

test('control: one notice for two members collects one; the first member\'s line is not the second\'s', () => {
  const B = 'did:webvh:QmB:dids.ic3.dev:pause-canyon';
  const r = run({ out: `JOIN_MEMBER ${A}\nJOIN_MEMBER ${B}\n`, collects: 1 });
  assert.equal((r.printed.match(/^NOTICE_DELIVERED /gm) ?? []).length, 1, r.printed);
  assert.equal((r.printed.match(/^NOTICE_NOT_DELIVERED \S+ none in 2 s removal=3$/gm) ?? []).length, 1, r.printed);
});


test('the removal\'s status rides on the NOTICE_ line; a removal that printed none says removal=none', () => {
  assert.match(run({ status: 'error: 502 Bad Gateway', collects: 0 }).printed, /^NOTICE_NOT_DELIVERED \S+ none in 2 s removal=none$/m);
});

test('NOTICE_SKIP removes without waiting or reading the phone, and says why', () => {
  const t = Date.now();
  const r = run({ skip: 'last install is not the member\'s' });
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.adbs, []);
  assert.match(r.printed, new RegExp(`^NOTICE_NOT_DELIVERED ${A} not waited: last install is not the member's removal=3$`, 'm'));
  assert.ok(Date.now() - t < 1500);
});

test('the wait is counted from when the removal returned, not from before it (a slow removal keeps its 2 s)', () => {
  const t = Date.now();
  const r = run({ collects: 0, wait: '2', status: 'member-removed -> 3', slow: 2 });
  assert.match(r.printed, /none in 2 s/);
  // The helper counts whole seconds, so the cap is effectively [wait - 1, wait]: fixed, it lasts at least slow + wait - 1
  // = 3 s; the bug (the wait started before the removal) ends at about 2 s.
  assert.ok(Date.now() - t >= 2500, `waited ${Date.now() - t} ms`);
});

test('waiting.sh removes without the wait, with its reason (its last install is the cards-back re-link)', () => {
  const fin = fn(readFileSync(path.join(here, 'legs/waiting.sh'), 'utf8'), 'fin') ?? '';
  assert.match(fin, /NOTICE_SKIP="last install is the cards-back re-link, not the member's" \\\n\s+c_members_remove_collected \$E /);
});

test('a log that rolls during the wait (fewer notice lines than the baseline) is its own reason, not "none"', () => {
  const r = run({ logcat: `${applied(CLOCK - 9)}\n${applied(CLOCK - 8)}\n`, collects: 0, rollAfterRemoval: true });
  assert.match(r.printed, /^NOTICE_NOT_DELIVERED \S+ log rolled removal=3$/m);
});

// The order inside each leg's fin(): the member is removed (and its notice waited for) before the app is uninstalled,
// the emulator stopped and the phone's keys removed. No direct member-remove is left in those fins.
const ORDER_LEGS = ['waiting', 'lostreq', 'update-android', 'relaunch-android', 'agents'];
function orderProblems(fin) {
  const at = (re) => { const m = fin.search(re); return m < 0 ? Infinity : m; };
  const remove = at(/c_members_remove_collected \$E /);
  const problems = [];
  if (remove === Infinity) problems.push('no c_members_remove_collected');
  for (const [what, re] of [['uninstall', /uninstall \$BID/], ['emu_stop', /emu_stop/], ['keys_since', /keys_since /]]) {
    if (at(re) < remove) problems.push(`${what} before the removal`);
  }
  if (/c_admin member-remove/.test(fin)) problems.push('a direct member-remove is left');
  return problems;
}

for (const leg of ORDER_LEGS) {
  test(`${leg}.sh removes its member before the app goes`, () => {
    const fin = fn(readFileSync(path.join(here, `legs/${leg}.sh`), 'utf8'), 'fin') ?? '';
    assert.deepEqual(orderProblems(fin), []);
  });
}

test('control: the order check catches the old fin (uninstall and emu_stop, then the removal)', () => {
  const old = `fin() {
  { [ -n "\${LC:-}" ] && kill "$LC" 2>/dev/null; }
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
  local m; for m in $(grep -oE '^JOIN_MEMBER did:[^ ]+' "$LEG_DIR/waiting.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …\${m: -24}: $(c_admin member-remove "$m" "gate: flow B member, removed after the leg" | grep -oE -- '-> [0-9]+' | tail -1)"
  done
}`;
  assert.deepEqual(orderProblems(old).sort(), ['a direct member-remove is left', 'emu_stop before the removal', 'keys_since before the removal',
    'no c_members_remove_collected', 'uninstall before the removal'].sort());
  const moved = old.replace('  adb -s $E uninstall', '  c_members_remove_collected $E "x" "$LEG_DIR/waiting.out"\n  adb -s $E uninstall').replace(/  local m;[\s\S]*?done\n/, '');
  assert.deepEqual(orderProblems(moved), []);
  const late = moved.replace(/  c_members_remove_collected[^\n]*\n([\s\S]*?keys_since[^\n]*\n)/, '$1  c_members_remove_collected $E "x" "$LEG_DIR/waiting.out"\n');
  assert.deepEqual(orderProblems(late).sort(), ['emu_stop before the removal', 'keys_since before the removal', 'uninstall before the removal'].sort());
});
