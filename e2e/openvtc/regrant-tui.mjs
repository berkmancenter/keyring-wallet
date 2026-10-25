// Scratch (not committed): with the TUI open and its vetter persona listening, have the community
// re-send the vetter grant, then say whether the desk now shows a seat.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchListening } from './tuiListeners.js';
import * as tuiRoles from './tuiRoles.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(here, '../../tsp-reference/ref-20-local-vetting/vtc-admin.mjs');
const [bin, version, dir, profile, persona, rest, community, cred, verb = 'vetter-resend'] = process.argv.slice(2);
const utc = () => new Date().toISOString();
const log = (m) => console.log(`[regrant-tui] ${utc()} ${m}`);
const steps = path.join(dir, 'runs', `regrant-${Date.now()}.steps.jsonl`);
const launches = [];
const tui = await launchListening(() => tuiRoles.launch({ bin, version, dir, profile, log: steps }), { debugLog: path.join(dir, `debug-${profile}.log`), persona, record: (r) => launches.push(r) });
let seated = false;
try {
  log(`TUI listening (${launches.length} launch(es)); sending ${verb}`);
  const out = execFileSync('node', [ADMIN, rest, community, cred, verb, persona], { encoding: 'utf8' });
  log(`${verb}: ${out.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`);
  await new Promise((r) => setTimeout(r, 45000));
  try { await tuiRoles.openDesk(tui); seated = true; } catch (e) { log(`desk: ${e.message.split('\n')[0]}`); }
  log(seated ? 'SEATED: the desk shows a vetter seat' : 'NOT SEATED');
} finally { await tui.stop(); }
process.exitCode = seated ? 0 : 3;
