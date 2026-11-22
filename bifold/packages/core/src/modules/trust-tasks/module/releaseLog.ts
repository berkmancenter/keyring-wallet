/**
 * A line a Release build keeps: `console.warn` reaches the device log
 * (logcat, the simulator's) in Release, whatever the agent's logger is set to
 * and whether or not an agent exists yet. For the few steps whose silence has
 * cost a release: the persona inbox not opening, a mediator never resolved
 * (227 gate, Farm: the invitation push never reached the phone, and nothing
 * in the log said where it stopped). Identifiers as prefixes only: these
 * lines reach testers' problem reports.
 *
 * @module trust-tasks/module/releaseLog
 */
export function releaseWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(message)
}
