// Drive the real openvtc TUI binary over a pseudo-terminal, as a maintainer
// drives it: read the screen, send keys. The openvtc interop harness
// (docs/plans/openvtc-interop-harness-plan.md §3) asserts on the TUI's own
// strings, each cited by file:line in the step that waits for it, and never
// sleeps to guess: a step waits for a line on the screen, or fails with the
// screen attached.
//
// One process per role. Each run gets its own config directory
// (OPENVTC_CONFIG_PATH) and profile, so a run never touches a maintainer's
// ~/.config/openvtc.

import { appendFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import pty from 'node-pty';
import xterm from '@xterm/headless';

const require = createRequire(import.meta.url);

// npm drops the execute bit on node-pty's prebuilt spawn-helper, and every
// spawn then fails with "posix_spawnp failed". Restore it once, here.
(function fixSpawnHelper() {
  const prebuilds = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds');
  if (!existsSync(prebuilds)) return;
  for (const dir of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
})();

/** Key names to the bytes a terminal sends for them. */
export const KEYS = {
  Enter: '\r',
  Tab: '\t',
  BackTab: '\x1b[Z',
  Esc: '\x1b',
  Backspace: '\x7f',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Right: '\x1b[C',
  Left: '\x1b[D',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  Home: '\x1b[H',
  End: '\x1b[F',
  CtrlC: '\x03',
};

/**
 * The bytes for one key name, or one literal character. A multi-character
 * string that is not a key name is refused, not typed: "End" was once missing
 * here and went out as E, n, d, and `d` deletes a ticket (2026-09-25). Text is
 * sent with type().
 */
function keyBytes(k) {
  if (k in KEYS) return KEYS[k];
  if ([...k].length === 1) return k;
  throw new Error(`unknown key name ${JSON.stringify(k)} (add it to KEYS, or send text with type())`);
}

export class OpenvtcTui {
  /**
   * @param {object} o
   * @param {string} o.bin       the openvtc binary
   * @param {string} o.version   its commit, for every record (e.g. "ed13d29")
   * @param {string} o.configDir this run's OPENVTC_CONFIG_PATH
   * @param {string} o.profile   the profile name (-p)
   * @param {string} o.role      "openvtc-vetter" | "openvtc-applicant"
   * @param {string} [o.log]     the run's shared JSONL step log
   * @param {number} [o.cols]
   * @param {number} [o.rows]
   * @param {Record<string,string>} [o.env]
   */
  constructor({ bin, version, configDir, profile, role, log, cols = 160, rows = 50, env = {} }) {
    Object.assign(this, { bin, version, configDir, profile, role, log, cols, rows, env });
    this.term = new xterm.Terminal({ cols, rows, allowProposedApi: true });
    this.proc = undefined;
    this.exited = undefined;
  }

  /** Start the TUI (no args) or a subcommand such as ["setup"]. */
  start(args = []) {
    this.proc = pty.spawn(this.bin, ['-p', this.profile, ...args], {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.configDir,
      env: { ...process.env, TERM: 'xterm-256color', OPENVTC_CONFIG_PATH: this.configDir, ...this.env },
    });
    this.proc.onData((d) => this.term.write(d));
    // The terminal answers the program's queries (cursor position, device
    // attributes) through onData; a TUI that asks and hears nothing gives up
    // ("The cursor position could not be read").
    this.replies = this.term.onData((d) => this.proc?.write(d));
    this.proc.onExit((e) => {
      this.exited = e;
    });
    return this;
  }

  /** The screen as text, one line per row, trailing spaces trimmed. */
  screen() {
    const buf = this.term.buffer.active;
    const lines = [];
    for (let i = 0; i < this.rows; i++) lines.push((buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '').trimEnd());
    return lines.join('\n');
  }

  /**
   * Wait until the screen shows `pattern` (a string or RegExp). Returns the
   * match. On timeout, throws with the screen attached.
   * @param {string|RegExp} pattern
   * @param {{ timeoutMs?: number, source?: string, step?: string }} [o]
   */
  async waitFor(pattern, { timeoutMs = 30000, source, step } = {}) {
    const started = new Date();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await new Promise((r) => setImmediate(r)); // let xterm parse what arrived
      const screen = this.screen();
      const match = typeof pattern === 'string' ? (screen.includes(pattern) ? pattern : null) : screen.match(pattern);
      if (match) {
        const line = screen.split('\n').find((l) => (typeof pattern === 'string' ? l.includes(pattern) : pattern.test(l)));
        if (step) this.record(step, true, started, { tuiState: line?.trim(), tuiSource: source });
        return typeof match === 'string' ? match : match;
      }
      if (this.exited) throw this.failure(step, started, `the TUI exited (${JSON.stringify(this.exited)})`, source);
      if (Date.now() > deadline) throw this.failure(step, started, `no "${pattern}" within ${timeoutMs} ms`, source);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Send key names (KEYS) or literal text, in order, all at once. */
  press(...keys) {
    for (const k of keys) this.proc.write(keyBytes(k));
    return this;
  }

  /**
   * Send keys one at a time with a gap. The TUI drops key presses that arrive
   * faster than it redraws: five Down presses written together moved the menu
   * once (measured at ed13d29, 2026-09-25).
   */
  async pressEach(keys, gapMs = 250) {
    for (const k of keys) {
      this.proc.write(keyBytes(k));
      await new Promise((r) => setTimeout(r, gapMs));
    }
    return this;
  }

  /**
   * The selected item of the main menu. The TUI marks it only by colour: its
   * text is drawn in the accent colour while every other item uses the plain
   * one (measured at ed13d29: RGB 4054148 against palette 15). So the selected
   * row is the one menu row whose first letter's colour differs from the rest.
   */
  menuSelection() {
    const buf = this.term.buffer.active;
    const items = [];
    for (let y = 0; y < this.rows; y++) {
      const line = buf.getLine(buf.viewportY + y);
      const text = line?.translateToString(true).slice(0, 31) ?? '';
      const m = text.match(/^[║│]\* (.+?)\s*$/);
      if (!m) continue;
      const cell = line.getCell(text.indexOf(m[1]));
      items.push({ label: m[1], colour: `${cell.getFgColorMode()}:${cell.getFgColor()}` });
    }
    const counts = new Map();
    for (const it of items) counts.set(it.colour, (counts.get(it.colour) ?? 0) + 1);
    const odd = items.filter((it) => counts.get(it.colour) === 1);
    return odd.length === 1 ? odd[0].label : undefined;
  }

  /** Move the main menu to `label`, pressing Up/Down until it is the highlighted row. */
  async selectMenu(label, { maxSteps = 14 } = {}) {
    for (let i = 0; i <= maxSteps; i++) {
      if (this.menuSelection() === label) return this;
      await this.pressEach(['Down'], 300);
    }
    throw this.failure(`menu.${label}`, new Date(), `could not select "${label}" (selected: ${this.menuSelection()})`);
  }

  type(text) {
    this.proc.write(text);
    return this;
  }

  /** Append one record to the run's shared step log. */
  record(step, ok, startedAt, observed = {}, extra = {}) {
    if (!this.log) return;
    const rec = {
      role: this.role,
      step,
      ok,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      observed: { ...observed, openvtcVersion: this.version },
      ...extra,
    };
    appendFileSync(this.log, JSON.stringify(rec) + '\n', { flag: 'a' });
  }

  failure(step, startedAt, why, source) {
    const screen = this.screen();
    if (step) this.record(step, false, startedAt, { tuiSource: source }, { error: why, screen });
    const err = new Error(`[openvtc ${this.version} ${this.role}] ${step ?? ''}: ${why}\n--- screen ---\n${screen}`);
    err.screen = screen;
    return err;
  }

  async stop() {
    if (this.proc && !this.exited) {
      this.proc.kill();
      await new Promise((r) => setTimeout(r, 200));
    }
    this.replies?.dispose();
    this.term.dispose();
  }
}
