# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Keyring — a React Native (0.81, React 19) mobile wallet for decentralized identity and verifiable credentials, built on a fork of OpenWallet Foundation's Bifold and the Credo-TS agent framework. The signature feature is the VRC (Verifiable Relationship Credential) module: peer-to-peer relationship credential exchange, optionally witnessed and backed by biometric hardware attestation (Secure Enclave / StrongBox).

## Repo layout

Two-level monorepo, one repository:

- `app/` — the only yarn workspace. Keyring-specific mobile app: screens, `keyring-theme/`, localization, errors framework, and agent/container configuration. Native projects live in `app/android` and `app/ios` (workspace `AriesBifold.xcworkspace`, scheme `AriesBifold`).
- `bifold/` — the framework (a fork of OpenWallet Foundation's bifold-wallet), **part of this repository** since the fold of 2026-11; it was the `keyring-bifold` git submodule before, and that history is on the `history/bifold` ref here (`git log origin/history/bifold -- bifold/<path>`). A graft that lets `git log --follow` and `git blame` cross the fold is planned as a `refs/replace/*` ref (Phase 1 of `docs/plans/single-codebase-plan.md`, pushed only on the product owner's word, with an explicit refspec since replace refs are not fetched or pushed by default and GitHub's UI does not show them); until it is pushed, there is nothing to fetch. It keeps its own `yarn install` and build under `bifold/` for now; one dependency tree is Phase 2 of `docs/plans/single-codebase-plan.md`. Core framework packages under `bifold/packages/`: `core` (UI, navigation, tsyringe DI container in `container-api.ts`/`container-impl.ts`, VRC module at `src/modules/vrc`), `witness-server` (standalone Node.js witness service), `mediator-server` (a local DIDComm mediator so a developer can run the app without shared infrastructure — `yarn mediator` at the repo root), `react-native-attestation`, `oca`, `verifier`, `vrc-contexts`, `vrc-reference` (reference implementation + conformance tests), `vrc-shared` (server-side helpers — NOT for the mobile app, see its README), `trust-tasks` (platform-neutral Trust Task plumbing shared by the wallet and the witness-server: document proofs/digests, the binding-0.2 carriage message, the payload validator — no Node-only or RN-only imports allowed), `remote-logs`.
- `e2e/` — standalone npm package (deliberately outside the yarn workspaces) with Appium two-device tests.

`@bifold/*` dependencies resolve to `bifold/packages/*` via `portal:` resolutions in the root `package.json` (a NEW `@bifold/*` package the app must bundle needs four entries: a root `portal:` resolution, an `app/package.json` dependency, a `packageDirs` entry in `app/metro.config.js` — Metro only resolves files inside its watch folders — and, for dev hot-reload from source, `BIFOLD_SOURCE_PACKAGES` there) — source changes in `bifold/packages/*` are picked up without a build step in dev. `yarn install` at the root runs `scripts/ensure-bifold-ready.js` (install + build the bifold packages) as preinstall and `scripts/fix-portal-symlinks.js` as postinstall. There is no `git submodule` step anywhere; a change to a bifold file is an ordinary commit in this repository, and a range's `git diff` carries `bifold/…` paths like any other. A checkout from before the fold has `bifold/` as an initialised submodule and cannot plain-checkout `main` ("untracked working tree files would be overwritten"); `README.md`, "Moving an existing checkout to the folded `main`", is the recipe (check bifold's status, stashes and whether its HEAD is on a remote; keep `.git/modules/bifold`; remove only the working folder; check out; `yarn install`).

Dependency patches live in two places: `.yarn/patches/` (applied via `patch:` protocol in root resolutions — credo-ts, react-native, expo-secure-environment, etc.) and `app/patches/` (patch-package, applied by `app` postinstall).

## Commands

Node `>=20.19.2 <21`, Yarn 4.9.2 via corepack. Install from the repo root: `yarn install`.

From the repo root:

```sh
yarn lint          # eslint (runs in app/)
yarn typecheck     # tsc --noEmit (runs in app/)
yarn test          # jest (runs in app/)
yarn prettier      # check; yarn prettier:fix to write
```

Single test (jest): `cd app && TZ=GMT yarn jest path/to/file.test.ts` or `yarn test -t "test name"`. Bifold packages have their own suites: `cd bifold/packages/core && yarn test` (the VRC module tests are the contract for upgrade work).

Each bifold package's test gate is whatever its own `package.json` defines (usually `yarn test` → `jest`) — don't substitute an ad-hoc `tsc --noEmit` run in a package's directory as a sanity check. That surfaces whatever the package's local `node_modules` happens to look like right now, which can diverge from `yarn.lock` (e.g. a stale hoisted-vs-nested duplicate dependency left by a prior partial install) and produce errors that are a linker artifact, not a code regression — a plain `yarn install` may not clean it up; deleting the stale nested copy under that package's `node_modules` usually does. If in doubt, run the package's `test` script and the root `yarn typecheck`; nothing else.

`bifold/packages/react-hooks` specifically: its jest config is plain `ts-jest` and does **not** transform `@credo-ts/*`'s ESM builds — unlike `core`, which uses the React Native preset + babel + a broad `transformIgnorePatterns` allowlist for exactly this. When writing tests here that touch providers/hooks importing `@credo-ts/core` or `@credo-ts/didcomm`, `jest.mock(...)` those modules with minimal fakes rather than importing them for real or trying to extend this package's jest/babel config to match `core`'s.

Run the app. It needs a reachable DIDComm mediator, and `yarn mediator` at the repo
root starts a local one and writes its live invitation into `app/.env` (creating that
file from `.env.sample` if needed) — leave it running. Pass
`--endpoint http://10.0.2.2:3010` for Android emulators or
`--endpoint http://localhost:3010` for an iOS simulator to skip the cloudflared tunnel;
see `bifold/packages/mediator-server/README.md`.

```sh
yarn mediator                  # in its own terminal, first

cd app
yarn ios:setup && yarn ios     # iOS (pod install, then build+launch)
yarn android                   # Android
yarn start                     # Metro, if it doesn't start automatically
```

E2E (Appium, two devices; binaries must be built first — see `e2e/README.md` for build recipes and setup):

```sh
yarn e2e:vrc            # Android emulator + iOS simulator, unattended
yarn e2e:vrc:devices    # physical phones — the only way to prove hardware attestation (attended)
yarn e2e:migration      # Askar 0.2→0.6 store-migration test
yarn e2e:smoke          # single-device onboarding smoke test
```

Note: emulators/simulators cannot do hardware attestation — the app silently falls back to a plain exchange. Attestation paths are only proven by `e2e:vrc:devices`.

## Commit conventions

- Conventional commits enforced by commitlint: `feat|fix|docs|style|refactor|perf|test|chore|revert`, lower-case type.
- Every commit carries a `Signed-off-by:` trailer as the **last line** of the message (commitlint rejects anything after it), naming the commit's own author — i.e. your configured `user.name` / `user.email`, the same as `git commit -s` produces. A sign-off is an attestation by whoever made the commit, so never sign off as another contributor. Do not add agent co-author or "generated with" lines to commits or PR descriptions.
- For message-only rewrites, use `git commit-tree -S` (SSH signing) to keep commits Verified; fallback `git commit -S -F msg.txt` with `HUSKY=0`.
- Every commit on `main` must also be cryptographically signed and verified by GitHub — enforced by the "Main" ruleset and by the `commit-checks` CI workflow. `.husky/pre-commit` only checks that `commit.gpgsign` is enabled locally, since a hook can't see the signature itself (git signs after hooks run). The hooks under `bifold/.githooks` are the former submodule's and are not installed.

## Ongoing upgrade work

`UPGRADE_PROGRESS.md` at the root is the authoritative hand-off document for the upstream sync effort (RN/React/credo-ts upgrades, VC 2.0 issuance, bifold "branch swap" strategy). Read it before touching upgrade-related work, and update it at phase gates. Related design docs live in `docs/` (e.g. `HARDWARE_ATTESTATION_FLOW.md`, `CRYPTO_SUITE_FOLLOWUP.md`).

## Planning documents

`docs/plans/` holds plans for workstreams that are not yet in code. Each plan is one file plus a companion folder of dated, attributed review documents.

The active one is **`docs/plans/openvtc-integration-plan.md`** — aligning Keyring with the OpenVTC / First Person Project ecosystem: TSP as transport, Trust Tasks as the operation layer, and the VRC/witness/attestation work moving onto both. Read it before touching TSP, Trust Tasks, a VRC-exchange recast, or PNM/CNM. It owns two subtask plans, both under `openvtc-integration-plan/`: `trust_tasks_subtask.md` carries the VRC/witness detail and per-step acceptance criteria, and `pnm_cnm_subtask.md` carries the PNM/CNM client — how PNM commands reach a VTA, the client architecture, and its phases.

`docs/plans/CLAUDE.md` covers how these documents are written — read it before editing one, and note that plans state current design in the present tense while reasoning and superseded positions live in the dated companions.

## OpenVTC/TSP upstream clones

The OpenVTC integration work (see Planning documents above) reads real
upstream source, not just documentation. Those repos live in `external/`
(gitignored), cloned and pinned to exact commits by `node
scripts/openvtc/setup-external.mjs` — see the `openvtc-workspace` skill and
`scripts/openvtc/README.md` for the full setup/sync workflow.

**Before reading any upstream source as ground truth, confirm you're reading
`external/`'s pinned clone, not some other checkout of the same repo that
happens to exist on the machine.** A sibling clone elsewhere is not managed
by the pin tooling and can silently sit on any commit, including one older
than the pin — this has actually happened, produced a wrong conclusion, and
took a user catching it to surface (see `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`'s
correction section). If `external/` doesn't have the clone yet, run
`setup-external.mjs` rather than reaching for one elsewhere.

## Proving VTI work, and watching upstream

The `vti-lab-and-field` skill covers how VTI/vetting work is proven — the local
stack we own versus the VTA Farm we don't, which claims each one can support,
how a fixture deviation gets declared, and the practice of watching the
upstream repos for changes that land obligations on us. Read it before running
a VTI e2e, standing up the local stack, or recording anything in
`docs/VTI_UPSTREAM_FINDINGS.md`.

## CodeGraph

A CodeGraph MCP index (`.codegraph/`) is configured for this repo — prefer `codegraph_*` tools over grep for structural questions (symbol definitions, callers, impact analysis).
