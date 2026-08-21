# ref-06p5 — App Attest / Play Integrity binding to the locality transcript

The locality transcript ([`ref-06p`](../ref-06p-locality-binding/)) is signed
by the device's hardware-attestation key. Plan §5.4 says integrity
attestation, when present, should cover that *same* binding — App Attest's
`clientDataHash` and Play Integrity's `requestHash` set to the same five
values the transcript itself commits to, so the attestation is about *this*
action, not a generic "app is genuine" statement. This rung verifies that
claim against a real platform root, for the one platform where that's
possible offline.

**15 checks, all against a real Apple-signed attestation object.**

## Split down the middle, and why

**App Attest can be verified fully offline.** The attestation object's
certificate chain roots in a certificate Apple publishes at
`https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem`
— given that root and the object, the whole chain is checkable with nothing
but `node:crypto`. So this rung does that, for real, against a real captured
attestation.

**Play Integrity cannot be verified offline, at all, with or without test
data.** Its tokens are encrypted; decoding one is a live call to
`playintegrity.googleapis.com` with a registered Play Console app and Google
Cloud service-account credentials. There is no sample token that stands in
for this the way a frozen fixture stands in for App Attest's — it's a
live-service dependency, not a missing artifact. So Play Integrity gets two
things instead of one: a **shape-only** consistency check here (act 5, same
spirit as [`ref-06p3`](../ref-06p3-third-party-verify/)'s step 7), and
[`live-play-integrity-optional.mjs`](./live-play-integrity-optional.mjs) — a
separate script, parked and clearly labeled, that does the real thing the
moment that access exists.

## Where the real attestation object came from

`fixtures/attestation-development.json` and `attestation-production.json`
are vendored, unmodified, from
[`uebelack/node-app-attest`](https://github.com/uebelack/node-app-attest)
(`f16c4bb`, MIT), a real npm package this rung depends on for the
verification logic itself. Both fixtures are **real, Apple-signed
attestation objects** captured from an actual iOS device running the
author's own test app (`io.uebelacker.AppAttestExample`, team
`V8H6LQ9448`) — not synthetic data, and not something this rung generated.
That App ID is baked into the leaf certificate's RP-ID-hash extension by the
device that made it; it cannot be swapped for Keyring's own App ID without a
new capture, which needs a real device this environment doesn't have.

**Due diligence on the root, done as a runnable check, not asserted:** act 0
fetches Apple's root CA directly over HTTPS (`curl`, not a
summarizing/AI-mediated fetch — one was tried while building this and it
silently corrupted a handful of base64 characters mid-certificate, which
would have gone undetected if the "citation" had been trust-the-fetch rather
than compare-the-fingerprint) and pins its SHA-256 fingerprint
(`1C:B9:82:...`). `node-app-attest` doesn't export its internal root for a
direct byte comparison, so act 1's real chain successfully verifying is
itself the confirmation that its hardcoded root is the same certificate.

## What it proves

- **A real Apple-signed attestation verifies against Apple's real public
  root, offline.** Both environments (development and production —
  `node-app-attest` treats them as distinct `aaguid` values in `authData`).
- **Four independent forgeries, each caught by a different check**: the
  attestation object itself, the challenge (breaks the nonce
  reconstruction — the exact mechanism that binds the attestation to a
  specific action), the keyId, and the App ID.
- **The Keyring-specific wiring is real, even though the round trip isn't.**
  `bindingFor()` — identical to `ref-06p`'s §5.3 binding — produces the
  exact bytes that would be passed as App Attest's `challenge` (which the
  library SHA-256s itself into `clientDataHash`; see
  `node_modules/node-app-attest/src/verifyAttestation.js` step 2). Mutating
  any of the five fields changes the resulting hash. And substituting our
  own binding as the `challenge` against the *real* fixture correctly
  fails — proof `verifyAttestation()` is actually reading the bytes, not
  rubber-stamping shape. What it does NOT do is show a real device
  attesting to *our* binding — that needs Keyring's own app, on real
  hardware, calling `attestKey()`. This rung proves the wiring is correct;
  it does not (cannot, without that device) prove the round trip.
- **The `absent` path completes, with the state recorded, never inferred.**
  No attestation offered → `"absent"`; an attestation present but not yet
  checked → `"present-unverified"`; the real check ran and passed →
  `"verified"`. Three explicit states, matching §7.1's own three-valued
  field — nothing throws, nothing blocks, when there's simply nothing to
  check yet.

## What it does NOT prove

- **No real round trip with Keyring's own binding.** As above — the real
  fixture proves the mechanism; it was never signed over data this rung
  produced.
- **No real Play Integrity verification.** Shape-only here; genuinely
  possible only via `live-play-integrity-optional.mjs`, and only once real
  Play Console + Google Cloud access exists.
- **No BLS/BBS+, no radios.** Unrelated axes, covered by other rungs.

## Fixtures

- `fixtures/apple-app-attestation-root-ca.pem` — Apple's real, current App
  Attest root CA, fetched directly (2026-08-21).
- `fixtures/attestation-development.json`, `attestation-production.json` —
  real captured attestation objects, vendored from `uebelack/node-app-attest`
  (MIT, `f16c4bb`), unmodified.
