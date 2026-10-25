/**
 * A fake WebdriverIO session for the page objects' unit tests: a screen that
 * is a map of testID → what it shows, answered through the same selectors
 * lib/driver.js builds (UiSelector resourceId / textContains, `~id`, the
 * starts-with and following-sibling XPaths), so a page object runs the real
 * helpers over a scripted screen. Taps run `d.onTap[id]`; a swipe is counted;
 * nothing waits: `waitForExist` answers at once, and the page objects' own
 * deadlines run on `fakeClock`, which moves only when a step waits. The one
 * real wait left is lib/driver.js's 500 ms after each swipe of a scroll: a
 * test fakes `setTimeout` (node:test `mock.timers`) and passes `tick`, which
 * a swipe then runs after it returns, so an absent element costs no time.
 *
 *   const d = fakeDriver({ screen: { AgentHome: {}, AgentHomeName: { text: "Alpha" } } });
 *   d.onTap.AgentSwitcherRow_1 = () => d.clock.schedule(20000, () => d.show("AgentHomeName", { text: "Bravo" }));
 *
 * An element's spec: { text, desc, children: [texts], sibling: text, enabled,
 * displayed, checked, rect: { x, y, width, height } }.
 */
import { TEST_ID_PREFIX as P } from "../../config.js";

const DEFAULT_RECT = { x: 0, y: 600, width: 1080, height: 120 };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A clock that moves only when the code waits; changes can be scheduled on it. */
export function fakeClock() {
  let t = 0;
  const due = [];
  const run = () => {
    due.sort((a, b) => a.at - b.at);
    while (due.length && due[0].at <= t) due.shift().fn();
  };
  return {
    now: () => t,
    at: () => t,
    wait: async (ms) => {
      t += ms;
      run();
    },
    schedule: (ms, fn) => void due.push({ at: t + ms, fn }),
  };
}

export function fakeDriver({ platform = "android", screen = {}, clock = fakeClock(), tick } = {}) {
  const state = { screen: { ...screen } };
  const ios = platform === "ios";
  const d = {
    e2ePlatform: platform,
    capabilities: {},
    clock,
    taps: [],
    values: {},
    swipes: 0,
    backs: 0,
    shots: [],
    onTap: {},
    onBack: undefined,
    clipboard: "",
    show(id, spec = {}) {
      state.screen[id] = { ...(state.screen[id] || {}), ...spec };
    },
    hide(...ids) {
      for (const id of ids) delete state.screen[id];
    },
    /** The whole screen replaced; an id given as undefined is left out. */
    set(next) {
      state.screen = Object.fromEntries(Object.entries(next).filter(([, spec]) => spec !== undefined));
    },
    has: (id) => id in state.screen,
  };

  const specOf = (key) => {
    if (key.endsWith("::sibling")) {
      const s = state.screen[key.slice(0, -9)];
      return s?.sibling ? { text: s.sibling } : undefined;
    }
    return state.screen[key];
  };

  /** The ids a selector names now, in screen order. */
  const match = (sel) => {
    const ids = Object.keys(state.screen);
    let m;
    if ((m = sel.match(/^android=new UiSelector\(\)\.resourceId\("([^"]+)"\)(?:\.textContains\("([^"]*)"\))?$/))) {
      const id = m[1].replace(P, "");
      return ids.filter((i) => i === id && (m[2] === undefined || String(state.screen[i].text ?? "").includes(m[2])));
    }
    if ((m = sel.match(/^android=new UiSelector\(\)\.textContains\("([^"]*)"\)$/))) return ids.filter((i) => String(state.screen[i].text ?? "").includes(m[1]));
    if ((m = sel.match(/^~(.+)$/))) return ids.filter((i) => i === m[1].replace(P, ""));
    if ((m = sel.match(/^\/\/\*\[starts-with\(@(?:resource-id|name),"([^"]+)"\)\]$/))) {
      const pre = m[1].replace(P, "");
      return ids.filter((i) => i.startsWith(pre));
    }
    if ((m = sel.match(/^\/\/\*\[@resource-id="([^"]+)"\]\/following-sibling::\*\[1\]\[@text!=""\]$/))) {
      const id = m[1].replace(P, "");
      return state.screen[id]?.sibling ? [`${id}::sibling`] : [];
    }
    if ((m = sel.match(/^\/\/\*\[contains\(@text,"([^"]+)"\) or contains\(@content-desc,"([^"]+)"\)\]$/))) {
      return ids.filter((i) => String(state.screen[i].text ?? "").includes(m[1]) || String(state.screen[i].desc ?? "").includes(m[2]));
    }
    return [];
  };

  const textEl = (text) => ({ getAttribute: async (n) => (n === "text" ? text : "") });

  const element = (key) => {
    const idNow = () => (typeof key === "function" ? key() : key);
    const spec = () => {
      const id = idNow();
      return id ? specOf(id) : undefined;
    };
    const exists = () => Boolean(spec());
    return {
      get elementId() {
        return idNow();
      },
      isExisting: async () => exists(),
      isDisplayed: async () => exists() && spec().displayed !== false,
      isEnabled: async () => exists() && spec().enabled !== false,
      waitForExist: async ({ timeoutMsg } = {}) => {
        if (exists()) return true;
        throw new Error(timeoutMsg || `element ${idNow()} not found`);
      },
      waitForDisplayed: async () => {
        if (!exists() || spec().displayed === false) throw new Error(`element ${idNow()} not displayed`);
        return true;
      },
      click: async () => {
        const id = idNow();
        if (!id) throw new Error("click on an element that is not there");
        d.taps.push(id);
        await d.onTap[id]?.(d);
      },
      getAttribute: async (name) => {
        const s = spec();
        if (!s) throw new Error(`stale element ${idNow()}`);
        const id = idNow().replace("::sibling", "");
        switch (name) {
          case "text":
            return s.text ?? "";
          case "content-desc":
          case "label":
            return s.desc ?? "";
          case "resource-id":
          case "name":
            return `${P}${id}`;
          case "checked":
            return String(s.checked ?? false);
          case "visible":
            return "true";
          case "value":
            return d.values[id] ?? s.text ?? "";
          default:
            return "";
        }
      },
      getText: async () => spec()?.text ?? "",
      setValue: async (v) => void (d.values[idNow()] = String(v)),
      addValue: async (v) => void (d.values[idNow()] = (d.values[idNow()] ?? "") + String(v)),
      clearValue: async () => void (d.values[idNow()] = ""),
      getLocation: async () => {
        const r = spec()?.rect ?? DEFAULT_RECT;
        return { x: r.x, y: r.y };
      },
      getSize: async () => {
        const r = spec()?.rect ?? DEFAULT_RECT;
        return { width: r.width, height: r.height };
      },
      $$: async (sel) => (sel === ".//*" ? (spec()?.children ?? []).map(textEl) : []),
    };
  };

  Object.assign(d, {
    $: (sel) => element(() => match(sel)[0]),
    $$: async (sel) => match(sel).map((id) => element(id)),
    getPageSource: async () =>
      `<hierarchy>${Object.entries(state.screen)
        .map(([id, s]) => (ios ? `<XCUIElementTypeOther name="${P}${id}" label="${esc(s.desc ?? s.text ?? "")}"/>` : `<node resource-id="${P}${id}" text="${esc(s.text ?? "")}" content-desc="${esc(s.desc ?? "")}"/>`))
        .join("")}</hierarchy>`,
    saveScreenshot: async (file) => void d.shots.push(file),
    getWindowSize: async () => ({ width: 1080, height: 2400 }),
    getWindowRect: async () => ({ x: 0, y: 0, width: 1080, height: 2400 }),
    getElementRect: async () => ({ ...DEFAULT_RECT }),
    action: () => {
      const chain = {
        move: () => chain,
        down: () => chain,
        pause: () => chain,
        up: () => chain,
        perform: async () => {
          d.swipes++;
          await d.onSwipe?.(d);
          if (tick) setImmediate(() => tick(1000));
        },
      };
      return chain;
    },
    back: async () => {
      d.backs++;
      await d.onBack?.(d);
    },
    execute: async () => undefined,
    getClipboard: async () => Buffer.from(d.clipboard, "utf8").toString("base64"),
    setClipboard: async (b64) => void (d.clipboard = Buffer.from(b64, "base64").toString("utf8")),
    pressKeyCode: async () => undefined,
    activateApp: async () => undefined,
    terminateApp: async () => undefined,
    deleteSession: async () => undefined,
    acceptAlert: async () => {
      throw new Error("no alert");
    },
    getAlertText: async () => {
      throw new Error("no alert");
    },
  });
  return d;
}

/** A fake `adb` for the owner check: `prompt` says whether the credential window is up; calls are recorded. */
export function fakeAdb({ prompt = () => false } = {}) {
  const calls = [];
  const adb = (...a) => {
    calls.push(a.join(" "));
    if (a[1] === "dumpsys" && a[2] === "window") return prompt() ? "Window{abc u0 ConfirmDeviceCredentialActivity}" : "Window{def u0 com.ariesbifold/.MainActivity}";
    return "";
  };
  adb.calls = calls;
  return adb;
}
