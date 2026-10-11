// node --test e2e/lib/layoutRules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLayout, counted, layoutLines, parsePageSource, readAllow, rootWindow } from './layoutRules.js';

const IOS = `<?xml version="1.0" encoding="UTF-8"?><AppiumAUT>
<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Keyring" x="0" y="0" width="390" height="844" visible="true" enabled="true">
  <XCUIElementTypeNavigationBar type="XCUIElementTypeNavigationBar" x="0" y="47" width="390" height="44" visible="true">
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Your agent" x="120" y="58" width="110" height="22" visible="true"/>
  </XCUIElementTypeNavigationBar>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Next" x="300" y="780" width="70" height="48" visible="true" enabled="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Back" x="20" y="780" width="30" height="30" visible="true" enabled="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Edge" x="360" y="400" width="60" height="48" visible="true" enabled="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Hidden" x="0" y="0" width="10" height="10" visible="false" enabled="true"/>
  <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" x="0" y="100" width="390" height="600" visible="true">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="FarRight" x="380" y="200" width="100" height="48" visible="true" enabled="true"/>
  </XCUIElementTypeScrollView>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="A" x="100" y="600" width="80" height="48" visible="true" enabled="true"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="B" x="150" y="620" width="80" height="48" visible="true" enabled="true"/>
</XCUIElementTypeApplication></AppiumAUT>`;

const ANDROID = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" displayed="true" clickable="false" enabled="true">
    <android.widget.Button class="android.widget.Button" resource-id="com.ariesbifold:id/Next" bounds="[800,2200][1050,2340]" displayed="true" clickable="true" enabled="true"/>
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="com.ariesbifold:id/Back" bounds="[40,2200][140,2300]" displayed="true" clickable="true" enabled="true"/>
  </android.widget.FrameLayout>
</hierarchy>`;

const rules = (findings) => findings.map((f) => `${f.rule} ${f.element}`).sort();

test('iOS: small tap targets, clipping outside a scroller, overlaps and an off-centre title', () => {
  const els = parsePageSource(IOS, { platform: 'ios' });
  const found = rules(checkLayout(els, { platform: 'ios', window: { w: 390, h: 844 } }));
  assert.deepEqual(found, [
    'centred StaticText "Your agent"',
    'clipped Button "Edge"',
    'overlap Button "A" / Button "B"',
    'tap-size Button "Back"',
  ]);
});

test('iOS: hidden elements and elements inside a scroller are not judged on clipping', () => {
  const els = parsePageSource(IOS, { platform: 'ios' });
  const found = checkLayout(els, { platform: 'ios', window: { w: 390, h: 844 } }).map((f) => f.element);
  assert.ok(!found.some((e) => /Hidden|FarRight/.test(e)));
  assert.ok(els.find((e) => e.label === 'FarRight').inScroll);
});

test('Android: frames from px bounds by the display scale; 48 dp minimum', () => {
  const els = parsePageSource(ANDROID, { platform: 'android', scale: 2.625 });
  const back = els.find((e) => e.label === 'Back');
  assert.ok(Math.abs(back.frame.w - 38.1) < 0.1);
  const found = checkLayout(els, { platform: 'android', window: { w: 1080 / 2.625, h: 2400 / 2.625 } });
  assert.deepEqual(rules(found), ['tap-size ViewGroup "Back"']);
});

test('a centred title and a clean screen give no findings; lines name the screen', () => {
  const ok = IOS.replace('name="Your agent" x="120"', 'name="Your agent" x="140"');
  const els = parsePageSource(ok.replace(/<XCUIElementTypeButton[^>]*name="(Back|Edge|A|B)"[^>]*\/>/g, ''), { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(els, { platform: 'ios', window: { w: 390, h: 844 } })), []);
  assert.deepEqual(layoutLines('welcome-1', [{ rule: 'tap-size', element: 'Button "Back"', detail: '30×30 pt' }]), ['LAYOUT welcome-1 tap-size Button "Back" — 30×30 pt']);
});

const ios = (inner) => `<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Keyring" x="0" y="0" width="390" height="844" visible="true" enabled="true">${inner}</XCUIElementTypeApplication></AppiumAUT>`;
const btn = (n, x, y, w = 80, h = 48) => `<XCUIElementTypeButton type="XCUIElementTypeButton" name="${n}" x="${x}" y="${y}" width="${w}" height="${h}" visible="true" enabled="true"/>`;

test('calibration: the window defaults to the root element frame', () => {
  const els = parsePageSource(ios(btn('Edge', 360, 400, 60)), { platform: 'ios' });
  assert.deepEqual(rootWindow(els), { w: 390, h: 844 });
  assert.deepEqual(rules(checkLayout(els, { platform: 'ios' })), ['clipped Button "Edge"']);
  const and = parsePageSource(ANDROID, { platform: 'android', scale: 2.625 });
  assert.ok(Math.abs(rootWindow(and).w - 1080 / 2.625) < 0.01);
});

test('calibration: frames sharing at most 1 pt are neighbours, not an overlap', () => {
  const touch = parsePageSource(ios(btn('A', 100, 600) + btn('B', 179, 600)), { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(touch, { platform: 'ios' })), []);
  const real = parsePageSource(ios(btn('A', 100, 600) + btn('B', 170, 600)), { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(real, { platform: 'ios' })), ['overlap Button "A" / Button "B"']);
});

test('calibration: the keyboard is never judged (iOS keys, an Android input method)', () => {
  const kb = `<XCUIElementTypeKeyboard type="XCUIElementTypeKeyboard" x="0" y="560" width="390" height="284" visible="true"><XCUIElementTypeKey type="XCUIElementTypeKey" name="q" x="3" y="570" width="33" height="42" visible="true" enabled="true"/>${btn('shift', 3, 680, 42, 42)}</XCUIElementTypeKeyboard>`;
  assert.deepEqual(rules(checkLayout(parsePageSource(ios(kb), { platform: 'ios' }), { platform: 'ios' })), []);
  const and = ANDROID.replace('</hierarchy>', '<android.widget.FrameLayout class="android.widget.FrameLayout" package="com.google.android.inputmethod.latin" bounds="[0,1500][1080,2400]" displayed="true"><android.widget.Button class="android.widget.Button" package="com.google.android.inputmethod.latin" bounds="[0,1500][60,1560]" displayed="true" clickable="true" enabled="true"/></android.widget.FrameLayout></hierarchy>');
  assert.deepEqual(rules(checkLayout(parsePageSource(and, { platform: 'android', scale: 2.625 }), { platform: 'android' })), ['tap-size ViewGroup "Back"']);
});

test('calibration: an allowlisted finding is printed with its reason, never counted; entries need a reason', () => {
  const els = parsePageSource(IOS, { platform: 'ios' });
  const allow = readAllow({ allow: [{ rule: 'tap-size', label: 'Back', reason: 'hitSlop 12 makes it 54 pt' }, { rule: 'overlap', label: 'B', with: 'A', reason: 'B sits on A by design' }] });
  const found = checkLayout(els, { platform: 'ios', allow });
  assert.deepEqual(rules(counted(found)), ['centred StaticText "Your agent"', 'clipped Button "Edge"']);
  const lines = layoutLines('welcome-1', found);
  assert.ok(lines.includes('LAYOUT-ALLOWED welcome-1 tap-size Button "Back" — 30×30 pt, under 44×44 (allowed: hitSlop 12 makes it 54 pt)'));
  assert.equal(lines.filter((l) => l.startsWith('LAYOUT ')).length, 2);
  assert.throws(() => readAllow({ allow: [{ rule: 'tap-size', label: 'Back' }] }), /needs rule, label and reason/);
  assert.deepEqual(readAllow({ allow: [] }), []);
});

test('calibration: only the app window is judged; iOS keyboard keys live in a later window with KeyboardKey traits', () => {
  // The shape of a real smoke dump (link-failure, 10-11): window 0 the app, window 1 hidden, window 2 the keyboard host
  // whose Emoji and dictation keys are plain Buttons, not under a Keyboard element.
  const key = (n, x) => `<XCUIElementTypeButton type="XCUIElementTypeButton" name="${n}" x="${x}" y="805" width="69" height="70" visible="true" enabled="true" traits="KeyboardKey, Button"/>`;
  const xml = `<?xml version="1.0"?><AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Keyring" x="0" y="0" width="402" height="874" visible="true" enabled="true">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" x="0" y="0" width="402" height="874" visible="true" enabled="true">${btn('Continue', 20, 700, 362, 48)}${btn('Edge', 370, 400, 60)}</XCUIElementTypeWindow>
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" x="0" y="0" width="402" height="874" visible="false" enabled="true"/>
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" x="0" y="0" width="402" height="874" visible="true" enabled="true"><XCUIElementTypeOther type="XCUIElementTypeOther" x="0" y="560" width="402" height="314" visible="true">${key('Emoji', 8)}${key('dictation', 325)}${key('dictation', 325)}${btn('Stray', 380, 300, 60)}</XCUIElementTypeOther></XCUIElementTypeWindow>
  </XCUIElementTypeApplication></AppiumAUT>`;
  const els = parsePageSource(xml, { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(els, { platform: 'ios' })), ['clipped Button "Edge"']);
  // A key trait alone is enough, even in the app's own window.
  const inApp = parsePageSource(ios(key('Emoji', 360)), { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(inApp, { platform: 'ios' })), []);
});

test('calibration: allowlist entries narrow by screen and platform, and an overlap needs its exact pair', () => {
  const els = parsePageSource(IOS, { platform: 'ios' });
  const allowed = (entries, opts = {}) => rules(checkLayout(els, { platform: 'ios', allow: readAllow({ allow: entries }), ...opts }).filter((f) => f.allowed));
  const back = { rule: 'tap-size', label: 'Back', reason: 'hitSlop' };
  assert.deepEqual(allowed([{ ...back, screen: 'welcome-2' }], { screen: 'welcome-1' }), []);
  assert.deepEqual(allowed([{ ...back, screen: 'welcome-1' }], { screen: 'welcome-1' }), ['tap-size Button "Back"']);
  assert.deepEqual(allowed([{ ...back, platform: 'android' }]), []);
  assert.deepEqual(allowed([{ ...back, platform: 'ios' }]), ['tap-size Button "Back"']);
  assert.deepEqual(allowed([{ rule: 'overlap', label: 'A', with: 'Next', reason: 'r' }]), []);
  assert.deepEqual(allowed([{ rule: 'overlap', label: 'B', with: 'A', reason: 'r' }]), ['overlap Button "A" / Button "B"']);
  assert.throws(() => readAllow({ allow: [{ rule: 'overlap', label: 'B', reason: 'r' }] }), /needs "with"/);
});

test('overlap: frames are clipped to their scroll viewport (the R-Card form scrolled under the No-internet banner)', () => {
  // The shape of the real smoke dump (link-failure, 10-11, iPhone 402x874): the form scrolled up 216 pt, so the label
  // field's frame starts at y=147 while its scroll view's viewport starts at 179; the banner ends at 162.
  const xml = ios(`<XCUIElementTypeButton type="XCUIElementTypeButton" name="com.ariesbifold:id/button-error" x="0" y="106" width="402" height="56" visible="true" enabled="true"/>
    <XCUIElementTypeScrollView type="XCUIElementTypeScrollView" x="21" y="179" width="360" height="374" visible="true"><XCUIElementTypeOther type="XCUIElementTypeOther" x="21" y="-37" width="360" height="700" visible="true">
      <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="com.ariesbifold:id/RCardLabelInput" x="42" y="147" width="318" height="44" visible="true" enabled="true"/>
      ${btn('Hidden', 42, 100, 318, 48)}
    </XCUIElementTypeOther></XCUIElementTypeScrollView>`);
  const els = parsePageSource(xml, { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(els, { platform: 'ios' })).filter((r) => r.startsWith('overlap')), []);
  // The same field not inside a scroller does overlap the banner: the clip is what clears it.
  const flat = parsePageSource(ios(`<XCUIElementTypeButton type="XCUIElementTypeButton" name="button-error" x="0" y="106" width="402" height="56" visible="true" enabled="true"/>${'<XCUIElementTypeTextField type="XCUIElementTypeTextField" name="RCardLabelInput" x="42" y="147" width="318" height="44" visible="true" enabled="true"/>'}`), { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(flat, { platform: 'ios' })).filter((r) => r.startsWith('overlap')), ['overlap Button "button-error" / TextField "RCardLabelInput"']);
  // Two buttons both on screen inside the scroller still overlap.
  const both = parsePageSource(ios(`<XCUIElementTypeScrollView type="XCUIElementTypeScrollView" x="0" y="100" width="390" height="600" visible="true">${btn('A', 100, 300)}${btn('B', 150, 320)}</XCUIElementTypeScrollView>`), { platform: 'ios' });
  assert.deepEqual(rules(checkLayout(both, { platform: 'ios' })), ['overlap Button "A" / Button "B"']);
});
