import approverProfile from './approver/ApproverProfile'
import tradingCardProfile from './trading-card/TradingCardProfile'
import { DemoProfile } from './types'

/**
 * The demo profiles installed in this build.
 *
 * One build carries every profile in this list — there is no per-demo build,
 * no env switch and no fork. Adding a demo is adding a directory here and a
 * line to this array.
 */
export const installedDemoProfiles: readonly DemoProfile[] = [tradingCardProfile, approverProfile]

/**
 * Which installed profiles actually get registered on the container.
 *
 * Two profiles are now installed at once (trading-card, approver), and per
 * `demo-profiles/README.md`'s own rule — "a profile should register what it
 * owns... two profiles registering the same token means the last one wins"
 * — an unconditional `registerDemoProfiles(container, installedDemoProfiles)`
 * risks exactly that collision the day a profile needs a token another one
 * already claimed. Checked concretely for today's two profiles: trading-card
 * registers `COMPONENT_CONTACT_CARD` and `UTIL_OCA_RESOLVER`; approver
 * registers `COMPONENT_HOME_HEADER` and its own Trust Task type — no actual
 * overlap today (see `approver/ApproverProfile.ts`'s own comment on why it
 * deliberately avoided `COMPONENT_CONTACT_CARD`).
 *
 * Even with no collision today, requirement D (see this repo's packaging
 * plan) asks for "at least a minimal way to choose which is active for a
 * given e2e run" — an env var is explicitly called out as sufficient, a full
 * picker UI is later work. `ACTIVE_DEMO_PROFILE` (react-native-config, so
 * `app/.env`'s `ACTIVE_DEMO_PROFILE=trading-card` or `=approver`) selects a
 * single profile by id; unset (the default) registers every installed
 * profile, which is what today's actual (collision-free) pair needs for a
 * demo-day walkthrough of both.
 */
export function selectDemoProfiles(activeProfileId?: string): readonly DemoProfile[] {
  if (!activeProfileId) return installedDemoProfiles
  const match = installedDemoProfiles.find((p) => p.id === activeProfileId)
  return match ? [match] : installedDemoProfiles
}

export type { DemoProfile } from './types'
export { registerDemoProfiles } from './types'
