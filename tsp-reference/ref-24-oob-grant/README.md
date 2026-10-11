# ref-24: the member's VTA signs the grant

The third step of trigger-link sign-in (`auth/oob/*`). After step 2 (ref-23), the member approves on their device. The device's **user-verification (UV) key** signs a `task-consent/decision/0.2` over the digest of the unsigned `auth/oob/grant/0.1`. The member's **VTA** signs the grant as the persona, for `assertionMethod`, only with that decision attached. The wallet carries it in `auth/oob/respond/0.1`, and the browser redeems a session.

One enrolled device signs both identify and grant. That device is the rung client, talking to the VTA over REST with a bearer.

```sh
node run.mjs --portal https://keyring-signin-vtc.ngrok.app \
  --vta-did <member VTA did> --persona <persona did> --entry <did-self-issued vault entry id> \
  --client ~/vti-stack/signin/rung24/client.json --uv-key ~/vti-stack/signin/rung24/uv-key.json
```

## What it does

1. **Gets a bearer and enrols the UV key.**
   - REST pre-session auth at the VTA's `VTARest` service: `auth/challenge/0.1`, then a signed `auth/authenticate/0.2`, which returns a bearer.
   - `device/register/0.2` with `ext["org.openvtc.uv-key"] = {kind:"hardwareKey", did, hardwareBacked:true, biometricGated:true}`.
   - On a re-run the device is already registered, so it sends `device/heartbeat/0.2` with the same `ext`, which replaces the UV key.
2. **Runs a sign-in up to step 2**, as ref-23 does. The difference is that identify is signed through `vault/sign-trust-task/0.2` over REST by this session.
3. **Builds the grant and asks the VTA to sign it.**
   - The grant is `{requestId, decision:"approve", sessionKey, approverKey, origin, contextDigest, notAfter}`.
   - `contextDigest` is `z` + base58btc(`0x12 0x20` ‖ sha256(JCS(signed step 2, proof included))).
   - The UV decision is `{challenge: D, payloadDigest: D, decision:"approve"}`, addressed to the VTA and signed by the UV key for `assertionMethod`. D is the same digest form, taken over the unsigned grant.
   - It goes in `ext["org.openvtc.uv-consent"].decision` of `vault/sign-trust-task/0.2`.
4. **Checks the signed grant**: it must be JCS-equal to the grant sent, with a proof by `<persona>#key-0` for `assertionMethod`.
5. **Sends `respond`**, signed by K_a. The answer must be `approved`, signed by the VTC for `authentication`.
6. **Redeems as the browser** (K_b, with an `Origin` header). It expects a session `{subject, displayName, notAfter, amr}`, with tokens only in cookies.
7. **Negative checks:**
   - A grant without the UV decision gets `vault/sign-trust-task:oobUvRequired`.
   - The same grant id signed a second time gets `oobGrantReplayed`.

**The UV key here is software.** In production it is a biometric-gated Secure Enclave or StrongBox key. Here it is an Ed25519 key in a file, so the enrolment's `hardwareBacked` and `biometricGated` are asserted, not real. The VTA records them as claims (`vta-sdk/src/protocols/device_management.rs:127`).

## Result

**15/15** against the sign-in test bed (`~/vti-stack/signin`), 2026-10-11 07:33Z. It also passed at 07:30Z.

- The VTA-signed grant's `proofPurpose` is **`assertionMethod`**.
- Redeem returned:
  - `subject` = the persona and `displayName` = the persona DID (it has no ACL label).
  - `notAfter` = the grant's `notAfter` (now + 3600).
  - `amr` = `["did","oob","uv"]`.
  - Cookies `vtc_member_session`, `vtc_member_refresh` and `vtc_member_csrf`, with no tokens in the body.
- The VTA reports its refusals as `taskFailed`, with the local code (`vault/sign-trust-task:oobUvRequired`, `:oobGrantReplayed`) in the message.

**Rate limit:** the VTC allows five open codes per address, and a code lives 120 s. Wait about 130 s between back-to-back runs.

## Sources

VTI main `03a3562fe2ee38a327f6da08e9a9bcbd054251f0`:
- `vta-service/src/operations/vault/oob_sign_in.rs`
  - The gate: device binding (464-469), UV decision (606-757), replay marker (486-502).
  - The digest (381-391).
- `vta-service/tests/it/vault_sign_in_oob.rs`
  - Register with the UV key (177-188), the hardware enrolment (203-205), the decision (260-290), the sign call (345-351), heartbeat replacing the key (572-583).
- `vta-sdk/src/protocols/device_management.rs`: an Ed25519 hardware UV key is accepted (247-260).
- `vta-service/src/trust_tasks/auth.rs`: challenge (117-161), authenticate 0.2 (163-215).
- `vtc-service/src/trust_tasks/oob_tasks.rs`: respond (766-950), redeem session and `amr` (1149-1235).
- `vtc-service/src/member_portal/oob.rs`: `context_digest` (725-737).

Spec: trust-tasks-tf `trust-tasks-v0.27.8` (`aaa75db1`), `specs/auth/oob/{grant,respond,redeem}/0.1/spec.md`.
