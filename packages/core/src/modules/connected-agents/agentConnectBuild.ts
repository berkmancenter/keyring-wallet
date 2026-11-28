import Config from 'react-native-config'

/**
 * Whether this build carries agent connect at all (decided 2026-11-28 by Alberto: agent connect's switch, and the P1
 * rooms switch, are absent from store builds until he decides to release them).
 *
 * A build-time setting, `KEYRING_AGENT_CONNECT_BUILD=1` in the app's `.env`, read through `react-native-config`, so it
 * is baked into the native binary when the app is built. An OTA update changes the JavaScript, never this value.
 * Development and test builds set it: `app/.env.sample` and `test-builds.yml`. Store, TestFlight and Play builds
 * (`staging.yaml`) do not, and refuse a `.env` that carries it. Turning agent connect on for a release is a build-config
 * change, his to make.
 *
 * With it off, both switches (agentConnectFlag.ts and agentRoomsFlag.ts) read false and their setters do nothing,
 * and the Developer screen shows neither switch's row. Nothing in the app can set it: there is no setter, and it is
 * read on every call. (The setters are not named here: the release gate counts any mention of one as a way to turn the
 * flag on.)
 *
 * @module connected-agents/agentConnectBuild
 */

/** The `.env` key. Only its exact value `1` (around whitespace) turns the build on. */
export const AGENT_CONNECT_BUILD_KEY = 'KEYRING_AGENT_CONNECT_BUILD'

/** Whether this build carries agent connect and its rooms tier: false in every store build. */
export function agentConnectAvailableInBuild(): boolean {
  return Config.KEYRING_AGENT_CONNECT_BUILD?.trim() === '1'
}
