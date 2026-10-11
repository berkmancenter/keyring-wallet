// node --test e2e/lib/layoutRules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLayout, layoutLines, parsePageSource } from './layoutRules.js';

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
