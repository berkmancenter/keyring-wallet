# Reviewing the consolidated upgrade PR

A runbook for reviewing [`upgrade/consolidated-vc2-di`](https://github.com/berkmancenter/keyring-wallet/pull/17)
(keyring) and its paired branch of the same name in
[keyring-bifold PR #31](https://github.com/berkmancenter/keyring-bifold/pull/31).

This PR is large by design — it consolidates a framework upgrade and three
credential features into one reviewable unit. This guide is meant to turn that
into "run these commands, confirm these claims" rather than "read every file."

---

## 1. What this PR is (and isn't)

**Is:** a single consolidated upgrade covering

- **Platform:** React Native 0.81, React 19, credo-ts 0.6.3 (bumped bifold to 3.0.16)
- **VC 2.0 issuance** with a `DataIntegrityProof` using the **`eddsa-rdfc-2022`** cryptosuite
- **RCE v3** — the Relationship Credential Exchange protocol, now Data-Integrity-capable
- **Witnessed exchange** — session handshake + VP submission + witness cross-distribution of the VWC
- **Hardware attestation** hardening — multi-root Google trust anchors (see §6)
- **Mediator message pickup** switched to live-mode WebSocket delivery (see §5)

**Isn't:** a behavior change to the existing non-witnessed, non-attested VRC happy
path — that flow is meant to be unchanged. The perf item in §7 is known and tracked,
not introduced blindly here.

**Why one PR:** the framework bump and the features are entangled (credo 0.6's KMS
and DIDComm module split touch the same code the DI/witness work lands in), so
splitting them would create branches that don't independently build or pass CI.
The two repos move together: keyring pins bifold via the submodule pointer, so
review them as a pair.

---

## 2. Setup

Requirements: **Node `>=20.19.2 <21`**, **Yarn 4.9.2** via corepack.

```sh
# submodule + install (preinstall builds bifold, postinstall fixes portal symlinks)
git submodule update --init --recursive
yarn install

# app env — copy the sample and point DIDCOMM_MEDIATOR_URL at a reachable mediator
cp app/.env.sample app/.env
```

`@bifold/*` resolves to the `bifold/` submodule via `portal:` resolutions, so source
changes there are picked up without a separate build step in dev.

---

## 3. Static gates (fast, no devices)

Run from the repo root:

```sh
yarn lint          # eslint (app)
yarn typecheck     # tsc --noEmit (app) — also proves the bifold packages build
yarn test          # jest (app)
yarn prettier      # format check (yarn prettier:fix to write)
```

Then the **bifold VRC contract suite** — this is *the* behavioral contract for the
VRC module and the most important test signal in the whole PR:

```sh
cd bifold/packages/core && yarn test
```

> Note: `yarn typecheck` depends on the bifold packages building cleanly (the
> topological build produces each package's type declarations). If it fails with
> `Cannot find module '@bifold/…'`, a bifold package failed to compile — check the
> install log for the first `error TS…`, not the resolution error itself.

Single test, when chasing one thing:

```sh
cd app && TZ=GMT yarn jest path/to/file.test.ts
```

---

## 4. E2E ladder — what each command proves (and can't)

E2E lives in the standalone `e2e/` package (outside the yarn workspace). Binaries
must be built first — see [`e2e/README.md`](../e2e/README.md) for build recipes and
device/emulator setup. Run these from the repo root:

| Command | Proves | Devices |
|---|---|---|
| `yarn e2e:smoke` | Onboarding works end-to-end | 1 (unattended) |
| `yarn e2e:migration` | Askar **0.2 → 0.6** store migration (upgrade-critical) | 1 (unattended) |
| `yarn e2e:vrc` | Full VRC exchange, both directions | Android emulator + iOS sim (unattended) |
| `yarn e2e:vrc:devices` | VRC exchange **with hardware attestation** | 2 physical phones (attended) |
| `yarn e2e:vrc:witnessed:devices` | VRC exchange with attestation **and** witnessed shields | 2 physical phones + witness (attended) |

**The critical caveat:** emulators and simulators **cannot do hardware attestation**.
`yarn e2e:vrc` silently falls back to a plain, non-attested exchange — a green run
there does **not** prove the attestation path. Only the `:devices` runs do.

**When running the `:devices` flows:**

- **iPhone Face ID matters.** The attestation gate keys off the biometric prompt —
  if you miss/deny Face ID, the exchange silently falls back to plain VRC. Prioritize
  the iPhone prompt.
- **Witness is reached over HTTPS only** (see §6). The witnessed run stands up a
  cloudflared HTTPS tunnel to a local witness — no account needed; recipe in
  `e2e/README.md`.

---

## 5. Feature verification

**Data Integrity / VC 2.0.** A witnessed credential (VWC) should carry a
`DataIntegrityProof` with `cryptosuite: "eddsa-rdfc-2022"`. The `eddsa-rdfc-2022`
suite adapter lives in
`bifold/packages/core/src/modules/vrc/services/EddsaRdfc2022DataIntegritySuite.ts`;
its sign/verify round-trip is exercised by the `core` test suite, so a green
bifold suite (§3) confirms the cryptosuite without needing a full two-device flow.

**The two contact shields** are the fastest visual confirmation on-device:

- **Secure Exchange** (`AttestationVerified`) — peer hardware attestation verified.
- **Verified / Witness Records** — the exchange was witnessed and a VWC was distributed.

A fully-proven `:witnessed:devices` run shows **both** shields on the contact.

**Message pickup.** The wallet no longer polls the mediator on a timer. It now uses
`PickUpV2LiveMode` — a persistent secure WebSocket the mediator pushes to on arrival
(`app/src/hooks/useBCAgentSetup.ts`). Reviewers should confirm the mediator being
used advertises a `wss` endpoint; the previous batch-pickup + trust-ping polling loop
is gone.

---

## 6. Security invariants — do not let these regress

- **No cleartext on Android.** The app must not permit cleartext HTTP traffic; the
  Android network-security config stays locked down. Any witness/mediator/service the
  app talks to must be **HTTPS/WSS**.
- **Witness over HTTPS only.** The production model reaches the witness over TLS. The
  E2E tunnels HTTPS precisely so we never relax the cleartext rule to test.
- **Multi-root trust anchors.** Attestation chains are validated against the full set
  of Google roots — **legacy RSA, re-signed RSA, and the new RKP ECDSA root** — not a
  single hard-coded anchor. The historical single RSA root expired **2026-05-24**, and
  newer devices provision via Remote Key Provisioning (ECDSA), so dropping any root
  breaks a class of devices. See [`docs/HARDWARE_ATTESTATION_FLOW.md`](./HARDWARE_ATTESTATION_FLOW.md).

---

## 7. Known limitations / non-blocking

- **DIDComm perf regression since 0.6.** Exchanges run a few seconds slower than pre-
  upgrade, localized to credo 0.6's per-message KMS path (not the mediator). Tracked in
  **keyring-wallet #16**; non-blocking for this PR.
- **Attestation needs real devices.** Emulators fall back to plain exchange (see §4).

---

## 8. Suggested review order

1. **`UPGRADE_PROGRESS.md`** (repo root) — the authoritative hand-off for the upgrade
   effort; read it first for context and the branch-swap strategy.
2. **bifold PR #31, VRC module** (`bifold/packages/core/src/modules/vrc`) — the
   substance of RCE v3, the DI suite, and the witnessed manager live here; the
   `core` test suite is the contract.
3. **keyring agent wiring** — `app/src/utils/bc-agent-modules.ts` and
   `app/src/hooks/useBCAgentSetup.ts` (module config, pickup strategy).
4. **Attestation** — `app/src/services/attestation.ts` +
   `docs/HARDWARE_ATTESTATION_FLOW.md`, cross-checked against §6.
5. **The static gates and the E2E ladder** above, to confirm the claims land.
