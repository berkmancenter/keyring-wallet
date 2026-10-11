/**
 * Layout rules over the view hierarchy (Appium's page source), minutes not hours: what a screen's structure says
 * about its layout, before any screenshot review (the testing report's Proposal C, part 1).
 *   tap-size   an interactive element smaller than 44 x 44 pt (iOS) or 48 x 48 dp (Android)
 *   clipped    an interactive element partly outside the window, and not inside a scrolling container
 *   overlap    two interactive elements whose frames overlap (a tap could land on either), each frame clipped first to
 *              its scrolling container's viewport: content scrolled under a header is not on screen to tap
 *   centred    a navigation bar's title more than 2 pt (or dp) off the window's centre line
 * Text truncation is not here: the hierarchy holds the full text, not what was drawn. That is the vision review.
 * Findings are data; a driver decides whether they fail a row (advisory until the rules are calibrated).
 * Calibration: the window is the root element's frame unless given; frames that share at most 1 pt/dp are not an
 * overlap (rounding); only the app's own window is judged, never the keyboard (on iOS the keys live in a later
 * XCUIElementTypeWindow, with traits "KeyboardKey", not always under XCUIElementTypeKeyboard); and an allowlist
 * (layout.allow.json) marks findings the hierarchy cannot see past, each with its reason (e.g. a hitSlop that makes a
 * small frame a full-size target). Allowlist labels should be testIDs, not visible text, which repeats across screens.
 */

const IOS_INTERACTIVE = /^XCUIElementType(Button|Link|Switch|Slider|TextField|SecureTextField|TextView|SegmentedControl|Cell|Tab|PickerWheel|Stepper)$/;
const IOS_SCROLL = /^XCUIElementType(ScrollView|Table|CollectionView|WebView)$/;
const IOS_KEYBOARD = /^XCUIElementType(Keyboard|Key)$/;
// uiautomator2 dumps only the active app window unless multi-window dumps are on, so this matters only then (Gboard's
// nodes carry package="com.google.android.inputmethod.latin").
const ANDROID_KEYBOARD = /inputmethod|keyboard/i;
const OVERLAP_TOLERANCE = 1;
const ANDROID_SCROLL = /(ScrollView|RecyclerView|ListView|ViewPager|HorizontalScrollView|ReactScrollView)$/;

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : undefined;
};

/** The elements of a page source, with frames in points (iOS) or dp (Android, from px by `scale`), and nesting. */
export function parsePageSource(xml, { platform = 'ios', scale = 1 } = {}) {
  const elements = [];
  const stack = [];
  let windows = 0;
  for (const m of String(xml).matchAll(/<(\/?)([A-Za-z0-9_.$]+)([^>]*?)(\/?)>/g)) {
    const [, closing, type, rest, selfClosing] = m;
    if (closing) { stack.pop(); continue; }
    if (type === 'hierarchy' || type === 'AppiumAUT' || type === '?xml') { if (!selfClosing) stack.push(null); continue; }
    const tag = ` ${rest}`;
    let frame, interactive, visible, label, scroll, keyboard;
    if (platform === 'ios') {
      frame = { x: +attr(tag, 'x'), y: +attr(tag, 'y'), w: +attr(tag, 'width'), h: +attr(tag, 'height') };
      visible = attr(tag, 'visible') === 'true';
      interactive = IOS_INTERACTIVE.test(type) && attr(tag, 'enabled') !== 'false';
      label = attr(tag, 'name') || attr(tag, 'label') || '';
      scroll = IOS_SCROLL.test(type);
      keyboard = IOS_KEYBOARD.test(type) || /\bKeyboardKey\b/.test(attr(tag, 'traits') || '');
    } else {
      const b = (attr(tag, 'bounds') || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
      const [x1, y1, x2, y2] = b ? b.slice(1).map(Number) : [NaN, NaN, NaN, NaN];
      frame = { x: x1 / scale, y: y1 / scale, w: (x2 - x1) / scale, h: (y2 - y1) / scale };
      visible = attr(tag, 'displayed') !== 'false' && attr(tag, 'visible-to-user') !== 'false';
      interactive = attr(tag, 'clickable') === 'true' && attr(tag, 'enabled') !== 'false';
      label = attr(tag, 'resource-id') || attr(tag, 'content-desc') || attr(tag, 'text') || '';
      scroll = ANDROID_SCROLL.test(attr(tag, 'class') || type) || attr(tag, 'scrollable') === 'true';
      keyboard = ANDROID_KEYBOARD.test(attr(tag, 'package') || '');
    }
    const parent = stack.length ? stack[stack.length - 1] : null;
    // iOS: a window after the application's first (the keyboard host, a system alert) is not the app's screen.
    if (platform === 'ios' && type === 'XCUIElementTypeWindow' && parent && parent.root) windows++;
    const laterWindow = platform === 'ios' && type === 'XCUIElementTypeWindow' && parent && parent.root && windows > 1;
    const el = { type, frame, visible, interactive, label: label.replace(/^.*:id\//, ''), scroll, inScroll: Boolean(parent && (parent.scroll || parent.inScroll)), keyboard: Boolean(keyboard || (parent && parent.keyboard)), outside: Boolean(laterWindow || (parent && parent.outside)), root: !parent,
      viewport: parent ? (parent.scroll ? clip(parent.frame, parent.viewport) : parent.viewport) : null, navTitle: false };
    if (platform === 'ios' && type === 'XCUIElementTypeStaticText' && parent && parent.type === 'XCUIElementTypeNavigationBar') el.navTitle = true;
    elements.push(el);
    if (!selfClosing) stack.push(el);
  }
  return elements;
}

/** The part of frame a inside viewport v (null: no viewport, a whole); an empty part has w or h of 0. */
function clip(a, v) {
  if (!v) return a;
  const x = Math.max(a.x, v.x), y = Math.max(a.y, v.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, v.x + v.w) - x), h: Math.max(0, Math.min(a.y + a.h, v.y + v.h) - y) };
}
const valid = (f) => [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0;
// Overlap beyond the tolerance on both axes: neighbours whose frames share a rounding edge are not an overlap.
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > OVERLAP_TOLERANCE && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > OVERLAP_TOLERANCE;
const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
const name = (e) => `${e.type.replace(/^XCUIElementType/, '').split('.').pop()}${e.label ? ` "${e.label.slice(0, 40)}"` : ''}`;
const r1 = (n) => Math.round(n * 10) / 10;

/** The window, from the hierarchy's root element (the application or the root layout), in the frames' units. */
export function rootWindow(elements) {
  const root = elements.find((e) => e.root && valid(e.frame));
  return root ? { w: root.frame.x + root.frame.w, h: root.frame.y + root.frame.h } : null;
}

/**
 * The allowlist: [{ rule, label, reason, with?, screen?, platform? }]. A finding is kept but marked { allowed: reason },
 * never counted, when its rule matches, its element has that label (an overlap: the pair is exactly label + with, in
 * either order), and screen and platform match where the entry names them. Labels should be testIDs.
 */
export function readAllow(json) {
  const list = (json && json.allow) || [];
  for (const a of list) {
    if (!a || !a.rule || !a.label || !a.reason) throw new Error(`layout allowlist: every entry needs rule, label and reason (${JSON.stringify(a)})`);
    if (a.rule === 'overlap' && !a.with) throw new Error(`layout allowlist: an overlap entry needs "with", the other element's label (${JSON.stringify(a)})`);
  }
  return list;
}

const allowMatch = (a, f, { screen, platform }) =>
  a.rule === f.rule &&
  (!a.screen || a.screen === screen) &&
  (!a.platform || a.platform === platform) &&
  (f.rule === 'overlap' ? [a.label, a.with].sort().join('\n') === [...f.labels].sort().join('\n') : f.labels.includes(a.label));

/** Findings: [{ rule, element, labels, detail, allowed? }]. `window` is { w, h } in the frames' units (default: the root's). */
export function checkLayout(elements, { platform = 'ios', window = rootWindow(elements), allow = [], screen } = {}) {
  const out = [];
  const min = platform === 'ios' ? 44 : 48;
  const unit = platform === 'ios' ? 'pt' : 'dp';
  const live = elements.filter((e) => e.visible && !e.keyboard && !e.outside && valid(e.frame));
  const taps = live.filter((e) => e.interactive);
  for (const e of taps) {
    if (e.frame.w < min || e.frame.h < min) out.push({ rule: 'tap-size', element: name(e), labels: [e.label], detail: `${r1(e.frame.w)}×${r1(e.frame.h)} ${unit}, under ${min}×${min}` });
    if (window && !e.inScroll) {
      const off = e.frame.x < 0 || e.frame.y < 0 || e.frame.x + e.frame.w > window.w + 0.5 || e.frame.y + e.frame.h > window.h + 0.5;
      const inside = e.frame.x < window.w && e.frame.y < window.h && e.frame.x + e.frame.w > 0 && e.frame.y + e.frame.h > 0;
      if (off && inside) out.push({ rule: 'clipped', element: name(e), labels: [e.label], detail: `frame ${r1(e.frame.x)},${r1(e.frame.y)} ${r1(e.frame.w)}×${r1(e.frame.h)} runs past the ${r1(window.w)}×${r1(window.h)} window` });
    }
  }
  for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
    const a = taps[i], b = taps[j];
    const fa = clip(a.frame, a.viewport), fb = clip(b.frame, b.viewport);
    if (!valid(fa) || !valid(fb)) continue;
    // Nested interactive elements (a cell and its button) are one control, not an overlap.
    if (overlaps(fa, fb) && !contains(a.frame, b.frame) && !contains(b.frame, a.frame)) out.push({ rule: 'overlap', element: `${name(a)} / ${name(b)}`, labels: [a.label, b.label], detail: 'their frames overlap; a tap could land on either' });
  }
  if (window) for (const e of live.filter((x) => x.navTitle)) {
    const off = e.frame.x + e.frame.w / 2 - window.w / 2;
    if (Math.abs(off) > 2) out.push({ rule: 'centred', element: name(e), labels: [e.label], detail: `title centre ${off > 0 ? '+' : ''}${r1(off)} ${unit} off the window's centre line` });
  }
  for (const f of out) {
    const a = allow.find((x) => allowMatch(x, f, { screen, platform }));
    if (a) f.allowed = a.reason;
  }
  return out;
}

/** The findings that count (not allowlisted). */
export const counted = (findings) => findings.filter((f) => !f.allowed);

/** One line per finding, for logs: LAYOUT <screen> <rule> <element> — <detail>; an allowed one says so and why. */
export const layoutLines = (screen, findings) => findings.map((f) => `${f.allowed ? 'LAYOUT-ALLOWED' : 'LAYOUT'} ${screen} ${f.rule} ${f.element} — ${f.detail}${f.allowed ? ` (allowed: ${f.allowed})` : ''}`);
