/**
 * Keyring's `enablePushNotifications` for bifold's push framework: the
 * onboarding permission screen and the Settings switch (push notifications plan
 * §4.1, steps 1.4 and 1.6; the framework is reused, not removed). Bifold shows
 * neither screen unless the app supplies this configuration, and Keyring
 * supplies it only in a build that names a push gateway (`PUSH_GATEWAY_URL`):
 * a tester's build has no configuration, so no prompt, no switch and no
 * registration.
 *
 * - `status` / `setup`: the notification permission, read or requested.
 * - `toggle(true)`: make this phone wakeable by its agent (`enablePushWake`).
 * - `toggle(false)`: stop its agent waking it (`device/set-wake` with no handle).
 */
import type { Config } from '@bifold/core'
import type { Agent } from '@credo-ts/core'

import type { PushWakeOutcome } from './pushWake'

export type PushNotificationsConfig = NonNullable<Config['enablePushNotifications']>
export type PermissionState = 'denied' | 'granted' | 'unknown'

export interface PushConfigDeps {
  gatewayUrl?: string
  permissionStatus(): Promise<PermissionState>
  requestPermission(): Promise<PermissionState>
  enableWake(agent: Agent): Promise<PushWakeOutcome>
  clearWake(agent: Agent): Promise<unknown>
  log(message: string, data?: Record<string, unknown>): void
}

/** The configuration, or undefined when the build names no push gateway. */
export function pushNotificationsConfig(deps: PushConfigDeps): PushNotificationsConfig | undefined {
  if (!deps.gatewayUrl?.trim()) return undefined
  return {
    status: () => deps.permissionStatus(),
    setup: () => deps.requestPermission(),
    toggle: async (state: boolean, agent: Agent) => {
      // A refusal from the gateway or the agent is logged, never thrown into
      // the Settings screen: push is optional and the app works without it.
      try {
        if (state) {
          const outcome = await deps.enableWake(agent)
          deps.log('push wake: enable', { status: outcome.status })
        } else {
          await deps.clearWake(agent)
          deps.log('push wake: cleared')
        }
      } catch (e) {
        deps.log('push wake: failed', { enable: state, error: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}
