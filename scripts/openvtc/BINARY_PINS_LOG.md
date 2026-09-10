# Binary pin advance log

One entry per pin advance (written by `fetch-binaries.mjs --advance`). Sibling
to `SYNC_LOG.md`, but for `download.firstperson.dev`'s prebuilt binaries
rather than the git-cloned source repos.

- **2026-09-02** · Initial pins seeded: `vta` 0.23.3, `pnm-server` 0.14.2 — first downloads, proven working end to end (`vta setup --from` non-interactive provisioning + cloudflared rig in `e2e/lib/vta.js`; `pnm health` against it; the `auth/challenge` + `auth/authenticate` DID-auth handshake in `tsp-reference/ref-08-credential-exchange`, accepted first try against Keyring's own `@bifold/trust-tasks` eddsa-jcs-2022 signer). `mediator`, `mediator-setup`, `did-hosting-daemon`, `vtc` downloaded but not yet exercised by anything in this repo — no pinned version recorded for those until something depends on their behavior. Concrete illustration of why this file exists: the developer tutorial (`vti-setup/developer/01-personal-vta.md`) states "Verified with: VTA Version 0.17.0"; the `latest` build downloaded the same day was 0.23.3 — six point-releases of drift the tutorial doesn't know about.

- **2026-09-02** · `vta` 0.23.3 → 0.23.3 — Seed pinnedSha256 for the binary proven working this session (vta setup --from + cloudflared rig; ref-08 auth handshake). (https://download.firstperson.dev/vta/latest/vta)
- **2026-09-02** · `pnm-server` 0.14.2 → db7050f97606 — Seed pinnedSha256 for the binary proven working this session (pnm health against the pinned vta build); pnm has no --version flag so this is the only drift signal available for it. (https://download.firstperson.dev/pnm-server/latest/pnm)