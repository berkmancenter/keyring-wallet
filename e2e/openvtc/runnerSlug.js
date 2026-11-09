// The agents an openvtc fixture may live on: the Farm runners, or the lab's runner bob, never a person's own agent
// (alice, alberto3, …). The Mac mini knows the same runners by its own pnm identity's slug, keyring-mini-gate-<runner>
// (its file store), so that prefix is accepted on the same runners and nowhere else.
export const RUNNER_SLUG = /^(keyring-mini-gate-)?(farm\d*-runner-(prague|openvtc)|bob)$/;
export const isRunnerSlug = (slug) => RUNNER_SLUG.test(String(slug ?? ''));
