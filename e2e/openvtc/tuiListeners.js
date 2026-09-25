// Is the TUI actually listening? openvtc brings up one mediator listener per
// persona at launch, and a listener that fails to come up is logged and then
// skipped for the whole run: "listener failed to come up; continuing without
// it" (openvtc-core didcomm.rs), with no retry and nothing on screen. A vetter
// launched that way shows a normal desk and never hears a request.
//
// Measured 2026-09-25 08:47Z on the lab: a few seconds of failed requests
// through the tunnels made the vetter persona's login miss openvtc's 10 s
// budget by 0.8 s; the request sat queued at the mediator while the run waited
// three minutes for it.

import { readFileSync } from 'node:fs';

function readLog(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * After a launch that began at `since` (ISO), wait for openvtc's "DIDComm
 * listeners registered count=N" line and return { registered, failed }, where
 * failed lists the listener prefixes that did not come up. Throws when the
 * registration line never appears.
 */
export async function listenerReport(debugLog, since, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lines = readLog(debugLog)
      .split('\n')
      .filter((l) => l.slice(0, 27) >= since);
    const done = lines.find((l) => /DIDComm listeners registered count=\d+/.test(l));
    if (done) {
      const failed = lines
        .filter((l) => l.includes('listener failed to come up'))
        .map((l) => (l.match(/listener=(\S+)/) ?? [])[1] ?? 'unknown');
      return { registered: Number(done.match(/count=(\d+)/)[1]), failed };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`openvtc never logged "DIDComm listeners registered" within ${timeoutMs} ms of launch`);
}

/**
 * Launch the TUI (via `launchFn`) until every persona listener is up, at most
 * `attempts` times; a launch with a failed listener is stopped and retried.
 * `persona` (a DID) must be among the listeners that came up.
 */
export async function launchListening(launchFn, { debugLog, persona, attempts = 3, record }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const since = new Date().toISOString();
    const tui = await launchFn();
    const report = await listenerReport(debugLog, since);
    // Without a named persona, any failed listener counts.
    const personaDown = persona
      ? report.failed.some((f) => persona.startsWith(f.replace(/\.\.\.$/, '')))
      : report.failed.length > 0;
    record?.({ attempt, ...report, personaDown });
    if (!personaDown) return tui;
    await tui.stop();
    if (attempt === attempts) {
      throw new Error(`the TUI's listener for ${persona ?? 'a persona'} failed to come up on ${attempts} launches (${report.failed.join(', ')})`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/**
 * Wait until openvtc logs that it installed a listener for `did` after `since`
 * (a persona minted during the run starts its listener then, not at launch;
 * a profile with no personas logs no listener lines at all at launch).
 */
export async function awaitListener(debugLog, did, since, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = readLog(debugLog)
      .split('\n')
      .find((l) => l.slice(0, 27) >= since && l.includes('listener installed on the delivery layer') && l.includes(`listener=${did}`));
    if (hit) return hit.slice(0, 27);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no listener for ${did} came up within ${timeoutMs} ms`);
}
