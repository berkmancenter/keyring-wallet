# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Keyring — a React Native (0.81, React 19) mobile wallet for decentralized identity and verifiable credentials, built on a fork of OpenWallet Foundation's Bifold and the Credo-TS agent framework. The signature feature is the VRC (Verifiable Relationship Credential) module: peer-to-peer relationship credential exchange, optionally witnessed and backed by biometric hardware attestation (Secure Enclave / StrongBox).

## Repo layout

Two-level monorepo:

- `app/` — the only yarn workspace. Keyring-specific mobile app: screens, `keyring-theme/`, localization, errors framework, and agent/container configuration. Native projects live in `app/android` and `app/ios` (workspace `AriesBifold.xcworkspace`, scheme `AriesBifold`).
- `bifold/` — **git submodule** (github.com/berkmancenter/keyring-bifold, fork of bifold-wallet). Core framework packages under `bifold/packages/`: `core` (UI, navigation, tsyringe DI container in `container-api.ts`/`container-impl.ts`, VRC module at `src/modules/vrc`), `witness-server` (standalone Node.js witness service), `react-native-attestation`, `oca`, `verifier`, `vrc-contexts`, `vrc-reference` (reference implementation + conformance tests), `vrc-shared`, `remote-logs`.
- `e2e/` — standalone npm package (deliberately outside the yarn workspaces) with Appium two-device tests.

`@bifold/*` dependencies resolve to the submodule via `portal:` resolutions in the root `package.json` — source changes in `bifold/packages/*` are picked up without a build step in dev. `yarn install` at the root runs `scripts/ensure-bifold-ready.js` (init + build submodule) as preinstall and `scripts/fix-portal-symlinks.js` as postinstall.

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

Run the app (requires `app/.env`, copied from `app/.env.sample`, with a reachable DIDComm mediator):

```sh
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
- Commits in the `bifold/` submodule require `Signed-off-by: Alberto L <aleon@law.harvard.edu>` as the **last line** of the message (commitlint rejects anything after it). Do not add agent co-author trailers to bifold commits.
- For message-only rewrites in bifold, use `git commit-tree -S` (SSH signing) to keep commits Verified; fallback `git commit -S -F msg.txt` with `HUSKY=0`.

## Ongoing upgrade work

`UPGRADE_PROGRESS.md` at the root is the authoritative hand-off document for the upstream sync effort (RN/React/credo-ts upgrades, VC 2.0 issuance, bifold "branch swap" strategy). Read it before touching upgrade-related work, and update it at phase gates. Related design docs live in `docs/` (e.g. `HARDWARE_ATTESTATION_FLOW.md`, `CRYPTO_SUITE_FOLLOWUP.md`).

## CodeGraph

A CodeGraph MCP index (`.codegraph/`) is configured for this repo — prefer `codegraph_*` tools over grep for structural questions (symbol definitions, callers, impact analysis).
