/**
 * Whether a runner may change a community's admission criteria.
 *
 * Communities have FIXED criteria (agreed 2026-09-23, now that each harness
 * session runs in parallel against the same Farm communities): a run that
 * flipped them — invitation-only for the invite runner, vetting-only for the
 * vetting runner — changed what every other session's run meant while it ran,
 * and a run that died left the change behind. So by default a runner leaves the
 * criteria as they are, and a scenario that genuinely needs a different set
 * runs against a community that already has it.
 *
 *   E2E_CRITERIA=fixed   (default) never change them
 *   E2E_CRITERIA=flip    the old behaviour, by explicit opt-in only
 */
export const MAY_FLIP_CRITERIA = (process.env.E2E_CRITERIA || "fixed") === "flip";

export function criteriaNote(what) {
  console.log(`[e2e] community criteria are fixed — not ${what} (E2E_CRITERIA=flip to allow)`);
}
