#!/usr/bin/env node
/**
 * Your agent's header and chips, measured (bifold #329 Join menu width, #330 header corners, #331 agent chips).
 * On an installed, linked app, driven as it is: unlock, My Agent, then
 *   header-corners    236: the Join button (AgentJoinCorner) and the gear (AgentSettings) inside the window, apart;
 *                     237 (bifold #337, no header Join): the gear inside the window
 *   join-menu-fits    236: the Join menu opens wholly inside the window. 237: join-way-in instead, Join's way in
 *                     (AgentJoinCommunity before joining, AgentJoinAnother after) on the page and inside the window
 *   chip-row-fits     the chip row (AgentChips) and its Add chip (AgentSwitcherAdd) inside the window
 *   chip-strip-edges  #332: the chip strip runs edge to edge (within 4 px of both sides)
 *   home-sections     #333: sections separated (AgentSectionRule), Requests below the ways in; the intro centred
 *                     when it shows (AgentIntro)
 *   add-then-back     #335: Add on the chips, then back, returns to the same agent with no unlinked screen
 *   settings-section-rules  #341: Agent settings sets Activity, Details and Unlink apart with a rule
 * with a screenshot at each into E2E_RUN_DIR (or artifacts/). Rows through lib/rows.js, each suffixed
 * -<platform>; a row for a feature this build lacks (its key not in the bundle: AgentChips, AgentSwitcherAdd,
 * AgentSectionRule) is SKIPped as "build lacks <id>". Exit 0 all pass or skipped, 3 any fail, 1 the run broke.
 *
 *   PLATFORM=ios|android UDID=<sim udid or emulator serial> [APPIUM_PORT=…] node run-agent-header.mjs
 */
import "./lib/cli-guard.js";
import { byTestId, ensureAppium, existsTestId, screenshot, scrollToTestId, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { buildLacks } from "./lib/buildHas.js";
import { createRows } from "./lib/rows.js";

const PLATFORM = process.env.PLATFORM ?? "android";
const rows = createRows({ label: "agent-header" });
const row = (name, ok, detail, opts) => rows.row(`${name}-${PLATFORM}`, () => ({ ok, detail }), opts);
const BUILD = { platform: PLATFORM };
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
  rows.setDriver(d);
  await unlockToHome(d);
  await tapTestId(d, "MyAgent", 15000);
  await existsTestId(d, "AgentHome", 15000);
  const { width: W } = await d.getWindowSize();

  const join = await rectOf(d, "AgentJoinCorner");
  const gear = await rectOf(d, "AgentSettings");
  const apart = join && gear && (join.x + join.w <= gear.x || gear.x + gear.w <= join.x);
  await screenshot(d, `agent-header-${PLATFORM}`).catch(() => undefined);
  if (join) await row("header-corners", inside(join, W) && inside(gear, W) && Boolean(apart), `window ${W} wide · Join ${show(join)} · gear ${show(gear)}`);
  else await row("header-corners", inside(gear, W), `window ${W} wide · gear ${show(gear)} (no header Join: bifold #337)`);

  const chips = await rectOf(d, "AgentChips");
  const add = await rectOf(d, "AgentSwitcherAdd");
  await row("chip-row-fits", inside(chips, W) && inside(add, W), `chips ${show(chips)} · Add ${show(add)}`, { skip: buildLacks("AgentChips", BUILD) });

  // #332: edge to edge, not inset like the cards.
  await row("chip-strip-edges", Boolean(chips) && chips.x <= 4 && chips.x + chips.w >= W - 4, `chips ${show(chips)} · window ${W}`, { skip: buildLacks("AgentChips", BUILD) });

  // #333: sections, Requests below the ways in, the intro centred (only a phone with no agent shows the intro).
  const page = await d.getPageSource();
  const rules = (page.match(/AgentSectionRule/g) || []).length;
  const ways = (await rectOf(d, "AgentJoinCommunity")) || (await rectOf(d, "AgentDoors"));
  const reqs = await rectOf(d, "AgentRequestsRow");
  const intro = await rectOf(d, "AgentIntro");
  const centred = !intro || Math.abs(intro.x + intro.w / 2 - W / 2) <= 8;
  const order = !ways || !reqs || reqs.y > ways.y;
  await screenshot(d, `agent-home-sections-${PLATFORM}`).catch(() => undefined);
  await row("home-sections", rules > 0 && order && centred, `${rules} section rule(s) · ways ${show(ways)} · Requests ${show(reqs)} · intro ${intro ? show(intro) : "not shown"}`, { skip: buildLacks("AgentSectionRule", BUILD) });

  if (join) {
    await tapTestId(d, "AgentJoinCorner", 10000);
    const shown = await existsTestId(d, "AgentJoinMenu", 8000);
    const menu = shown ? await rectOf(d, "AgentJoinMenu") : undefined;
    const item = await rectOf(d, "AgentJoinMenuJoin");
    await screenshot(d, `agent-join-menu-${PLATFORM}`).catch(() => undefined);
    await row("join-menu-fits", inside(menu, W) && inside(item, W), `menu ${show(menu)} · Join item ${show(item)} · window ${W}`);
    if (await existsTestId(d, "AgentJoinMenuClose", 2000)) await tapTestId(d, "AgentJoinMenuClose", 5000).catch(() => undefined);
  } else {
    // 237: Join's way in is on the page: the doors before joining, "Join another community" after.
    const way = (await rectOf(d, "AgentJoinCommunity")) || (await scrollToTestId(d, "AgentJoinAnother", 6).then(() => rectOf(d, "AgentJoinAnother"), () => undefined));
    await screenshot(d, `agent-join-way-${PLATFORM}`).catch(() => undefined);
    await row("join-way-in", inside(way, W), `Join's way in ${show(way)} · window ${W}`);
  }

  // #335: Add, then back: the same agent's home, no "Link your agent" / unlinked screen.
  const before = (await textOf(d, "AgentHomeName").catch(() => "")).trim();
  if (await existsTestId(d, "AgentSwitcherAdd", 5000)) {
    await tapTestId(d, "AgentSwitcherAdd", 10000);
    await new Promise((r) => setTimeout(r, 2500));
    // iOS: the link screen's header is no UINavigationBar, so XCUITest's back() finds nothing; tap its "Back".
    const back = d.$("~Back");
    if (PLATFORM === "ios" && (await back.isExisting().catch(() => false))) await back.click();
    else await d.back().catch(() => undefined);
    // What Your agent shows right after Back, and 3 s later (while it reconnects to the previous agent).
    await screenshot(d, `agent-add-back-0s-${PLATFORM}`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 3000));
    await screenshot(d, `agent-add-back-3s-${PLATFORM}`).catch(() => undefined);
    // 238 (#342): adding shows a blank AgentHomeLeaving, not "Link your agent", while it leaves: wait it out.
    for (let i = 0; i < 15 && (await existsTestId(d, "AgentHomeLeaving", 500)); i++) await new Promise((r) => setTimeout(r, 1000));
    const home = await existsTestId(d, "AgentHome", 10000);
    const after = home ? (await textOf(d, "AgentHomeName").catch(() => "")).trim() : "";
    const unlinked = /Link your agent|no longer linked|Add this phone/i.test(await d.getPageSource());
    await screenshot(d, `agent-add-then-back-${PLATFORM}`).catch(() => undefined);
    await row("add-then-back", home && after === before && !unlinked, `before "${before}", after "${after}"${unlinked ? ", an unlinked/link screen showed" : ""}`);
  } else await row("add-then-back", false, "no AgentSwitcherAdd", { skip: buildLacks("AgentSwitcherAdd", BUILD) });
  // #341: Agent settings sets its sections apart as Your agent does: a rule just above Activity, Details and Unlink.
  if (await existsTestId(d, "AgentSettings", 5000)) {
    await tapTestId(d, "AgentSettings", 10000);
    const found = [];
    for (const id of ["AgentActivity", "AgentDetailsToggle", "AgentUnlink"]) {
      const el = await scrollToTestId(d, id, 6, { from: 0.6 }).catch(() => undefined);
      if (!el) { found.push(`${id} absent`); continue; }
      const y = Math.round((await el.getLocation()).y);
      let ruled = false;
      for (const r of await d.$$(PLATFORM === "ios" ? '//*[@name="com.ariesbifold:id/AgentSectionRule"]' : '//*[@resource-id="com.ariesbifold:id/AgentSectionRule"]')) {
        const ry = Math.round((await r.getLocation().catch(() => ({ y: -1 }))).y);
        if (ry >= 0 && ry < y && y - ry <= 160) ruled = true;
      }
      found.push(`${id} ${ruled ? "ruled" : "NO RULE above"}`);
    }
    await screenshot(d, `agent-settings-sections-${PLATFORM}`).catch(() => undefined);
    await row("settings-section-rules", found.every((f) => f.endsWith("ruled")), found.join(" · "), { skip: buildLacks("AgentSectionRule", BUILD) });
  } else await row("settings-section-rules", false, "no AgentSettings gear", { skip: buildLacks("AgentSectionRule", BUILD) });
} catch (e) {
  rows.fatal(e);
  if (d) await screenshot(d, `agent-header-failure-${PLATFORM}`).catch(() => undefined);
} finally {
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
