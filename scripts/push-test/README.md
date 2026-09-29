# Push-test builds

The push-test variant of Keyring, for testing push notifications on our own
phones before anything reaches testers
([push notifications plan](../../docs/plans/push-notifications-plan.md), §6).
It installs beside the release app:

| | Release app | Push-test variant |
| --- | --- | --- |
| iOS bundle ID / Android application ID | `asml.bkc.harvard.wallet` | `asml.bkc.harvard.wallet.pushtest` |
| iOS entitlements | `AriesBifold.entitlements` (associated domains, App Attest) | `AriesBifold-PushTest.entitlements` (push only) |
| iOS signing | Automatic, or the release profile in CI | Manual, "Keyring Push Test Dev" (development push) |
| Firebase | the committed `google-services.json` | the Keyring project's, copied in for the build |
| Push gateway | none | `PUSH_GATEWAY_URL` from `app/.env.pushtest` |

The release build is unchanged, and these scripts leave the tree as they found
it:
- The Android suffix applies only to a build run with `-PkeyringPushTest`.
- The iOS script switches the app target's settings for one build and restores
  the project file on exit. Command-line build settings would reach the Pods
  targets too, and a provisioning profile fails those.

## Needs

- `~/.keyring-push/app/google-services.json`, with a client for the pushtest
  package (Android), and `~/.keyring-push/app/Keyring_Push_Test_Dev.mobileprovision`
  (iOS). Set `KEYRING_PUSH_DIR` to use another folder. Neither goes in the repo.
- `app/.env.pushtest` (gitignored): a copy of `app/.env` with `PUSH_GATEWAY_URL`
  set, and, for iOS, `PUSH_APNS_ENVIRONMENT` left empty (sandbox, which the
  development profile needs).
- iOS: an Apple Development certificate for team `947XHQ9DVC` in the keychain,
  and a phone listed in the profile.

## Run

```sh
scripts/push-test/build-android.sh   # then: adb -s <serial> install -r <apk>
scripts/push-test/build-ios.sh       # then: xcrun devicectl device install app --device <udid> <app>
```

Both are full native release builds: declare them before running on a shared
Mac, one heavy build at a time.

`build-ios.sh` edits the tracked `project.pbxproj` and `Info.plist` for the length
of one build. The `Info.plist` change allows local networking
(`NSAllowsLocalNetworking`), so the phone can reach a push gateway on the Mac at
`http://<mac>.local:<port>`; the release app allows plain HTTP to `localhost`
only, and a test fails if its `Info.plist` ever allows more.
It refuses to start if that file has changes, restores it on any exit, ctrl-C
or kill signal, and ends by showing it is clean. The one case it cannot catch
is `kill -9`; after that, before anything else:

```sh
git checkout -- app/ios/AriesBifold.xcodeproj/project.pbxproj app/ios/AriesBifold/Info.plist
```

## Limits

- No App Attest in the iOS variant: its profile does not grant it, so a
  push-test build falls back to a plain exchange where the release app would
  attest. Enable App Attest (and associated domains, for universal links) on the
  pushtest App ID and regenerate the profile if a test needs them.
- The iOS variant still carries the committed `GoogleService-Info.plist`, whose
  bundle ID is the release app's. The gateway sends to APNs directly with its
  own key, so iOS push does not go through Firebase; Firebase logs a bundle ID
  warning and nothing depends on it.
