import { Container } from '@bifold/core'
import { DependencyContainer } from 'tsyringe'

/**
 * A demo profile is one use case, packaged.
 *
 * The point of the shape is that adding a use case is *additive*: a profile
 * registers what it needs into the running container and appears in the
 * picker. Nothing shared has to change, and there is no per-demo build — the
 * same binary carries every installed profile.
 *
 * That constraint is deliberate. A build flag per demo would be less code
 * today and the wrong shape tomorrow: a person at a table with a funder
 * switches demos in a few taps, not by rebuilding, and the SDK's eventual
 * `registerTrustTask({ spec, orchestration, renderer })` surface is this same
 * additive registration seen from the other side.
 */
export interface DemoProfile {
  /** Stable identifier; also the persisted value when a profile is selected. */
  id: string
  /** Shown in the picker. */
  title: string
  /** One line in the picker, under the title. */
  description: string
  /**
   * Register this profile's screens, renderers, resolvers and Trust Task
   * types. Called once, on the app's child container, before the app renders.
   *
   * Registering the same token from two installed profiles means the last one
   * wins — so a profile should register what it owns (its own credential
   * renderer, its own task type) rather than re-registering shared app
   * chrome.
   */
  register(container: DependencyContainer): void
}

/**
 * Apply every installed profile to the container.
 *
 * Separate from the profile list so a test can apply a single profile without
 * pulling in the rest.
 */
export function registerDemoProfiles(container: Container, profiles: readonly DemoProfile[]): void {
  for (const profile of profiles) {
    profile.register(container.container)
  }
}
