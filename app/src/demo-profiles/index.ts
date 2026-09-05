import tradingCardProfile from './trading-card/TradingCardProfile'
import { DemoProfile } from './types'

/**
 * The demo profiles installed in this build.
 *
 * One build carries every profile in this list — there is no per-demo build,
 * no env switch and no fork. Adding a demo is adding a directory here and a
 * line to this array.
 */
export const installedDemoProfiles: readonly DemoProfile[] = [tradingCardProfile]

export type { DemoProfile } from './types'
export { registerDemoProfiles } from './types'
