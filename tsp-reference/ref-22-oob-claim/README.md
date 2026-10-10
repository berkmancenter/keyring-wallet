# ref-22: claim a trigger-link sign-in request

Proves Keyring's first step of trigger-link sign-in against a live community. A wallet reads the link, finds the community from its verified DID, claims the request, and checks the community's signed answer.

```sh
node run.mjs                                     # against https://test-vtc.openvtc.net
node run.mjs --portal https://<another portal>
```

Exit 0 when all 15 checks pass.

## What it does

The script plays two parts.

1. **The browser** (a throwaway Ed25519 key, `K_b`):
   - reads `GET /v1/member/sign-in/config`;
   - asks for a sign-in request with `auth/oob/request/0.1`, sent from the portal's origin as the portal does;
   - builds the trigger link exactly as the member portal's bundle does.
2. **The wallet** (a fresh key, `K_a`):
   - reads the link offline;
   - resolves the VTC's `did:webvh` with the log verified (`didwebvh-ts`, Ed25519);
   - takes `TrustTaskHTTPS` and `SignInPortal` from the DID document by type, never from the link;
   - claims with `auth/oob/claim/0.1` (`parentThreadId` = the request id);
   - verifies the answer:
     - an `assertionMethod` proof by a key listed in the VTC's document;
     - it threads to the claim and is addressed to `K_a`;
     - it names this request and this service, with purpose `login`;
     - the origin equals the portal's;
     - the deadline is in the future.
3. **The browser again** sees the request claimed: redeem answers `pending` with the two-digit match number.
4. **Clean-up:** a second claimant is refused (`alreadyClaimed`), and the wallet cancels.

## Result

Run 2026-10-10 23:35Z against test-vtc (VTC `did:webvh:QmNvAiYM…:webvh.storm.ws:test-vtc`, log version 2): **15/15**.

**Two things the run showed:**
- The VTC accepts `auth/oob/request` only with the portal's `Origin` header; without it, 403 `permissionDenied`.
- test-vtc has no display name: `service.name` comes back as the VTC DID.

## Sources

| Source | Read at | Used for |
|---|---|---|
| trustoverip/dtgwg-trust-tasks-tf #738 (`auth/oob` specs) | `12324038` (merged) | Task types, payloads, proofs |
| OpenVTC/vta-browser-plugin #303 (reference reader) | `ae2246a3` (merged) | The checks on the claim answer |
| OpenVTC/verifiable-trust-infrastructure #1998 via #2007 (VTC) | `91c48c67` | Server behaviour |
| The test portal's own bundle | `index-DXJ-wviF.js`, 2026-10-11 | The link format and the browser's request |

`oob.mjs` holds the shared pieces for the next rungs. Signing reuses `../ref-20-local-vetting/di-proof.mjs`, which mirrors `@bifold/trust-tasks/src/documentProof.ts`.
