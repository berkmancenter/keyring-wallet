/**
 * Rollout rings. A bundle reaches ring 0 first (the maintainers' own devices),
 * then ring 1 (internal testers), then ring 2 (everyone).
 *
 * A ring is the loader's named cohort. The loader otherwise gives every install
 * a random numeric cohort (1-1000) and sends it on every update check, which
 * would make a near-unique tag per install; so every install carries a ring
 * name instead, and percentage rollouts are not used.
 */
export const RINGS = ['ring0', 'ring1', 'ring2'] as const
export type Ring = (typeof RINGS)[number]

export const DEFAULT_RING: Ring = 'ring2'

export const isRing = (value: unknown): value is Ring =>
  typeof value === 'string' && (RINGS as readonly string[]).includes(value)

export interface CohortStore {
  getCohort: () => string
  setCohort: (cohort: string) => void
}

/** The ring this install is in, moving it to the default ring when it has none. */
export const ensureRing = (store: CohortStore): Ring => {
  const current = store.getCohort()
  if (isRing(current)) return current
  store.setCohort(DEFAULT_RING)
  return DEFAULT_RING
}

export const setRing = (store: CohortStore, ring: Ring): Ring => {
  store.setCohort(ring)
  return ring
}
