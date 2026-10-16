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
