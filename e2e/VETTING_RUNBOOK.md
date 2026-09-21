# Running the vetting ceremony

What it takes to get `run-vti-vetting.js` through a two-device run, and the
traps that cost a full session on 2026-09-20. Most of them present as the app
misbehaving and are not.

## Before anything

```sh
./scripts/openvtc/local-vti-stack/stack-health.sh          # report
./scripts/openvtc/local-vti-stack/stack-health.sh --heal   # restart what is down
```

Run this **before every rung**. Three separate runs failed on a dead service
rather than the thing under test, each after a wrong diagnosis. A minute here
is cheaper than an hour of reading a stack failure as a client bug.

It checks the three shapes that do not announce themselves:

- a process that has exited — its tunnel then answers `502` and the client
  says "unable to resolve did document"
- a tunnel with nothing behind it
- a service whose **mediator websocket dropped** while it kept serving REST.
  This is the nastiest: a manifest fetch succeeds, so the community looks
  healthy, and every Trust Task asked over DIDComm goes unanswered with no
  error anywhere. Trust the LAST websocket event in the log, never the
  presence of a connect line somewhere in it.

### RUST_MIN_STACK is not optional

```sh
export RUST_MIN_STACK=33554432
```

A VTA started without it **overflows a worker stack and aborts the process**
handling `vta/webvh/dids/create/1.0` — the first persona mint. The client
reports "the VTA did not answer", which reads as a timeout rather than a
crash, and the log line is at the very end of the file where nobody looks.
`up.sh` and `stack-health.sh` both export it. Anything you restart by hand
must too.

## Stack setup, in order

```sh
./scripts/openvtc/local-vti-stack/up.sh                 # six services + tunnels
./scripts/openvtc/local-vti-stack/community-setup.sh    # admin cred, ACL, type, criterion
```

`up.sh` leaves a community that can do nothing until `community-setup.sh` runs:
its ACL is empty so its own admin cannot authenticate, no statement type is
registered, and no criterion is published.

**Two ACL directions, both required.** `up.sh` adds each VTA to the DID-hosting
daemon's ACL. The daemon also has to be in **each VTA's** ACL, or a persona
mint is refused with `refusing trust task: DID not in ACL` and the client just
sees a timeout:

```sh
vta --config <n>/config.toml import-did --did "$DIDS_DID" --role admin --label dids-daemon
```

**Register the DID host with each VTA** (`up.sh` does this now). Without it a
persona is minted "serverless" — created, keys held, served by nobody — and the
phone fails at "community session as persona" with a 404 naming the persona
rather than the missing registration. `[VTA-PROBE] servers 0` is the tell.

## The rungs, and how they chain

```sh
# first rung of a chain keeps the app installed afterwards
ANDROID_AVD=API36_S25_A E2E_KEEP_APP=1 PLATFORM=android node run-vta-enrol.js
# later rungs keep the state it left
ANDROID_AVD=API36_S25_A E2E_KEEP_STATE=1 PLATFORM=android node run-vti-invite.js
```

`fullReset` uninstalls the app at the **end** of a session as well as the
start, so without `E2E_KEEP_APP=1` each rung deletes its own result and the
next one opens a freshly installed app at the Welcome screen — reported as a
missing element rather than missing state. `E2E_KEEP_STATE=1` alone cannot fix
it: it preserves state that is still there, and by then there is none.

For the ceremony itself:

```sh
ANDROID_AVD=API36_S25_A PLATFORMS=ios,android E2E_KEEP_STATE=1 node run-vti-vetting.js
```

`PLATFORMS` is `applicant,vetter` in that order. The default puts the vetter on
iOS; `ios,android` makes **Android the vetter**, which is the way round that
works today — an invitation cannot reach iOS (see VTI-32 in the findings doc:
the credential is 6,331 bytes and a QR carries 2,953), and the applicant needs
no invitation.

The vetter must be a member holding the grant before the ceremony:

```sh
node tsp-reference/ref-20-local-vetting/vtc-admin.mjs "$VTC_URL/v1" "$VTC_DID" \
  ~/vti-stack/vtc-admin-credential.json vetter-grant <vetter persona did>
# if the client was not listening when it was issued:
node ... vtc-admin.mjs ... vetter-resend <vetter persona did>
```

## Taps: use adb, not WebDriver

A React Native `Pressable` can accept a WebDriver tap and never run its
handler. Measured on the publish-profile and new-ticket controls: the element
reports clickable, enabled and displayed; `.click()`, a W3C pointer sequence
and UiAutomator2's `mobile: clickGesture` all return success; `onPress` does
not fire. Four verified retries in a row failed. `adb shell input tap` on the
identical centre point fired it every time.

`tapTestIdByCoordinates` and `tapElement` now shell out to adb on Android.
Use `tapElement` for a control found by a **scoped** lookup — a button inside
the current desk request — where re-finding by testID would match a stale one
elsewhere on the page.

## Things that look like app bugs and are not

| Symptom | Actually |
|---|---|
| "the VTA did not answer" | the VTA crashed on a stack overflow, or the DID host is not in its ACL |
| a Trust Task never answered, REST fine | that service's mediator websocket dropped hours ago |
| "element not found" after a tap | the tap never fired — use the adb path |
| a control "not displayed after N swipes" | the keyboard is covering it; dismiss it by tapping a heading, never `hideKeyboard` (it sends ESC on Android and cancels the PIN modal) |
| a card present with empty children and no testIDs | it is rendered **below the fold**; scroll to it before judging |
| the request button dead with the ticket field visibly full | `setValue` writes native text without raising `onChangeText`, so the component still thinks it is empty — type into a focused field and verify the BUTTON went enabled, never the field's text |
| a button `enabled="true"` but `visible="false"` | the keyboard pushed it off screen; a coordinate tap then lands somewhere else and reports success |
| the app ignoring a credential the community sent | it arrived during `connect`, before the screen's listener attached |
| a screen "connected" but receiving nothing | stale in-process state outliving the socket; always call `vtiAgent.connect`, it returns immediately when the socket is open |
| `[VTI-PROBE] failed … status: 421` on the phone, while `curl` to the same host is fine | **HTTP/2 connection coalescing.** Our six services sit on `*.ngrok.app` behind one wildcard certificate and the same IPs, so the phone reuses a connection opened for one host to talk to another and the edge answers `421 Misdirected Request`. `curl` opens a fresh connection per host and never sees it. Intermittent — re-run. It is a property of the ngrok fixture, not of the stack |
| the run reports the vetter never accepted, and the applicant's own screen shows a status from the PREVIOUS run | the probe failed, so membership read as unknown; the runner now resets in that case instead of assuming non-membership |
| every persona mint fails as "bad gateway", or `stack-health.sh` reports a tunnel `refused by ngrok (ERR_NGROK_4026)` | ngrok's edge is refusing that hostname. The message says "out of credit", but on 2026-09-21 it hit one domain on a Pay-as-you-go account well inside its credit, and ngrok support confirmed a limit set in error when the subscription was changed. Check the billing page; if there is credit left, write to support with the domain ID and a request ID. Nothing local fixes it. Afterwards run `--heal`: every VTA that booted while its own DID was refused skipped DIDComm for that boot |
| a fresh iOS install stops at "Error during call to 'onInitializeContext' … didcomm" | the wallet's own mediator (`yarn mediator`) or its cloudflared tunnel has died. Restart it **with the same flags** (`--didcomm-v2` if the build uses v2), then rebuild — the invitation is baked in |
| the rebuilt app still dials the OLD mediator | two causes, check both. (1) Xcode's incremental build did not regenerate `build/e2e-dd/Build/Products/GeneratedInfoPlistDotEnv.h`: delete it and rebuild. (2) The wallet saved the old URL as `selectedMediator` on its first launch: uninstall by the real bundle id — `xcrun simctl uninstall booted asml.bkc.harvard.wallet` (not `com.ariesbifold`, which silently uninstalls nothing) |
| the approver rung fails "manager was not held for consent", with the rule listed by `pnm approvals list` | alice is not ENFORCING its policies: `setup` writes `[policy] enforcement = false`, and the VTA then stores the rule and never evaluates it. `up.sh` sets it to `true` for alice now; an older lab needs it set by hand and alice restarted. No pnm command changes it |
| the manager's probe says `failed task failed: auth:consent_required` rather than "consent required" | the approver set had grown (every reinstalled phone adds one) until the refusal's `details` passed the framework's size bound, and the VTA sent the code alone — alice logs "error `details` exceeds the framework bound and was dropped". `approver-setup.sh add` now trims the set to the one approver, and the client reads a bare code as held |
| alice logs "no mediator route for consent approver" for the phone | that phone's manager DID was minted before 2026-09-21 and advertises a DIDComm v1 service; the VTA cannot push to it and the approval is found only when My Agent fetches it. Reinstall the approver to mint a DID with the v2 service |
| a helper script's session wiped the app | before 2026-09-21 `E2E_KEEP_STATE=1` did not reach the capabilities; it does now, but open ad-hoc sessions with it set |

## Debugging, in the order that pays

1. **Look at the screenshot.** `e2e/artifacts/vetting-failure-*.png`. Two
   hypotheses were spent on a card that a screenshot explained in a minute.
2. **Check the queue**, not the logs: `redis-cli HGET "DID:$(sha256 of the did)"
   RECEIVE_QUEUE_COUNT`. It tells you whether a message was sent, queued, or
   collected, which settles "who is at fault" faster than any log.
3. **Check the last websocket event** for every service, not the first.
4. **Then** instrument. A `console.log` at each early return in the screen
   found the listener race in one run, after an hour of inference from outside
   had found nothing.

On Metro: edit, then `curl localhost:8081/index.bundle?platform=android&dev=true`
to force a rebuild, then force-stop the app. Otherwise the app fetches the old
bundle and your logs never appear — which reads as the code not running.

## A passing run looks like this

```
applicant = ios, vetter = android
android: vetter profile published
android: ticket JBPB-88NB (324 chars)
ios: This community needs 1 statement(s) verifying: name.legal.
ios: ticket field 324/324 chars, request button enabled
ios: request sent
ios: accepted
match code vetter=SD88-JRDG applicant=SD88-JRDG
ios: card sent
android: card received — name.legal: Alice Example
android: statement issued
ios: 1 of 1 statements · meets the published requirements
ios: You are already a member (member).
```

## Every run writes its own transcript

`artifacts/<runner>-<timestamp>.log`, automatically — the terminal still gets
everything, this is only a copy. Read that file before anything else when a run
fails.

It exists because a failing run was once diagnosed from a screenshot and a
page-source dump alone: the run had been piped through `tail`, which buffers
until the process exits and then keeps only the last lines, so the one line
naming what the runner was waiting for no longer existed. **Do not pipe a run
through `tail` or `head`** — you lose the beginning, which is where the
failure usually is. The transcript captures WebdriverIO's own command log too,
which is the part that names the selector a dead run was waiting on.

## Rebuilding the vetter after something wipes it

`run-vrc-exchange-tsp` and the other VRC runners do a **fresh install with
onboarding on both devices**, which destroys the vetter's onboarding, persona,
membership and grant. The ceremony then stops at "Welcome / Get Started". To
put it back, in this order:

```sh
ANDROID_AVD=API36_S25_A E2E_KEEP_APP=1 PLATFORM=android node run-vta-enrol.js
ANDROID_AVD=API36_S25_A E2E_KEEP_STATE=1 E2E_KEEP_APP=1 PLATFORM=android node run-vti-invite.js
# the persona DID is printed by that run; grant it, then resend
node ../tsp-reference/ref-20-local-vetting/vtc-admin.mjs "$VTC_URL/v1" "$VTC_DID" \
  ~/vti-stack/vtc-admin-credential.json vetter-grant   <persona did>
node ../tsp-reference/ref-20-local-vetting/vtc-admin.mjs "$VTC_URL/v1" "$VTC_DID" \
  ~/vti-stack/vtc-admin-credential.json vetter-resend  <persona did>
```

**The resend is not optional in practice.** A grant issued while the app is
busy elsewhere is not picked up, and the ceremony then fails at
*publish profile* with the vetter looking perfectly healthy. Issue, then
resend, then run.

**Force-stop the app between the invite rung and the ceremony.** The invite
leaves the phone on its result screen, and the vetting runner starts by looking
for controls that screen does not have.

## Known open

- **`E2E_FRESH_PERSONA=1` is not a working mode.** Forgetting the community
  mid-session left the iOS app reporting
  `[TrustTasks:VtiMediatorTransport] socket failed to open` on the My Agent
  screen, and it did not recover for the rest of the run — the vetter's desk
  stayed empty because nothing was ever sent. A fresh app launch recovered it,
  and the next run minted a brand-new persona without trouble. So the phone
  does not re-open its mediator socket after the persona it was using is
  dropped underneath it; that is ours, not upstream's, and it is the reason the
  flag is documented here rather than recommended.
- The mint itself is **not** the coin flip an earlier version of this section
  claimed. Two consecutive runs passed, the second from no persona at all. The
  earlier failures were the fresh-persona path above, not tunnel latency.
- An invitation cannot be delivered by QR (VTI-32), so the vetter must be
  Android until invite-by-reference exists upstream.
