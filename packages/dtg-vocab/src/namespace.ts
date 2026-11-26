/**
 * The one constant cred-spec #48 asks a consumer to isolate: everything this
 * package (and anything downstream of it) knows about the DTG vocabulary's
 * real-world location. Change these three lines when the registry's
 * namespace changes; nothing else in this package, or in a correct
 * consumer, should hard-code an IRI.
 *
 * This targets the REAL registry namespace recorded in the (open, unmerged)
 * dtgwg-cred-spec#64 — not the plan's still-written `firstperson.network`
 * placeholder. See /srv/dev/scratch/2026-09-27-bm-vsc-migration-handoff.md's
 * "Cleanup" section for why, and what to check if #64 changes before
 * merging.
 */
export const DTG_PREDICATE_NAMESPACE = 'https://registry.trustoverip.org/dtg/vsc/'
export const DTG_VOCAB_NAMESPACE = 'https://registry.trustoverip.org/dtg/credentials#'
export const DTG_CONTEXT_URL = 'https://registry.trustoverip.org/dtg/context/v1'

export const DTG_PREDICATE_WITNESSED = `${DTG_PREDICATE_NAMESPACE}witnessed/1`
export const DTG_PREDICATE_ENDORSES = `${DTG_PREDICATE_NAMESPACE}endorses/1`
