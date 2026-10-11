/**
 * Layout rules over the view hierarchy (Appium's page source), minutes not hours: what a screen's structure says
 * about its layout, before any screenshot review (the testing report's Proposal C, part 1).
 *   tap-size   an interactive element smaller than 44 x 44 pt (iOS) or 48 x 48 dp (Android)
 *   clipped    an interactive element partly outside the window, and not inside a scrolling container
 *   overlap    two interactive elements whose frames overlap (a tap could land on either)
 *   centred    a navigation bar's title more than 2 pt (or dp) off the window's centre line
 * Text truncation is not here: the hierarchy holds the full text, not what was drawn. That is the vision review.
 * Findings are data; a driver decides whether they fail a row (advisory until the rules are calibrated).
 */

const IOS_INTERACTIVE = /^XCUIElementType(Button|Link|Switch|Slider|TextField|SecureTextField|TextView|SegmentedControl|Cell|Tab|PickerWheel|Stepper)$/;
const IOS_SCROLL = /^XCUIElementType(ScrollView|Table|CollectionView|WebView)$/;
const ANDROID_SCROLL = /(ScrollView|RecyclerView|ListView|ViewPager|HorizontalScrollView|ReactScrollView)$/;

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : undefined;
};

/** The elements of a page source, with frames in points (iOS) or dp (Android, from px by `scale`), and nesting. */
export function parsePageSource(xml, { platform = 'ios', scale = 1 } = {}) {
  const elements = [];
  const stack = [];
  for (const m of String(xml).matchAll(/<(\/?)([A-Za-z0-9_.$]+)([^>]*?)(\/?)>/g)) {
    const [, closing, type, rest, selfClosing] = m;
    if (closing) { stack.pop(); continue; }
    if (type === 'hierarchy' || type === 'AppiumAUT' || type === '?xml') { if (!selfClosing) stack.push(null); continue; }
    const tag = ` ${rest}`;
    let frame, interactive, visible, label, scroll;
    if (platform === 'ios') {
      frame = { x: +attr(tag, 'x'), y: +attr(tag, 'y'), w: +attr(tag, 'width'), h: +attr(tag, 'height') };
      visible = attr(tag, 'visible') === 'true';
      interactive = IOS_INTERACTIVE.test(type) && attr(tag, 'enabled') !== 'false';
      label = attr(tag, 'name') || attr(tag, 'label') || '';
      scroll = IOS_SCROLL.test(type);
    } else {
      const b = (attr(tag, 'bounds') || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
      const [x1, y1, x2, y2] = b ? b.slice(1).map(Number) : [NaN, NaN, NaN, NaN];
      frame = { x: x1 / scale, y: y1 / scale, w: (x2 - x1) / scale, h: (y2 - y1) / scale };
      visible = attr(tag, 'displayed') !== 'false' && attr(tag, 'visible-to-user') !== 'false';
      interactive = attr(tag, 'clickable') === 'true' && attr(tag, 'enabled') !== 'false';
      label = attr(tag, 'resource-id') || attr(tag, 'content-desc') || attr(tag, 'text') || '';
      scroll = ANDROID_SCROLL.test(attr(tag, 'class') || type) || attr(tag, 'scrollable') === 'true';
    }
    const parent = stack.length ? stack[stack.length - 1] : null;
    const el = { type, frame, visible, interactive, label: label.replace(/^.*:id\//, ''), scroll, inScroll: Boolean(parent && (parent.scroll || parent.inScroll)), navTitle: false };
    if (platform === 'ios' && type === 'XCUIElementTypeStaticText' && parent && parent.type === 'XCUIElementTypeNavigationBar') el.navTitle = true;
    elements.push(el);
    if (!selfClosing) stack.push(el);
  }
  return elements;
}

const valid = (f) => [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
const name = (e) => `${e.type.replace(/^XCUIElementType/, '').split('.').pop()}${e.label ? ` "${e.label.slice(0, 40)}"` : ''}`;
const r1 = (n) => Math.round(n * 10) / 10;

/** Findings: [{ rule, element, detail }]. `window` is { w, h } in the same units as the frames. */
export function checkLayout(elements, { platform = 'ios', window }) {
  const out = [];
  const min = platform === 'ios' ? 44 : 48;
  const unit = platform === 'ios' ? 'pt' : 'dp';
  const live = elements.filter((e) => e.visible && valid(e.frame));
  const taps = live.filter((e) => e.interactive);
  for (const e of taps) {
    if (e.frame.w < min || e.frame.h < min) out.push({ rule: 'tap-size', element: name(e), detail: `${r1(e.frame.w)}×${r1(e.frame.h)} ${unit}, under ${min}×${min}` });
    if (window && !e.inScroll) {
      const off = e.frame.x < 0 || e.frame.y < 0 || e.frame.x + e.frame.w > window.w + 0.5 || e.frame.y + e.frame.h > window.h + 0.5;
      const inside = e.frame.x < window.w && e.frame.y < window.h && e.frame.x + e.frame.w > 0 && e.frame.y + e.frame.h > 0;
      if (off && inside) out.push({ rule: 'clipped', element: name(e), detail: `frame ${r1(e.frame.x)},${r1(e.frame.y)} ${r1(e.frame.w)}×${r1(e.frame.h)} runs past the ${r1(window.w)}×${r1(window.h)} window` });
    }
  }
  for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
    const a = taps[i], b = taps[j];
    // Nested interactive elements (a cell and its button) are one control, not an overlap.
    if (overlaps(a.frame, b.frame) && !contains(a.frame, b.frame) && !contains(b.frame, a.frame)) out.push({ rule: 'overlap', element: `${name(a)} / ${name(b)}`, detail: 'their frames overlap; a tap could land on either' });
  }
  if (window) for (const e of live.filter((x) => x.navTitle)) {
    const off = e.frame.x + e.frame.w / 2 - window.w / 2;
    if (Math.abs(off) > 2) out.push({ rule: 'centred', element: name(e), detail: `title centre ${off > 0 ? '+' : ''}${r1(off)} ${unit} off the window's centre line` });
  }
  return out;
}

/** One line per finding, for logs: LAYOUT <screen> <rule> <element> — <detail>. */
export const layoutLines = (screen, findings) => findings.map((f) => `LAYOUT ${screen} ${f.rule} ${f.element} — ${f.detail}`);
