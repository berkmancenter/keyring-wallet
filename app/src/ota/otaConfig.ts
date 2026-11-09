/**
 * Over-the-air JS updates (docs/plans/release-cadence-and-testing-strategy/ota_updates_subtask.md).
 *
 * Off unless the build names an update server: OTA_UPDATE_URL is read from
 * react-native-config, so it is baked in at build time, like PUSH_GATEWAY_URL.
 * A build without it never contacts an update server, and runs the bundle it
 * shipped with.
 */
import Config from 'react-native-config'

/** The base URL of the update server's update-check routes (…/hot-updater), or undefined when OTA is off. */
export const otaUpdateUrl = (config: { OTA_UPDATE_URL?: string } = Config): string | undefined => {
  const url = config.OTA_UPDATE_URL?.trim()
  if (!url) return undefined
  // Release builds refuse cleartext (network_security_config, ATS); an http URL
  // would fail silently on every check, so it counts as off.
  if (!url.startsWith('https://')) return undefined
  return url.replace(/\/+$/, '')
}

export const isOtaEnabled = (config: { OTA_UPDATE_URL?: string } = Config): boolean =>
  otaUpdateUrl(config) !== undefined
