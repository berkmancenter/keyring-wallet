// The hv leg's application verdict, read from the applicant's logcat (run-hv.mjs; pure, so it is tested).

/** The application verdict from logcat, as the 257 check read it: created, refused (with the app's error), or not attempted. */
export function applicationVerdict(log) {
  const lines = log.split('\n');
  const asked = lines.findIndex((l) => /\[TrustTasks:VtaClient\] asked its agent \S*\/vta\/pcs\/applications\/create\/0\.1/.test(l));
  const verified = lines.findIndex((l, i) => i > asked && /\[TrustTasks:VtaClient\] reply verified: \S*\/vta\/pcs\/applications\/create\/0\.1/.test(l));
  const refused = log.match(/\[hidden-vetting\] no agent-side application for [^:]+: ([^\n]+)/);
  if (refused) return { status: 'FAIL', detail: `no agent-side application: ${refused[1].trim()}` };
  if (asked >= 0 && verified > asked) return { status: 'PASS', detail: 'applications/create asked of its own agent, reply verified' };
  if (asked >= 0) return { status: 'FAIL', detail: 'applications/create asked, no verified reply' };
  return { status: 'FAIL', detail: 'no applications/create and no [hidden-vetting] failure: the private way was not recognised (requirements digest?)' };
}

/** The clock time on a log line, as seconds into the day (Android "10-15 18:15:40.635", iOS "2026-10-16 23:01:18.514"). */
export function lineSeconds(line) {
  const m = String(line).match(/\b(\d{2}):(\d{2}):(\d{2})\.(\d{1,6})\b/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`) : undefined;
}

/**
 * One Trust Task round the app's agent client logged: `asked … <task>` then `reply verified: <task>`, or the client's
 * no-answer line. Value: { asked, verified, seconds, noAnswer } (seconds from ask to verified reply, by the lines' clock).
 */
export function taskRound(log, taskPath) {
  const lines = String(log).split('\n');
  const esc = taskPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const ai = lines.findIndex((l) => new RegExp(`\\[TrustTasks:VtaClient\\] asked .*${esc}`).test(l));
  const vi = lines.findIndex((l, i) => i > ai && new RegExp(`\\[TrustTasks:VtaClient\\] reply verified: \\S*${esc}`).test(l));
  const na = lines.find((l) => new RegExp(`no answer to \\S*${esc}`).test(l));
  const t0 = ai >= 0 ? lineSeconds(lines[ai]) : undefined;
  const t1 = vi >= 0 ? lineSeconds(lines[vi]) : undefined;
  const seconds = t0 !== undefined && t1 !== undefined ? Math.round(((t1 - t0 + 86400) % 86400) * 10) / 10 : undefined;
  return { asked: ai >= 0, verified: ai >= 0 && vi > ai, seconds, noAnswer: na ? na.replace(/^.*?(\[|no answer)/, '$1').trim() : undefined };
}

/**
 * Where a vetter's DID would be a leak on the applicant's side: the app's own JS lines, without Credo's transport
 * lines. The applicant holds a session with its vetter by design, so resolving the vetter's DID document to reach it
 * (`resolving didUrl`, `Found did`, a TSP capability probe, outbound routing) says nothing about the attestation
 * (hv-keyring on 262: all ten mentions were those, the last as the attestation's envelope arrived).
 */
const TRANSPORT = /resolving didUrl|Found did '|\[TrustTasks:TspCapability\]|Resolving services for connection|Sending outbound message|Unpacked DIDComm|Payload received from mediator/;
export function appLevelLines(log) {
  return String(log)
    .split('\n')
    .filter((l) => l.includes('com.facebook.react.log') && !TRANSPORT.test(l))
    .join('\n');
}

/** A page source without the applicant's own request and session card, which names the vetter they met by design. */
export function withoutOwnRequestCard(pageSource) {
  return String(pageSource)
    .split('\n')
    .filter((l) => !/name="com\.ariesbifold:id\/Vetting(Request|Session)/.test(l))
    .join('\n');
}
