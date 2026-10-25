// The vetting seat's first step, waited for (UI smoothness: Vetting draws VettingSeatLoading until its reads finish).
// Dependency-free, so its test runs in CI; keyringRoles.awaitSeatStep wires it to a real session.

/**
 * Wait until the seat shows a step of `role`, whichever it is, and return it. Until the seat's reads finish (persona,
 * desk) it shows VettingSeatLoading, which is no step, so a probe made then reads "no Create identity" and a phone
 * with no identity never taps it. Logs how long it waited, so a run shows whether the wait ran at all.
 */
export async function awaitSeatStep({
  platform,
  role,
  stepOf,
  loadingShown,
  timeoutMs = 30000,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  const start = now();
  for (;;) {
    const step = await stepOf();
    if (step !== null && step !== undefined) {
      log(`[e2e] ${platform}: Vetting ${role} seat on "${step}" after ${now() - start} ms`);
      return step;
    }
    if (now() - start > timeoutMs) {
      const loading = await loadingShown().catch(() => false);
      throw new Error(
        `${platform}: Vetting showed no ${role} step after ${timeoutMs / 1000} s` +
          (loading ? " (still on VettingSeatLoading: its reads never finished)" : "")
      );
    }
    await wait(500);
  }
}
