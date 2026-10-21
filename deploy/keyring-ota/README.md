# keyring-ota: the over-the-air update server

Phase 1 of [the OTA plan](../../docs/plans/release-cadence-and-testing-strategy/ota_updates_subtask.md).
hot-updater's own server (`@hot-updater/server` 0.36.18), with bundle metadata in
SQLite and bundles on this server's disk. It answers phones' update checks and
takes the publisher's uploads.

| Path | Who | Auth |
| --- | --- | --- |
| `/hot-updater/fingerprint/…`, `/hot-updater/app-version/…` | phones' update checks | none |
| `/hot-updater/api/…` | the publisher's bundle management (`hot-updater bundle …`) | `Authorization: Bearer $HOT_UPDATER_AUTH_TOKEN` |
| `/storage/upload`, `/storage/delete`, `/storage/readText`, `/storage/getDownloadUrl` | the publisher's uploads (the CLI's `standaloneStorage`) | the same token |
| `/files/<key>` | bundle downloads | none |

The update checks and downloads are public on purpose. Every bundle is
RSA-signed, and a phone whose binary carries the public key refuses any bundle
that is unsigned or signed with another key. The server keeps no access log and
no per-device record.

## Run it (spike)

```sh
cd deploy/keyring-ota
npm install
export HOT_UPDATER_AUTH_TOKEN=$(openssl rand -hex 32)   # the publisher needs the same value
npm run db:migrate
cloudflared tunnel --url http://localhost:3080          # in another terminal; note the https URL
OTA_PUBLIC_URL=https://<tunnel>.trycloudflare.com npm start
```

A Release build refuses cleartext, so phones reach the server only over HTTPS:
the tunnel in the spike, the hosted address later.

## Spike runbook

Everything below uses a throwaway key and a separate bundle id, never the
TestFlight app or the production key.

1. **Keys.** `cd app && npx hot-updater keys generate -o keys` (`app/keys/` is
   gitignored). `npx hot-updater keys export-public -y` writes the public key into
   `Info.plist` (`HOT_UPDATER_PUBLIC_KEY`) and the manifest (`com.hotupdater.PUBLIC_KEY`).
2. **Channel and fingerprint.** `npx hot-updater channel set spike`, then
   `yarn ota:fingerprint` right before the native build: it writes the native
   fingerprint into the same files. Do not commit these three native edits; in
   CI they are made inside the store build job.
3. **App setting.** `OTA_UPDATE_URL=https://<tunnel>/hot-updater` in `app/.env`.
4. **Native build.** iPhone through the device quick-install skill (its own
   bundle id), and a Release APK on an emulator. Open Developer → Over-the-air
   updates: it should say `on`, `embedded`, channel `spike`, ring `ring2`. Join
   ring 0 there.
5. **Publish.** Make a visible JS-only change, commit it, then
   `OTA_SERVER_URL=http://localhost:3080 OTA_SIGNING_KEY=keys/ota-private-key.pem yarn ota:deploy --base <commit the build came from> --channel spike`.
   A store build is named by number instead (`--build 245`, its `staging-v*-245`
   tag); `--base` exists for the spike's untagged build. Either way the base must
   be an ancestor of HEAD, and `scripts/release/tier.mjs` must say `ota`.
6. **Apply.** Cold-start the app twice: the first start downloads and stages the
   bundle, the second runs it. The Developer screen's `Running` line (testID
   `OtaBundleId`) shows the bundle id.

Pass criteria (OTA plan, phase 0):

- a Release build on each platform loads a published bundle (step 6);
- a bundle published unsigned, or with another key, is refused;
- a bundle that throws before its first screen is rolled back on the next cold start and listed under "Rolled back";
- a bundle built against a different native fingerprint is never offered;
- with `OTA_UPDATE_URL` unset, the app behaves exactly as today;
- bundle size, download time, and merge-to-phone minutes are recorded.

## Rings

A bundle is deployed at 0% rollout and then targeted at `ring0` only. Widening
and withdrawing:

```sh
npx hot-updater bundle update <id> --target-cohorts ring0,ring1 -y
npx hot-updater bundle update <id> --target-cohorts ring0,ring1,ring2 -y
npx hot-updater bundle disable <id> -y    # phones on it go back to the previous bundle
```

## Tests

`npm test` (Node's test runner; the storage module only).

## Hosting (phase 1)

`docker compose up -d` with a filled-in `.env` (`.env.example`) runs the server
behind Caddy, which obtains the certificate for `OTA_HOST`. Data lives under
`./data` (`ota/` for the database and bundles, `caddy/` for certificates);
`mkdir -p data/ota && sudo chown 1000:1000 data/ota` before the first start on
Linux, since the server runs as the image's `node` user. The GCP host is defined
in the private infrastructure repository (`infra/environments/ota-prod`), which
mounts its snapshotted data disk over `./data`. One small instance is
enough (decision 5: Lightsail in the existing AWS account). Only Caddy publishes
ports, and neither container keeps an access log.

- **Back up the `ota-data` volume.** If the database is lost, every phone on an
  update is told to roll back to its store bundle on its next check (seen in the
  spike). That is safe, but every update must then be published again.
- **The publisher reaches the server directly**, at `OTA_HOST`, not through a CDN.
  Before each upload the CLI checks objects with HEAD requests on the URLs the
  server returns, and a cache or a rate limiter in between breaks publishes. The
  server answers those requests on the origin the publisher came in on.
- **Deployed:** the server runs at `https://keyring-ota.asml.berkmancenter.org`,
  from the infrastructure repository's `infra/environments/ota-prod`.
- **Do not delete or rewrite `spike/ota-hot-updater`.** The live server is
  pinned there: ota-prod's `package_branch` is `spike/ota-hot-updater`, and its
  `package_ref` is a commit on that branch (304f0d4b). The VM checks out
  `deploy/keyring-ota` at that commit on every boot and resync. Pruning or
  force-pushing the branch can leave the pinned commit unfetchable, and the
  next boot would then fail to start the server. Moving the pin to a commit on
  `main` is a reviewed edit to ota-prod's `terraform.tfvars`, applied by the
  infrastructure owner. Only after that is the branch free to go.

## The wallet host, on the same VM

The compose file also runs **keyring-links** (`deploy/keyring-links`, the short invitation links at `/i`). The Caddyfile has a second site, `WALLET_HOST`, that serves the wallet host's static site from `app/universal-link-site` (universal-link files and the `/invite` install page) and proxies `/i` and `/i/*` to it.
- **Link files:** they go to `LINKS_DATA_PATH`, a disk that is not snapshotted, so no backup outlives a link's 7 days.
- **Defaults:** locally, `WALLET_HOST` defaults to `wallet.localhost` and `LINKS_DATA_PATH` to `./links-data` (gitignored).
- **Moving the domain:** the wallet host's DNS record moves to this VM only at a planned cut-over (the infra repo's ota-prod README).

## Upgrading hot-updater

OTA is dormant in a build without `OTA_UPDATE_URL`. One part of that depends on
the library version, not on our code: at app start, the native loader only
picks a local file and makes no network request. That was checked for
`@hot-updater/react-native` **0.36.18**, from its native source:
- iOS: `bundleURL` → `prepareLaunch` → `selectLaunch`.
- Android: `getJSBundleFile` → `prepareLaunch` → `selectLaunch`.
- Every download call is reachable only from `updateBundle`, which only the JS
  module calls.
- In JS, `fetch` lives only in `fetchUpdateInfo.ts`, behind `wrap`.

The file and line trail is on wallet PR #525.

A new version could move a download onto the launch path without any of our
code changing, and nothing in this tree would notice. **Any bump of
`@hot-updater/*` re-walks that path** before it merges:
1. Read both platforms' `selectLaunch`.
2. List every download call site and confirm each is reachable only from
   `updateBundle`.
3. Check the JS package for module-level effects.

Record the result in the bump PR. Also run the OTA gate leg (`gate-ota.yml`).
Bump the CLI, `@hot-updater/server` and `@hot-updater/react-native` together
(the server's update-check routes and the app's loader are one protocol).

## Configuration in the repository (phase 1)

| Name | Kind | Holds | Used by |
| --- | --- | --- | --- |
| `OTA_UPDATE_URL` | variable | `https://<OTA_HOST>/hot-updater`; **unset = OTA off** | staging.yaml (both store builds) |
| `OTA_PUBLIC_KEY` | variable | the loader's RSA public key (PEM; public) | staging.yaml, ota-publish.yml |
| `OTA_CHANNEL` | variable | the channel, default `production` | staging.yaml, ota-publish.yml |
| `OTA_SERVER_URL` | variable | `https://<OTA_HOST>` for the publisher | ota-publish.yml |
| `OTA_SIGNING_KEY_PEM` | secret, environment `ota` | the store RSA private key (channels production and preview) | ota-publish.yml |
| `OTA_TEST_SIGNING_KEY_PEM` | secret, environment `ota` | the quick-install test app's throwaway private key (channel device-test only); delete it after a trial | ota-publish.yml |
| `HOT_UPDATER_AUTH_TOKEN` | secret, environment `ota` | the server's management token | ota-publish.yml |
| environment `ota-approval` | required reviewers | the two approvers; holds no secrets | ota-publish.yml |

**Channels and keys** (`ota-publish.yml`'s `channel` input; enforced by `scripts/ota/signing-key.mjs`):

| Channel | Who has it | Signed with | Inputs |
| --- | --- | --- | --- |
| `production` | store builds | `OTA_SIGNING_KEY_PEM`, which must be `OTA_PUBLIC_KEY`'s pair | `build` (staging tag number); tier check |
| `preview` | an early-access group (no app build yet) | the same store key: store builds carry only `OTA_PUBLIC_KEY` | `build`; tier check |
| `device-test` | the quick-install test app only | **only** `OTA_TEST_SIGNING_KEY_PEM`, which must not be the store key; no fallback | `base` (the test app's build commit); tier check skipped; actions publish, tamper, crash, mismatch, disable, cleanup (`scripts/ota/device-test.sh`) |

Every channel waits for the `ota-approval` reviewer.

The channels are not isolated in the same way:

- **`device-test` is isolated cryptographically.** Only the test app carries its public key, so even a store phone that asked for that channel would refuse its bundles.
- **`preview` is isolated by channel routing alone.** It is signed with the store key on purpose, since its audience is store builds. Any store build that asks for the preview channel accepts its bundles. Treat a preview publish as reaching real users who opted in.
- **`production` has no isolation at all:** it is what every store build asks for.

The key pair is generated offline (`npx hot-updater keys generate`). The public
half goes into `OTA_PUBLIC_KEY`; the private half goes into the `ota` environment
plus an offline backup. Replacing the key takes a store build, because the public
key is compiled into the binary.
