# A new phone is a new device, and persona keys stay in the agent

**Status:** proposed for release 226 (issues #10 and #4). Owners: the Prague lane (agent and crypto side) and the UI/UX lane (screens and flow).
**Companions:** [2026-09-28-al.md](./new-phone-new-device-plan/2026-09-28-al.md), with the reasoning, the upstream reading and the PNM-parity gap list.

## What this plan is for

A person's identities live in their agent (VTA), not in their phone. When they get a new phone, the new phone is linked as a new device. The old phone can be removed, but it's never removed without their say. No phone keeps a persistent copy of a persona's private key.

Upstream's own clients already work this way:
- openvtc links a new install as a new ACL entry;
- it lists devices with when each was last seen;
- it offers, but never preselects, removing an old one;
- it fetches persona keys into memory only.

VTI's custody rule is VTI-VTA-002/003: performing an operation is the norm, and an exported key "stays with whoever holds it after their authority is withdrawn".

Today Keyring departs from that in one place. When it mints a persona, it exports both of its private keys (signing and key agreement) and stores them in the phone's key store (`VtaClient.ts` `borrowKey`, via `keys/export-secret`). Revoking or wiping that phone doesn't stop those copies from acting as the persona.

## Design

### A. Link the new phone as its own device

- The new phone links exactly as a first phone does today (enrolment page or manual link). It gets its own admin ACL entry with its own device key. The old phone's key is never moved.
- After linking, the phone registers itself with `device/register/0.2`: a display name the person can read ("Sam's iPhone") and the platform.
- It then sends `device/heartbeat/0.2` while it runs, so other devices can see when it was last seen.
- If the old phone is at hand, it can grant the new one. If it isn't, the new phone links through the same page an operator uses for a first link. No new recovery channel is added in this release.

### B. See your devices and remove an old one

- A **Devices** screen lists every device from `device/list/0.2`: its name, platform, last seen, and this phone marked "this phone".
- On any other device the person can choose:
  - **Remove access:** `acl/revoke` of that device's entry;
  - **Disable:** `device/disable/0.1`;
  - **Wipe:** `device/wipe/0.2`. The wipe takes effect only when the device next checks in, and the screen says so.
- Nothing is preselected, and no device is removed by default.
- After a new phone links, Keyring offers this screen once. It stays reachable from Settings.

### C. Persona keys stay in the agent

- **Signing goes through the agent.** Every signature a persona makes goes through `keys/sign/0.1`: vetting cards, eligibility presentations, vetting statements, trust-task requests signed as the persona, and approval replies.
  - The request carries the persona's key id and the bytes to sign (base64url), and the VTA returns the signature.
  - Keyring's proof code already signs a hash through one signer function (`packages/trust-tasks/src/documentProof.ts`), so the change is a signer that calls the VTA instead of the phone's key store.
  - `vault/sign-trust-task/0.2` is the alternative for whole trust-task documents. `keys/sign` is used because it covers every proof Keyring makes.
- **Key agreement stays on the phone, in memory only.** No VTA task decrypts or agrees a key on a persona's behalf. Upstream says a holder "has to hold that DID's private keys to decrypt … It cannot delegate that per-frame" (`vta-sdk/src/trust_tasks.rs:288-294`). So the persona's key-agreement key is fetched with `keys/export-secret` when a session starts and held in memory. It's never written to the key store, and it's dropped when the app is locked or closed. This is what openvtc does.
- **Signing keys are never exported again.** Once signing goes through the agent, Keyring stops exporting persona signing keys. It sets them non-exportable with `keys/set-exportability/0.1` (the "lock-down" step), so no device can take one later.

### D. A lost phone

1. Remove the lost phone's access (B) first.
2. Then rotate the persona's keys on the agent (`webvh/dids/rotate-keys`).

The rotation invalidates any copy the lost phone held, including a key-agreement key it had in memory at that moment. Rotation keeps the persona's verification-method ids only from VTI `83492acf` (#1734) onwards; an older VTA renumbers them and breaks existing relationships. Keyring offers rotation only when the agent is new enough, and otherwise tells the person their agent needs an update first.

### E. Existing installs

Phones installed before this release hold persistent copies of both persona keys. On first start after upgrading, Keyring:
1. deletes every persistent persona-key copy from its key store;
2. switches signing to the agent;
3. fetches key-agreement keys into memory as in C;
4. registers the phone as a device (A).

This needs no network step beyond the next session, and nothing is lost: the agent holds every key. The copies deleted from this phone can't be recalled from other phones or backups that already hold them. The Devices screen explains that, and offers rotation (D) to anyone who wants certainty.

## Who does what

| Part | Prague lane (agent and crypto) | UI/UX lane (screens and flow) |
|---|---|---|
| A | `device/register` and `heartbeat` in `VtaClient`; a device key per install | link flow wording; device name prompt |
| B | `device/list`, `acl/revoke`, `device/disable`, `device/wipe` calls | the Devices screen; the one-time offer after linking |
| C | a VTA signer for the proof code; in-memory key-agreement keys; set-exportability | the "your agent signs for you" explanation; offline behaviour |
| D | the rotate-keys call; the VTA version check | the lost-phone path and its words |
| E | the migration and deletion of copies | the one-time notice |

## Feasibility on the stacks

| Task | Our lab (VTI `63d4c0ca`) | Farm VTAs |
|---|---|---|
| `keys/sign/0.1` | yes | yes: since 2026-08-01 (`89a53912`), before `ed672fff` |
| `device/register`, `list`, `heartbeat` 0.2; `vault/sign-trust-task/0.2` | yes | yes: since 2026-06-07 (`caa3a67a`) |
| `device/wipe/0.2` | yes | yes: since 2026-08-27 (`d582a9de`) |
| `acl/revoke`, `keys/set-exportability/0.1` | yes | yes |
| rotate-keys keeping method ids (`83492acf`) | yes | unknown: the Farm VTAs' commit isn't published (openapi fingerprint `09f1032b600d`) |
| remote key agreement or decrypt | no task upstream | no task upstream |

## Costs

- **Latency:** every persona signature is one round trip to the agent. The vetting ceremony signs several documents, and each step gains about the time of a trust-task call.
- **Offline:** signing as a persona needs the agent to be reachable. Messages can still be read offline for the session.

## Acceptance

- **A:** a second phone links to the same agent; both appear in the Devices list with names and last-seen times.
- **B:**
  - removing the old phone's access makes its next agent call fail with an ACL refusal;
  - nothing is preselected;
  - a wipe is shown as pending until the device checks in.
- **C:**
  - after a fresh install and a full vetting ceremony, the phone's key store holds no persona private key, which a test checks;
  - every persona proof verifies against the persona's published key;
  - `keys/export-secret` is never called for a signing key.
- **D:** on the lab, rotating after removal leaves existing relationships verifiable (method ids unchanged), and the removed phone's old key no longer verifies.
- **E:** an upgraded install that held copies ends with none, and still joins, vets and messages.
- **Gates:**
  - the 226 lab gate, including the TUI interop legs, passes with A–E in;
  - CI is green;
  - Farm runs when the Farm permits.
