/**
 * hot-updater CLI configuration: how an over-the-air bundle is built, signed
 * and published (docs/plans/release-cadence-and-testing-strategy/ota_updates_subtask.md).
 *
 * Phase 1: the update server is deploy/keyring-ota (bundles and metadata on that
 * server); bundles are signed with the loader's own RSA key, whose public half
 * is in the binary. Nothing here holds a secret; the CLI reads them from the
 * environment:
 *   OTA_SERVER_URL          the server's base URL as the publisher reaches it
 *   HOT_UPDATER_AUTH_TOKEN  the server's management token
 *   OTA_SIGNING_KEY         path to the RSA private key (PEM); never in the repo
 */
import { bare } from '@hot-updater/bare'
import { standaloneRepository, standaloneStorage } from '@hot-updater/standalone'
import { defineConfig } from 'hot-updater'

const serverUrl = (process.env.OTA_SERVER_URL ?? 'http://localhost:3080').replace(/\/+$/, '')
const authHeaders = { Authorization: `Bearer ${process.env.HOT_UPDATER_AUTH_TOKEN ?? ''}` }

export default defineConfig({
  // The bundle is built the way the store build bundles it: the React Native
  // CLI with this app's own metro.config.js, then Hermes bytecode.
  build: bare({ enableHermes: true, entryFile: 'index.js', outDir: '.hot-updater/dist' }),
  storage: standaloneStorage({ baseUrl: `${serverUrl}/storage`, commonHeaders: authHeaders }),
  database: standaloneRepository({ baseUrl: `${serverUrl}/hot-updater`, commonHeaders: authHeaders }),
  // A bundle is offered only to binaries whose native fingerprint matches the one
  // it was built against: a native change always needs a store build.
  updateStrategy: 'fingerprint',
  fingerprint: {
    // The bifold submodule's own native modules are linked from source through
    // portals; hash them explicitly rather than trusting autolinking to see them.
    extraSources: [
      '../bifold/packages/react-native-attestation/ios',
      '../bifold/packages/react-native-attestation/android',
      '../bifold/packages/react-native-locality-peripheral/ios',
      '../bifold/packages/react-native-locality-peripheral/android',
    ],
  },
  signing: {
    enabled: true,
    privateKeyPath: process.env.OTA_SIGNING_KEY ?? './keys/ota-private-key.pem',
  },
  platform: {
    ios: { infoPlistPaths: ['ios/AriesBifold/Info.plist'] },
    android: { androidManifestPaths: ['android/app/src/main/AndroidManifest.xml'] },
  },
})
