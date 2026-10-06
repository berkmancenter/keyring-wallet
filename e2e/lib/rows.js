/**
 * A leg's rows, the way the gate runner reads them: each row passes, fails or
 * is skipped, and a failing row never stops the rows after it.
 *
 * Lines a leg prints (the runner parses only these, and the exit code):
 *
 *   HEADS <label> wallet=<sha8> bifold=<sha8> build=<sha12> harness=<sha8>
 *   ROW <name> PASS — <detail>
 *   ROW <name> FAIL — <detail>
 *   ROW <name> SKIP — <reason>
 *   LEG <label> BROKEN — <first line>        (the leg broke outside a row)
 *   LEG <label> DONE <exit> pass=<n> fail=<n> skip=<n> <seconds>s
 *
 * Exit codes: 0 every row passed or was skipped as asked; 3 a row failed; 1 the
 * leg broke outside its rows (setup, link, a crash), which the runner reruns
 * whole rather than row by row.
 *
 * Row names must be stable across runs — no times or DIDs in a name, only in
 * the detail — because `E2E_ONLY_ROWS` (the runner's --only-failed) selects
 * rows by exact name.
 *
 *   const rows = createRows({ label: "approvals", driver: d });
 *   rows.heads({ wallet, bifold, build, harness });
 *   await rows.row("rule shows as this phone's own", async () => ({ ok: on, detail: `switch ${on}` }));
 *   await rows.row("test request held", check, { needs: ["rule shows as this phone's own"] });
 *   try { … } catch (err) { rows.fatal(err) } finally { rows.summary(); process.exitCode = rows.exitCode(); }
 */
import { runPath } from "./runDir.js";

export const EXIT_PASS = 0;
export const EXIT_ROW_FAILED = 3;
export const EXIT_BROKEN = 1;

const firstLine = (err) => String(err?.message ?? err).split("\n")[0].slice(0, 300);
const slugOf = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/** The rows `E2E_ONLY_ROWS` selects (comma-separated exact names), or undefined for all of them. */
export function selectedRows(env = process.env) {
  const raw = env.E2E_ONLY_ROWS?.trim();
  if (!raw) return undefined;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * `driver`, when given (or set later with `setDriver`), is used for a failing
 * row's screenshot and page source, best effort. `log`, `now`, `only` and
 * `capture` are for tests.
 */
export function createRows({
  label,
  driver,
  log = console.log,
  now = Date.now,
  only = selectedRows(),
  capture = captureFailure,
} = {}) {
  if (!label) throw new Error("createRows: no label (the leg's name)");
  const started = now();
  const results = new Map();
  let broken = false;
  let current = driver;

  const record = (name, outcome, detail) => {
    results.set(name, outcome);
    log(`ROW ${name} ${outcome} — ${detail}`);
  };

  return {
    setDriver(d) {
      current = d;
    },

    /** The heads this leg runs on; pass what the driver knows. */
    heads({ wallet = "?", bifold = "?", build = "?", harness = "?" } = {}) {
      log(
        `HEADS ${label} wallet=${String(wallet).slice(0, 8)} bifold=${String(bifold).slice(0, 8)} build=${String(build).slice(0, 12)} harness=${String(harness).slice(0, 8)}`
      );
    },

    /**
     * Run one row. `fn` passes by returning true (or nothing), fails by
     * returning false or `{ ok: false }`, or by throwing; `{ ok, detail }` says
     * what was seen. It is skipped, without running, when E2E_ONLY_ROWS does not
     * name it, or when a row it `needs` did not pass. Never throws.
     */
    async row(name, fn, { needs = [] } = {}) {
      if (only && !only.has(name)) return record(name, "SKIP", "not selected"), "SKIP";
      const blocked = needs.find((need) => results.get(need) !== "PASS");
      if (blocked !== undefined) {
        const was = results.get(blocked);
        return record(name, "SKIP", `needs "${blocked}", which ${was ? `was ${was}` : "did not run"}`), "SKIP";
      }
      let ok;
      let detail;
      try {
        const got = await fn();
        if (got === undefined || got === true) ok = true;
        else if (got === false) ok = false;
        else {
          ok = got.ok !== false;
          detail = got.detail;
        }
      } catch (err) {
        ok = false;
        detail = `threw: ${firstLine(err)}`;
      }
      if (!ok && current) await capture(current, `row-${slugOf(name)}`).catch(() => undefined);
      record(name, ok ? "PASS" : "FAIL", detail ?? (ok ? "ok" : "failed"));
      return ok ? "PASS" : "FAIL";
    },

    /** Skip a row on purpose, saying why. */
    skip(name, reason) {
      record(name, "SKIP", reason);
    },

    /** The leg broke outside a row: the runner reruns it whole. */
    fatal(err) {
      broken = true;
      log(`LEG ${label} BROKEN — ${firstLine(err)}`);
    },

    exitCode() {
      if (broken) return EXIT_BROKEN;
      return [...results.values()].includes("FAIL") ? EXIT_ROW_FAILED : EXIT_PASS;
    },

    /** Print the leg's DONE line; returns the counts. */
    summary() {
      const count = (o) => [...results.values()].filter((v) => v === o).length;
      const out = { pass: count("PASS"), fail: count("FAIL"), skip: count("SKIP"), exit: this.exitCode() };
      const seconds = Math.round((now() - started) / 1000);
      log(`LEG ${label} DONE ${out.exit} pass=${out.pass} fail=${out.fail} skip=${out.skip} ${seconds}s`);
      return out;
    },
  };
}

/** A failing row's screenshot and page source, into the run's directory. */
export async function captureFailure(driver, label) {
  const tag = `${label}-${driver.e2ePlatform ?? "device"}-${Date.now()}`;
  await driver.saveScreenshot(runPath(`${tag}.png`)).catch(() => undefined);
  const source = await driver.getPageSource().catch(() => undefined);
  if (source) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(runPath(`${tag}.xml`), source);
  }
}
