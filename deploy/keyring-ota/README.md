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
behind Caddy, which obtains the certificate for `OTA_HOST`. One small instance is
enough (decision 5: Lightsail in the existing AWS account). Only Caddy publishes
ports, and neither container keeps an access log.

- **Back up the `ota-data` volume.** If the database is lost, every phone on an
  update is told to roll back to its store bundle on its next check (seen in the
  spike). That is safe, but every update must then be published again.
- **The publisher reaches the server directly**, at `OTA_HOST`, not through a CDN.
  Before each upload the CLI checks objects with HEAD requests on the URLs the
  server returns, and a cache or a rate limiter in between breaks publishes. The
  server answers those requests on the origin the publisher came in on.
- Not built or run here yet: the image and the compose file are checked
  (`docker compose config`) but not deployed.

## Configuration in the repository (phase 1)

| Name | Kind | Holds | Used by |
| --- | --- | --- | --- |
| `OTA_UPDATE_URL` | variable | `https://<OTA_HOST>/hot-updater`; **unset = OTA off** | staging.yaml (both store builds) |
| `OTA_PUBLIC_KEY` | variable | the loader's RSA public key (PEM; public) | staging.yaml, ota-publish.yml |
| `OTA_CHANNEL` | variable | the channel, default `production` | staging.yaml, ota-publish.yml |
| `OTA_SERVER_URL` | variable | `https://<OTA_HOST>` for the publisher | ota-publish.yml |
| `OTA_SIGNING_KEY_PEM` | secret, environment `ota` | the RSA private key | ota-publish.yml |
| `HOT_UPDATER_AUTH_TOKEN` | secret, environment `ota` | the server's management token | ota-publish.yml |
| environment `ota-approval` | required reviewers | the two approvers; holds no secrets | ota-publish.yml |

The key pair is generated offline (`npx hot-updater keys generate`). The public
half goes into `OTA_PUBLIC_KEY`; the private half goes into the `ota` environment
plus an offline backup. Replacing the key takes a store build, because the public
key is compiled into the binary.
