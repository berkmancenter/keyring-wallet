# Demo runbook — the witnessed relationship exchange (Trust Task dialect)

What a human drives on two phones to show the full Keyring flow: one-tap
relationship consent → hardware-attested, witnessed credential exchange →
both contacts marked *Witnessed + Secure Exchange*. Rehearsed green on real
devices (Samsung + iPhone) on 2026-08-20; the automated equivalent is
`yarn e2e:vrc:witnessed:devices`.

## Before the day

| Check | Why it bites |
|---|---|
| **Rebuild the iOS device app after ANY JS change** — `cd app/ios && FORCE_BUNDLING=1 xcodebuild -workspace AriesBifold.xcworkspace -scheme AriesBifold -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath build/device-dd DEVELOPMENT_TEAM=947XHQ9DVC -allowProvisioningUpdates build` | The device build bundles its JS; a stale build silently demos old behaviour. |
| Android debug APK installed; Metro running on the laptop (`cd app && yarn start`) with `adb reverse tcp:8081 tcp:8081` to the phone | Android debug loads JS from Metro. For a laptop-free demo use a release APK. |
| A witness reachable over HTTPS — the e2e starts one behind a cloudflared tunnel (`e2e/lib/witness.js`); a hosted witness works the same | Without a connected witness the exchange completes **unwitnessed** (no Witnessed badge) — by design, silently. |
| Mediator reachable (`credo-mediator.asml.berkmancenter.org`) | Everything transits it; 10 s pickup polling sets the pace. |
| Both phones: screen lock off or timeout ≥ 5 min, biometrics enrolled | The wallet locks after 5 min idle; the biometric prompt needs an enrolled finger/face. |

Reset between runs: uninstall/reinstall both wallets (fresh onboarding is the
cleanest story), or delete the contact on both sides.

## The flow, with what appears on screen

| # | Phone A (will be the *inviter*) | Phone B | What the audience sees |
|---|---|---|---|
| 1 | Onboard (PIN, name, R-Card) | Onboard | Two fresh wallets with contact cards. |
| 2 | Settings → Hardware attestation **on** (PIN) | same | "This exchange will be hardware-attested." |
| 3 | Add contact → paste/scan the **witness** invitation | same | Witness appears as a contact; banner "Witnesses — e2e-witness active". |
| 4 | Contacts → **+** → show the relationship QR / invitation | Scan / paste it | Chat opens on both: "You connected with …". |
| 5 | — | — | **Bottom sheet 1 — on ONE phone only**: "*X wants to form a relationship*" with Accept/Decline. Which phone gets it is deterministic (lower connection DID proposes; the *other* one consents) — it may be A or B. **Tap Accept.** This is the one and only consent. |
| 6 | **Biometric prompt** (fingerprint / Face ID) | **Biometric prompt** | Each phone signs its credential with its hardware key. Satisfy both. |
| 7 | Progress overlay at the bottom of the chat, on both phones: *Preparing your relationship credential… → Verifying with witness… → Witness verified. Sending your relationship credential… → Sharing witness record… → Waiting for your contact's credential…* | same | Informational — no action. ~60–90 s total, mostly mediator transit. Clears itself. |
| 8 | Contacts → the new contact → (chat header **⋮ → View Contact**, or the row directly) | same | **Verified / Witnessed** badge, **Secure Exchange** badge, Witness Records (Witnessed by …, date), correct name from the R-Card. |

Talking points at step 8: the badge was *earned* — this phone verified the
peer's witness credential together with the Trust Task outcome evidence
before showing it; the Secure Exchange badge means the peer's credential
carries a hardware-attestation certificate chain this phone re-validated.

## If something looks off

| Symptom | Meaning | Do |
|---|---|---|
| No bottom sheet on either phone after step 4 | The proposal didn't arrive (mediator/pickup lag, or a wallet locked) | Wait 15 s; unlock the wallet if it shows the PIN screen; the sheet appears when the propose lands. |
| Overlay says *Witness unavailable…* or finishes with no Witnessed badge | A phone wasn't connected to the witness at exchange time | Expected fallback (unwitnessed but still attested). Re-do step 3 on that phone and re-run. |
| Contact named *Unknown …abcd1234* | The R-Card hasn't landed yet | Wait a few seconds; it arrives over the legacy leg and auto-accepts. (Hardened 08-20 so the acceptance itself triggers it.) |
| A credential-offer card flashes in the chat | The R-Card offer rendering for an instant | Cosmetic; fixed 08-20 (held until classified). |
| Overlay shows *The exchange took too long* | Hard timeout (lock, network) | Dismiss, unlock both phones, redo from step 4 with a fresh contact. |
| Wallet shows the PIN screen mid-flow | 5-minute inactivity lock | Enter the PIN; the flow resumes. |

## Timing to expect

From the Accept tap to both phones fully verified: **~60–90 s** on the
production mediator (10 s pickup polling × several inbound hops per side
is most of it; the crypto is milliseconds). Adaptive polling during an
exchange is the known lever, parked.
