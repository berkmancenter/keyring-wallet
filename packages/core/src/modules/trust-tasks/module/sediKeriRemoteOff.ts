/**
 * One kill for every SEDI/KERI feature (trusted approvers, state-verified approvers, and the KERI holder to come):
 * a release sets it to turn all of them off for everyone, whatever any phone saved. Each feature also keeps its own
 * switch and its own remote off; this beats both (Alberto, 2026-11-10: one switch per feature, plus one umbrella kill).
 *
 * Read only inside each feature's `is…Enabled()`, never at module load, so a stub of this module cannot break a load.
 *
 * @module trust-tasks/module/sediKeriRemoteOff
 */

/** Set to true in a release to turn every SEDI/KERI feature off for everyone, whatever was saved. */
export const SEDI_KERI_REMOTE_OFF: { off: boolean } = { off: false }
