#!/usr/bin/env node
// Set up the openvtc TUI fixture from scratch, through the TUI's own setup
// wizard, as a maintainer does (e2e/openvtc/TUI_MAP.md, "Setup"). Run once per
// openvtc version bump; gates reuse the fixture.
//
//   node e2e/openvtc/setup-fixture.mjs --bin <openvtc> --version <sha> \
//     --slug farm-runner-prague --vta-did <did:webvh:…> --profile <name> --dir <config dir>
//
// Writes, on the agent: a trust context (--context, default "openvtc") whose
// admin and persona holder is the TUI's key. On this Mac: <dir>/config-<profile>.json,
// <dir>/unlock-code (mode 600) and the TUI's secrets in the login Keychain
// (service "openvtc", account = profile). Removal: scripts/openvtc/farm-test-resources.md.
//
// The same script sets up a 177a218 (our pin) fixture: the setup wizard's pages
// (ui/pages/setup_flow/*) and state_handler/setup_wizard.rs are unchanged from
// 177a218 to ed13d29 apart from DID shortening on the context-occupied and
// recover pages, so every string and key below holds at both (read from source
// 2026-09-25). The config format is the same too (openvtc-core
// config/public_config.rs unchanged), but give each build its own --profile
// anyway: a 177a218 save drops the fields only ed13d29 knows.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { OpenvtcTui } from '../lib/openvtcTui.js';

const { values: a } = parseArgs({
  options: {
    bin: { type: 'string' },
    version: { type: 'string' },
    slug: { type: 'string' },
    'vta-did': { type: 'string' },
    profile: { type: 'string' },
    dir: { type: 'string' },
    context: { type: 'string', default: 'openvtc' },
    log: { type: 'string' },
  },
});
for (const k of ['bin', 'version', 'slug', 'vta-did', 'profile', 'dir']) if (!a[k]) throw new Error(`--${k} is required`);
// Runner agents only: the Farm runners, or the lab's runner bob. Never alice, a person's own agent.
if (!/^(farm-runner-(prague|openvtc)|bob)$/.test(a.slug)) throw new Error(`refusing slug ${a.slug}: the fixture lives on a runner agent (farm-runner-openvtc, farm-runner-prague, or the lab's bob) only`);
if (existsSync(path.join(a.dir, `config-${a.profile}.json`))) throw new Error(`a fixture already exists at ${a.dir} for ${a.profile}; remove it first (farm-test-resources.md)`);
mkdirSync(a.dir, { recursive: true });

const PNM_LOCKED = fileURLToPath(new URL('../../scripts/openvtc/pnm-locked', import.meta.url));
const unlock = randomBytes(18).toString('base64url');
const unlockFile = path.join(a.dir, 'unlock-code');
writeFileSync(unlockFile, unlock + '\n', { mode: 0o600 });

const tui = new OpenvtcTui({
  bin: a.bin,
  version: a.version,
  configDir: a.dir,
  profile: a.profile,
  role: 'openvtc-setup',
  log: a.log,
  env: { OPENVTC_THEME: 'dark', OPENVTC_DEBUG_LOG: path.join(a.dir, `debug-${a.profile}.log`) },
}).start(['setup']);

const say = (m) => console.log(`[setup ${a.version}] ${m}`);
try {
  await tui.waitFor(' New profile setup ', { step: 'setup.start', source: 'ui/pages/setup_flow/start_ask.rs:106' });
  tui.press('Enter');
  await tui.waitFor("Enter the VTA's DID:", { step: 'setup.vtaDid', source: 'ui/pages/setup_flow/vta_enter_did.rs:103' });
  tui.type(a['vta-did']).press('Enter');
  await tui.waitFor(' Authorise the setup DID via PNM ', {
    timeoutMs: 60000,
    step: 'setup.aclInstructions',
    source: 'ui/pages/setup_flow/vta_acl_instructions.rs:118',
  });
  // The minted setup DID is shown inside the command the page prints
  // (vta_acl_instructions.rs:258-263), not as a separate line.
  const minted = await tui.waitFor(/--admin-did (did:key:[A-Za-z0-9]+)/, { step: 'setup.setupDid', source: 'ui/pages/setup_flow/vta_acl_instructions.rs:258-263' });
  const setupDid = minted[1];
  say(`setup DID ${setupDid}`);
  // The page's context-id field (pre-filled "openvtc") is what the TUI
  // provisions; the pnm grant below must name the same context, or the TUI is
  // refused "no access to context" (vta_acl_instructions.rs:82-94). Typed keys
  // go to the field; the printed command follows it.
  if (a.context !== 'openvtc') {
    await tui.pressEach(Array(12).fill('Backspace'), 60);
    await tui.pressEach([...a.context], 60);
    await tui.waitFor(`--id ${a.context}`, { step: 'setup.contextId', source: 'ui/pages/setup_flow/vta_acl_instructions.rs:129,261' });
  }
  // The command the TUI prints (vta_acl_instructions.rs:258-263), run through the per-slug lock.
  const out = execFileSync(
    PNM_LOCKED,
    ['--vta', a.slug, 'contexts', 'create', '--id', a.context, '--name', 'OpenVTC', '--admin-did', setupDid, '--admin-expires', '1h', '--admin-holder'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 360000 }
  );
  say(`pnm contexts create: ${out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-3).join(' | ')}`);
  // The TUI's own retry: a first attempt can fail before the agent has accepted
  // the setup key's TSP relationship (measured on the lab, VTA 0.42.0,
  // 2026-09-25: failed at 08:34:57, the agent accepted at 08:34:58). The ACL
  // entry is good for an hour, so return to the instructions and provision again.
  let provisioned;
  for (let attempt = 1; attempt <= 3; attempt++) {
    tui.press('Enter');
    provisioned = await tui.waitFor(/Bootstrap complete|This Trust Context is already in use|return to the ACL instructions/, {
      timeoutMs: 120000,
      step: `setup.provision.${attempt}`,
      source: 'ui/pages/setup_flow/vta_provisioning.rs:179',
    });
    if (!String(provisioned[0]).startsWith('return to the ACL')) break;
    say(`provisioning attempt ${attempt} failed: ${tui.screen().split('\n').map((l) => l.trim()).filter((l) => /fail|error|denied|timed out|could not/i.test(l)).slice(0, 3).join(' | ')}`);
    tui.press('Enter');
    await tui.waitFor(' Authorise the setup DID via PNM ', { step: `setup.retry.${attempt}`, timeoutMs: 30000 });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!String(provisioned[0]).startsWith('Bootstrap complete')) throw new Error(`provisioning: ${provisioned[0]}`);
  tui.press('Enter');
  const next = await tui.waitFor(/Set up hardware token|Set up unlock code/, { step: 'setup.afterProvision' });
  if (String(next[0]).includes('hardware token')) {
    tui.press('s');
    await tui.waitFor('Set up unlock code', { step: 'setup.unlockAsk', source: 'ui/pages/setup_flow/unlock_code_ask.rs' });
  }
  // "Yes, require unlock code (recommended)" is the first choice.
  tui.press('Enter');
  await tui.waitFor('Create a strong unlock code:', { step: 'setup.unlockSet', source: 'ui/pages/setup_flow/unlock_code_set.rs:159' });
  tui.type(unlock).press('Tab').type(unlock).press('Enter');
  await tui.waitFor(/Account setup completed successfully\.|Couldn't create OpenVTC account/, {
    timeoutMs: 120000,
    step: 'setup.final',
    source: 'state_handler/setup_wizard.rs:150-166',
  });
  if (tui.screen().includes("Couldn't create OpenVTC account")) throw new Error('account creation failed');
  tui.press('Enter');
  say('done');
  console.log(tui.screen().split('\n').filter((l) => l.trim()).slice(0, 12).join('\n'));
} catch (e) {
  console.error(String(e.message ?? e));
  process.exitCode = 1;
} finally {
  await tui.stop();
}
