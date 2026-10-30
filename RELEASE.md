# Releasing Keyring

How a change reaches testers. Testers install Keyring through TestFlight (iOS)
and Google Play open testing (Android). There is no public store listing.

What changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## Two ways to ship

| | Store build | Over-the-air (OTA) update |
|---|---|---|
| Carries | Everything, native code included | The app's JavaScript only |
| Named | By build number, e.g. `276` | By build and update, e.g. `276.3` |
| Built by | [`staging.yaml`](.github/workflows/staging.yaml) | [`ota-publish.yml`](.github/workflows/ota-publish.yml) |
| Reaches | TestFlight, then Play internal testing; [`promote-android.yml`](.github/workflows/promote-android.yml) moves it to open testing | Testers on that store build |

[`scripts/release/tier.mjs`](scripts/release/tier.mjs) decides which a change
needs, from the files it touches. Native code, dependencies, build settings and
stored-data migrations need a store build. Screens, flows, text and translations
can go over the air.

## A store build

1. **Freeze.** Pick the wallet commit and the `bifold/` pin to ship.
2. **Carry the OTAs.** Every change shipped over the air since the last store
   build must be in the new one. `scripts/ota/ota-carried-check.sh` checks this.
3. **Gate.** Run the full release gate on the exact build that will ship
   ([`docs/RELEASE_GATE.md`](docs/RELEASE_GATE.md)).
4. **Build.** The staging workflow builds both platforms, uploads them, and tags
   the commit `staging-v<version>-<build>`.
5. **Promote.** On Android, a maintainer promotes the build to open testing.

## An over-the-air update

1. The change merges on `main`, and goes on a `hotfix/<build>-ota-<n>` branch cut
   from that store build's own commit.
2. A maintainer approves the publish. It can go to the maintainers' own phones
   first, then to everyone.
3. After it ships, the post-release workflow smoke-tests it on both platforms.
   A red smoke withdraws the update automatically.
4. Any update can be withdrawn by hand.

The update server is described in
[`deploy/keyring-ota/README.md`](deploy/keyring-ota/README.md).

## Rules

- Every store build, every OTA publish, and every promotion needs a maintainer's
  approval in GitHub.
- The version stays plain `MAJOR.MINOR.PATCH`. The stores reject a pre-release
  suffix.
- Build numbers only go up.
