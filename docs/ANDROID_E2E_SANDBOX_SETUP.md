# Running Android-only E2E from a claude-pod Sandbox

The Android e2e flow (`vrc-exchange:android-only`, two AVDs instead of an
Android + iOS pair) drives real emulators through Appium/adb. A `claude-pod`
sandbox container can't run any of that natively — this doc records what's
missing, why, and how to bridge a host's existing Android setup into the pod
instead of installing a duplicate toolchain inside it.

## Why the sandbox can't do this on its own

Checked directly against a running pod:

- No `/dev/kvm` — the Android emulator has no hardware acceleration path.
- No Android SDK, no `adb`, no `emulator`, no Appium baked into the image.
- `claude-pod` itself has **no GPU/display/device-passthrough mechanism at
  all** (confirmed against the project's own docs) — there is no flag that
  lets an emulator process run inside the container, now or with more setup.

So the model isn't "install the SDK in the sandbox" — it's "run the real
emulators on the host (where `yarn android` already works) and bridge in only
the two ports the e2e scripts actually touch."

## What the e2e scripts actually need over the network

Traced through `e2e/lib/driver.js`:

- **`:4723`** — Appium's REST API. `webdriverio` talks to it for the whole
  session lifecycle. The harness reuses an already-responding Appium server
  instead of spawning its own (`driver.js` health-checks the port first), so
  pre-starting Appium on the host and bridging the port is enough.
- **`:5037`** — the adb server port. `driver.js` shells out directly to
  `adb -s <udid> reverse tcp:8081 tcp:8081` (to map the emulator's metro
  port back), so a real `adb` **client** binary has to exist inside the
  container, pointed at a real adb **server** — which can be the host's.

## Host-side setup (before launching the pod)

```sh
# AVDs boot on the host as usual
emulator -avd Pixel_6_API_33 -port 5554 &
emulator -avd Pixel_6_API_33 -port 5556 &     # second instance for android-only

cd app/android && ./gradlew assembleDebug
(cd app && yarn start &)                       # metro

cd e2e && npm install && npm i -g appium
appium driver install uiautomator2
appium &                                       # pre-start so the harness reuses it
```

## Launching the pod

```sh
HOST_SERVICES="5037 4723" claude-pod
```

`HOST_SERVICES` with an explicit port list forwards exactly those ports from
`127.0.0.1` inside the container to the host via `host.docker.internal`,
using the same socat-based mechanism already baked into the image's
entrypoint. No other host bridge is needed.

## Inside the pod

Only a minimal `adb` client is needed, not the full SDK. Confirmed by pulling
`platform-tools` into a running pod and running `ldd` against the `adb`
binary: it depends only on `libdl`, `libpthread`, `libm`, `librt`, `libgcc_s`,
and `libc` — all already present in the image (Debian bookworm) — and it ran
immediately with no missing libraries.

```sh
curl -sL -o /tmp/platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-linux.zip
unzip -q /tmp/platform-tools.zip -d /opt
export PATH="/opt/platform-tools:$PATH"
export ANDROID_ADB_SERVER_PORT=5037

cd e2e && PLATFORMS=android,android npm run vrc-exchange:android-only
```

### Caveat: don't let a local adb daemon win the port

`adb` only checks whether *something* is listening on `:5037` — it can't
tell a real (host-bridged) server from a throwaway local one, and will
happily spawn its own if it doesn't see one yet. Since `claude-pod` wires up
the `HOST_SERVICES` port forward in the entrypoint before your shell (or
Claude) ever runs, the forwarded port should already be bound by the time any
`adb` command executes — so it connects through the bridge rather than
starting a local server. Don't run `adb kill-server` / `adb start-server`
inside the pod first; that risks tearing down the forwarding listener instead
of a real daemon.

## Summary

| Piece | Runs on | Reached from pod via |
| --- | --- | --- |
| Android emulators (AVDs) | host | (not reached directly — only through adb) |
| adb server | host | `HOST_SERVICES` forward on `:5037` + `adb` client in pod |
| Appium server | host | `HOST_SERVICES` forward on `:4723` |
| metro | host | `adb reverse tcp:8081 tcp:8081`, set up via the forwarded adb server |
| e2e test runner (`vrc-exchange:android-only`) | pod | — |
