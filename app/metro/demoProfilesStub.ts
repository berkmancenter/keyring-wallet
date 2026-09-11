/**
 * Build-time stand-in for `src/demo-profiles/index.ts`, substituted by
 * `metro.config.js`'s `resolveRequest` whenever `ACTIVE_DEMO_PROFILE=none` —
 * see that file's own comment for the resolver rule, and
 * `src/demo-profiles/README.md`'s "Stripping demos from a build" section for
 * why this exists and what it actually removes.
 *
 * Same public shape as the real module (`registerDemoProfiles`,
 * `selectDemoProfiles`, `installedDemoProfiles`, the `DemoProfile` type), so
 * `App.tsx`'s own two-line integration needs no change either way. The
 * `DemoProfile` shape is duplicated below rather than imported from
 * `../src/demo-profiles/types` on purpose: this file's entire point is to
 * have NO dependency edge back into `demo-profiles/`, of any kind, so that
 * Metro's dependency graph never has a reason to walk into `approver/`,
 * `trading-card/`, or `starter/` from here — none of it reaches the bundle.
 */

import type { Container } from '@bifold/core'
import type { DependencyContainer } from 'tsyringe'

interface DemoProfileLike {
  id: string
  title: string
  description: string
  register(container: DependencyContainer): void
}

export const installedDemoProfiles: readonly DemoProfileLike[] = []

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function selectDemoProfiles(activeProfileId?: string): readonly DemoProfileLike[] {
  return []
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerDemoProfiles(container: Container, profiles: readonly DemoProfileLike[]): void {
  // No-op: this build carries no demo profiles.
}

export type { DemoProfileLike as DemoProfile }
