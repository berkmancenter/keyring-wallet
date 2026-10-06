#!/usr/bin/env node
/**
 * Your agent's header and chips, measured (bifold #329 Join menu width, #330 header corners, #331 agent chips).
 * On an installed, linked app, driven as it is: unlock, My Agent, then
 *   header-corners    the Join button (AgentJoinCorner) and the gear (AgentSettings) both inside the window,
 *                     apart from each other
 *   join-menu-fits    the Join menu (AgentJoinMenu) opens wholly inside the window, its Join item shown
 *   chip-row-fits     the chip row (AgentChips) and its Add chip (AgentSwitcherAdd) inside the window
 * with a screenshot at each into E2E_RUN_DIR (or artifacts/). Prints ROW lines; exit 0 all pass, 3 any fail.
 *
 *   PLATFORM=ios|android UDID=<sim udid or emulator serial> [APPIUM_PORT=…] node run-agent-header.mjs
 */
import "./lib/cli-guard.js";
import { byTestId, ensureAppium, existsTestId, screenshot, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";

const PLATFORM = process.env.PLATFORM ?? "android";
let failed = 0;
const row = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`ROW ${name}-${PLATFORM} ${ok ? "PASS" : "FAIL"} — ${detail}`);
};
const rectOf = async (d, id) => {
  const el = byTestId(d, id);
  if (!(await el.isExisting().catch(() => false))) return undefined;
  const { x, y } = await el.getLocation();
  const { width, height } = await el.getSize();
  return { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) };
};
const inside = (r, W) => Boolean(r) && r.x >= 0 && r.x + r.w <= W && r.w > 0;
const show = (r) => (r ? `[${r.x},${r.y} ${r.w}×${r.h}]` : "absent");

let d;
try {
  if (!process.env.UDID) throw new Error("UDID is required");
  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: true });
  await unlockToHome(d);
  await tapTestId(d, "MyAgent", 15000);
  await existsTestId(d, "AgentHome", 15000);
  const { width: W } = await d.getWindowSize();

  const join = await rectOf(d, "AgentJoinCorner");
  const gear = await rectOf(d, "AgentSettings");
  const apart = join && gear && (join.x + join.w <= gear.x || gear.x + gear.w <= join.x);
  await screenshot(d, `agent-header-${PLATFORM}`).catch(() => undefined);
  row("header-corners", inside(join, W) && inside(gear, W) && Boolean(apart), `window ${W} wide · Join ${show(join)} · gear ${show(gear)}`);

  const chips = await rectOf(d, "AgentChips");
  const add = await rectOf(d, "AgentSwitcherAdd");
  row("chip-row-fits", inside(chips, W) && inside(add, W), `chips ${show(chips)} · Add ${show(add)}`);

  if (join) {
    await tapTestId(d, "AgentJoinCorner", 10000);
    const shown = await existsTestId(d, "AgentJoinMenu", 8000);
    const menu = shown ? await rectOf(d, "AgentJoinMenu") : undefined;
    const item = await rectOf(d, "AgentJoinMenuJoin");
    await screenshot(d, `agent-join-menu-${PLATFORM}`).catch(() => undefined);
    row("join-menu-fits", inside(menu, W) && inside(item, W), `menu ${show(menu)} · Join item ${show(item)} · window ${W}`);
    if (await existsTestId(d, "AgentJoinMenuClose", 2000)) await tapTestId(d, "AgentJoinMenuClose", 5000).catch(() => undefined);
  } else row("join-menu-fits", false, "no AgentJoinCorner to open it from");
  process.exitCode = failed ? 3 : 0;
} catch (e) {
  console.log(`LEG agent-header BROKEN — ${String(e.message).split("\n")[0]}`);
  if (d) await screenshot(d, `agent-header-failure-${PLATFORM}`).catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
