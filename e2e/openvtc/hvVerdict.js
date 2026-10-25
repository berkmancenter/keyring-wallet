// The hv leg's application verdict, read from the applicant's logcat (run-hv.mjs; pure, so it is tested).

/**
 * The application verdict from logcat, as the 257 check read it: created, refused (with the app's error), or not
 * attempted. Only a TSP ask is logged (`asked … over rev3`, VtaClient's TSP branch); over DIDComm, the carriage every
 * agent call takes from 268 on (bifold #486/#487), the client logs no ask, only the verified reply. So a verified reply
 * with no ask line at all is the DIDComm round; with an ask line, the reply must come after it (1022-2230: created over
 * DIDComm, read as "not recognised" because the ask line never comes).
 */
export function applicationVerdict(log) {
  const lines = log.split('\n');
  const asked = lines.findIndex((l) => /\[TrustTasks:VtaClient\] asked its agent \S*\/vta\/pcs\/applications\/create\/0\.1/.test(l));
  const verified = lines.findIndex((l, i) => i > asked && /\[TrustTasks:VtaClient\] reply verified: \S*\/vta\/pcs\/applications\/create\/0\.1/.test(l));
  const refused = log.match(/\[hidden-vetting\] no agent-side application for [^:]+: ([^\n]+)/);
  if (refused) return { status: 'FAIL', detail: `no agent-side application: ${refused[1].trim()}` };
  if (asked >= 0 && verified > asked) return { status: 'PASS', detail: 'applications/create asked of its own agent, reply verified' };
  if (asked >= 0) return { status: 'FAIL', detail: 'applications/create asked, no verified reply' };
  if (verified >= 0) return { status: 'PASS', detail: 'applications/create answered by its own agent, reply verified (over DIDComm, which logs no ask line)' };
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
 * A DIDComm round logs no ask (see applicationVerdict): a verified reply with no ask line is verified, untimed.
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
  return { asked: ai >= 0, verified: vi >= 0, seconds, noAnswer: na ? na.replace(/^.*?(\[|no answer)/, '$1').trim() : undefined };
}

/**
 * Where a vetter's DID would be a leak on the applicant's side: the app's own JS lines, without Credo's transport
 * lines. The applicant holds a session with its vetter by design, so resolving the vetter's DID document to reach it
 * (`resolving didUrl`, `Found did`, a TSP capability probe, outbound routing) says nothing about the attestation
 * (hv-keyring on 262: all ten mentions were those, the last as the attestation's envelope arrived). The app's JS lines
 * are `com.facebook.react.log` on iOS (log show) and the `ReactNativeJS` tag on Android (logcat).
 */
const TRANSPORT = /resolving didUrl|Found did '|\[TrustTasks:TspCapability\]|Resolving services for connection|Sending outbound message|Unpacked DIDComm|Payload received from mediator/;
export function appLevelLines(log) {
  return String(log)
    .split('\n')
    .filter((l) => (l.includes('com.facebook.react.log') || l.includes('ReactNativeJS')) && !TRANSPORT.test(l))
    .join('\n');
}

/** A page source without the applicant's own request and session card, which names the vetter they met by design. */
export function withoutOwnRequestCard(pageSource) {
  return String(pageSource)
    .split('\n')
    .filter((l) => !/name="com\.ariesbifold:id\/Vetting(Request|Session)/.test(l))
    .join('\n');
}

/** The part of a did:webvh the app's log keeps when it shortens one ("did:webvh:QmZWDgXD…"): its first 8 SCID chars. */
export const didStub = (did) => (String(did ?? '').match(/^did:webvh:([A-Za-z0-9]{8})/) || [])[0] ?? String(did ?? '');

/**
 * hv-vetter-anonymous: the vetter's DID must appear neither where the applicant is shown things nor in the community's
 * record. Each source must first show it was read: the applicant side names the applicant's own persona (at least its
 * shortened form), the record names the member. An empty or unread source fails as such, never passes as "absent".
 */
export function anonymityVerdict({ vetterDid, memberDid, shown, record }) {
  if (!vetterDid) return { ok: false, detail: 'no vetter DID given to check against' };
  if (!memberDid) return { ok: false, detail: 'source empty: no member to read the record or the applicant side by' };
  const empty = [
    !String(shown ?? '').includes(didStub(memberDid)) && "the applicant side (its own persona not in it)",
    !String(record ?? '').includes(memberDid) && "the community's record (the member not in it)",
  ].filter(Boolean);
  if (empty.length) return { ok: false, detail: `source empty: ${empty.join(' and ')}` };
  const leaks = [String(shown).includes(vetterDid) && 'the applicant side', String(record).includes(vetterDid) && "the community's record"].filter(Boolean);
  return leaks.length
    ? { ok: false, detail: `the vetter's DID appears in ${leaks.join(' and ')}` }
    : { ok: true, detail: "the vetter's DID is in neither the applicant's screens and log nor the community's record (both read: each names the applicant)" };
}
