# Testing

Last verified: 2026-11-20 (wallet `969963df`, bifold `a5bfcf3b2`).

How Keyring is tested: the tiers, the command for each, and what CI runs. For
the whole development lifecycle (plan, stacked PRs, review, release) see
[`DEVELOPMENT.md`](./DEVELOPMENT.md). For the release gate itself see
[`RELEASE_GATE.md`](./RELEASE_GATE.md) and [`../e2e/gate/README.md`](../e2e/gate/README.md).

Everything here was checked against the workflow files and GitHub settings on
that date; anything not verified is marked **unverified**. The facts that drift
fastest (which checks are required, how long runs take) are kept together in
[Volatile facts](#volatile-facts-re-check-before-relying-on-them), with the
commands to re-check them; the rest changes only when a workflow file does.

## The tiers

| Tier | What it proves | Run locally | Runs in CI |
|---|---|---|---|
| App unit tests (jest) | `app/` logic and screens | `yarn test` (root), one file: `cd app && TZ=GMT yarn jest path/to/file.test.ts`, by name: `yarn test -t "name"` | Code Quality → Testing |
| Bifold package suites | Each `bifold/packages/*` package, by its own `test` script (`core`, `oca`, `verifier`, `witness-server`, `mediator-server`, `react-hooks`, `vrc-reference`, `credo-tsp-adapter`, `dtg-vocab`, `remote-logs`, `react-native-locality-peripheral`; `trust-tasks` and `vrc-contexts` are covered by `core`'s suites) | `cd bifold/packages/<pkg> && yarn test`; all of them: `cd bifold && yarn test` | bifold Code Quality → Testing (selects a subset on a PR, see below); bifold Full test suite on push to main and nightly |
| Lint, format, types | ESLint, Prettier, `tsc --noEmit` over `app/` | `yarn lint`, `yarn prettier` (`yarn prettier:fix` to write), `yarn typecheck` (root) | Code Quality → Lint+Format+Types |
| Harness and script tests | `e2e/` and `scripts/` `*.test.mjs` / `*.test.sh` (node built-ins, no install), e2e testID manifest, e2e syntax | `node --test <file>`; the list CI runs: `node scripts/ci/find-tests.mjs`; `node e2e/scripts/check-testids.mjs`; OTA scripts: `node --test scripts/ota/` | Lint+Format+Types (parse-check, testIDs, found tests) and Testing (OTA scripts) |
| Native builds | iOS and Android compile, link and bundle | Android: `cd app/android && ./gradlew assembleDebug`. iOS simulator: the `xcodebuild` recipe in [`../e2e/README.md`](../e2e/README.md), "Build the app binaries first" | Test builds |
| E2E (Appium) | Flows across two devices or one | `yarn e2e:vrc` (emulator + simulator), `yarn e2e:smoke` (onboarding), `yarn e2e:migration` (Askar store migration), many variants in root `package.json` (`e2e:*`); build the binaries first and run `yarn mediator`. Full guide: [`../e2e/README.md`](../e2e/README.md) | Not in CI, except the gate legs below |
| Gate legs | The release gate's rows on a pinned CI build | `e2e/gate/gate.sh run --pin <wallet-sha>` (and `rerun`, `nightly`, `dry`, `watch`; see [`../e2e/gate/README.md`](../e2e/gate/README.md)) | Gate smoke (after every green push build of main), Gate OTA (PR, path-filtered), Gate (CI runners) (manual) |
| Post-release smoke | A released OTA bundle, rebuilt and smoked after release; withdraws it on a red smoke | Not run locally | Post-release smoke and Brake watchdog, after each OTA release |
| Device-only (hardware attestation, BLE, background) | Secure Enclave / StrongBox attestation, BLE locality | `yarn e2e:vrc:devices`, `yarn e2e:vrc:witnessed:devices`, `yarn e2e:vrc:witnessed:locality:devices` (attended, physical phones) | Never. Emulators and simulators fall back silently to a plain exchange, so only these runs prove attestation |
| VTI conformance | Upstream's VTI SDK accepts Keyring's Vetting Card and statement | `scripts/openvtc/card-verify/check-keyring-card.sh` (wallet root; `external/` at the pins first: `node scripts/openvtc/setup-external.mjs`). The first run needs `CARD_VERIFY_BUILD=1`, a cargo build of `card-verify` against the pinned VTI that needs more than 14 GB of memory (heavy: follow the shared-machine rules). It checks the card and the vetted/1 statement; CI also runs the 0.47 statement (`card-verify-v047`) and the Trust Task documents, which have no local wrapper. Not run for this page (**unverified** here) | bifold VTI conformance (PR and push, path-filtered; downloads prebuilt Apple-silicon checkers, so it cannot be reused on Linux) |
| Plan structure | Plans in the two-part format: Overview, part markers and banners, numbered precision section, `§` references, Mermaid blocks, mockup paths and their theme-token fingerprints; each linked mockups folder's contact sheet (`sheet.png`) embedded and current with its SVGs and the tokens (a hash compare against `sheet.manifest.json`; regenerate with `kit.ts sheet`); the mockup kit's tokens against the app theme | `node --experimental-strip-types scripts/plans/check-plans.ts` (Node 22.6+, or `bun scripts/plans/check-plans.ts`); tests: `node --experimental-strip-types --test scripts/plans/check-plans.test.ts scripts/plans/mockup-kit/*.test.ts`. Rules: [`plans/CLAUDE.md`](./plans/CLAUDE.md), "Checking a plan's structure" | Plan structure (PR touching `docs/plans/**`, `scripts/plans/**`, the app theme or the framework sources the mockup kit reads, any base) |

Notes:

- Each bifold package's gate is its own `test` script. Do not substitute an
  ad-hoc `tsc --noEmit` in a package directory (root `CLAUDE.md`, "Commands").
- On a shared machine, run one heavy suite, typecheck or build at a time, with
  few workers, and send broad runs to CI. [`RELEASE_GATE.md`](./RELEASE_GATE.md)
  §4 adds: one jest suite at a time, `--maxWorkers=2`.
- Since the one-codebase fold (2026-11-22), the framework's package suites,
  lint and type check run from this repository's own `framework*.yml`
  workflows, with `bifold/` as the working directory ("CI: the framework",
  below); `keyring-bifold`'s own workflows are retired.

## Git hooks

| Hook | Repo | Runs |
|---|---|---|
| `pre-commit` | wallet (`.husky/pre-commit`) | `scripts/check-commit-signing.sh`, `yarn pre-commit-lint` (lint-staged), `yarn typecheck` |
| `pre-push` | wallet | `yarn test` (a plan-only PR is pushed with `--no-verify`; see "Before opening a PR"). Planned under the v1 review: narrow it to the tests related to the push |
| `commit-msg` | wallet | `yarn commitlint` |
| `prepare-commit-msg` | wallet | lefthook's `prepare-commit-msg` |

The wallet's hooks are the only ones since the fold: `bifold/.githooks/` is no
longer installed as a hooks path, and its files go with the plan's Phase 2. The
commit rules themselves (conventional commits, signing, `Signed-off-by:`) are in
the root [`../CLAUDE.md`](../CLAUDE.md), "Commit conventions".

## Before opening a PR

A PR that changes only plans and their assets (Markdown and `mockups/` files
under `docs/`) does not run the app checks locally: run the plan structure
checker instead, push with `git push --no-verify` (the `pre-push` hook runs the
whole app suite), and let CI be the check. Anything else in the PR, including a
script or a workflow, makes it a normal PR. The rule and its limits are in
[`plans/CLAUDE.md`](./plans/CLAUDE.md), "A plan-only PR runs no app tests
locally".

Plans are implemented as stacked PRs into a feature branch, and each PR in a
stack is opened only after lint, format, typecheck, a native build if it
touches native code, and the tests related to the files it changes pass
locally
([`plans/CLAUDE.md`](./plans/CLAUDE.md), "Implementing a plan: stacked PRs").
The PR template ([`../.github/pull_request_template.md`](../.github/pull_request_template.md))
has the stack fields and this checklist.

Code Quality, Commit Requirements, Framework quality, Plan structure and
Framework VTI conformance run on PRs against **any** base branch, so a PR in
the middle of a stack gets the same checks as one into `main`. Only the
`main` ruleset makes them blocking, so on a mid-stack PR a red check is a
signal to fix before review, not a merge block. They run again on the retarget
to `main` (the `edited` event). The path-filtered, non-required workflows (Gate
OTA, Gate smoke's PR trigger, Short invitation links, Push gateway image, pnm,
Dependency cache) still run only on PRs into `main`: they test deploy and
device paths a stack's last PR also reaches, and they do not listen for
`edited`, so after a retarget they run on the next push.

## CI: keyring-wallet (`.github/workflows/`)

| Workflow (file) · jobs | Trigger | What it checks or does | Secrets / environment |
|---|---|---|---|
| Code Quality (`quality.yml`) · Workflow files, Lint+Format+Types, Testing | PR against any base branch, so mid-stack PRs too (opened, synchronize, reopened, labeled, edited) | Workflow files: actionlint, no private files (`*.local-al*`, `*.private.*`), only test builds set `E2E_CLOCKS`. Lint+Format+Types: `yarn prettier`, `yarn lint`, `yarn typecheck` in `app/`, e2e parse-check, testID check, every `*.test.mjs`/`*.test.sh` under `e2e/` and `scripts/`. Testing: `yarn test`, `node --test scripts/ota/` | none |
| Commit Requirements (`commit-checks.yml`) · DCO sign-off and commit signature | PR against any base branch (incl. edited) | Every commit in the PR is signed off and cryptographically signed | none |
| Plan structure (`plans.yml`) · Plan structure | PR against any base touching `docs/plans/**`, `scripts/plans/**`, `app/src/keyring-theme/**`, the framework theme, strings and components the mockup kit reads, or the workflow | The plan checker's and mockup kit's tests (the kit's token test reads the app theme and framework sources under `bifold/`), then the checker over `docs/plans/` (two-part-format files only), which also fails a contact sheet that is stale against its SVGs or the theme tokens | none |
| Test builds (`test-builds.yml`) · heads, ios-simulator, android-apk | PR (any base) touching native, dependency, patch, framework native-module or build-config paths; push to `main` except docs/md/e2e/`tsp-reference`/`scripts/openvtc`/`scripts/roadmap`; manual (`clocks`, `platform`) | Store-configuration simulator app and test APK, uploaded as artifacts for the gate. Builds skipped for PRs from forks | `MEDIATOR_URL`; env `test-builds` |
| Gate smoke (CI runners) (`gate-smoke.yml`) · Which build, iOS smoke, Android smoke | After Test builds completes green on a push to `main` (`workflow_run`); PR touching its own files; manual (`platform`, `run-id`, `wallet-sha`) | The gate's plain-launch smoke rows and the welcome slides on hosted macOS and KVM Android runners; Farm rows SKIP | none |
| Gate OTA (CI runners) (`gate-ota.yml`) | PR into `main` or `spike/ota-hot-updater` touching OTA paths; manual | Throwaway update server behind a tunnel, OTA-enabled Release APK, emulator: apply, crash rollback, withdraw | `MEDIATOR_URL`; env `test-builds` |
| Gate (CI runners) (`gate-ci.yml`) · plan, pnm, leg | Manual (`legs`, `run-id`) | The release gate's Android Farm legs, one at a time, on hosted runners | `GATE_CI_ENV`, `GATE_CI_PNM_HOME_B64`; env `gate-ci` |
| pnm for CI runners (`pnm-linux.yml`) | PR touching its own file; `workflow_call` from Gate (CI runners); manual (`vti-ref`) | Builds the `pnm` CLI for Linux at the Farm's VTI commit (cached) | none |
| Short invitation links (`keyring-links.yml`) | PR into `main` and push to `main`, path-filtered (`deploy/keyring-links/**`, the OTA Caddyfile and compose file, `app/universal-link-site/**`) | `deploy/keyring-links` unit tests and a Caddy validation | none |
| Push gateway image (`push-gateway-image.yml`) · Gateway tests with patches, Gateway image, Mediator image | PR into `main` touching `deploy/keyring-messaging/**`; manual | Builds the push-gateway image, runs its first-run checks, uploads it as an artifact (nothing pushed to a registry) | none |
| Dependency cache (`deps-cache.yml`) | Push to `main` changing `yarn.lock`; PR touching its own file; weekly (Mon 06:17 UTC); manual | Saves the yarn cache Code Quality restores | none |
| Roadmap card status (`roadmap-pr-status.yml`) | `pull_request_target` (opened, reopened, ready_for_review, edited), non-draft | Moves the PR's roadmap cards | `ROADMAP_TOKEN` |
| Staging - Internal Testing Build & Deploy (`staging.yaml`) | Push to `staging`; manual (`audience`, `platform`) | `yarn test --passWithNoTests`, then signed store builds to TestFlight and Google Play, a staging tag, a Slack notice | Apple signing and App Store Connect keys, Play keystore and API credentials, `MEDIATOR_URL`, `MEDIATOR_V2_URL`, `SLACK_WEBHOOK_URL`; env `internal` |
| deploy-to-dev-server (`staging-witness.yaml`) | PR into `staging`; manual (`branch`) | Builds and deploys the witness to the dev server over SSH | `SSH_KEY`; env `development` |
| OTA release (`ota-publish.yml`) · tier, approve, publish | Manual (`action`, `channel`, `dry_run` default true, …) | Publishes, promotes or withdraws an OTA bundle; device-test actions | `HOT_UPDATER_AUTH_TOKEN`, `OTA_SIGNING_KEY_PEM`, `OTA_TEST_SIGNING_KEY_PEM` |
| Post-release smoke (`post-release.yml`) · smoke, brake | After "OTA release" completes (`workflow_run`); also "OTA publish (ring 0)", the name older release and hotfix branches still give it | Rebuilds the released commit, runs Gate smoke on it, lists changed screens; Brake withdraws the release on a red smoke | `HOT_UPDATER_AUTH_TOKEN`; env `ota` |
| Brake watchdog (`brake-watchdog.yml`) | After Post-release smoke completes, unless it succeeded or was skipped | Withdraws a smoke-red release whose Brake job never ran | `HOT_UPDATER_AUTH_TOKEN`; env `ota` |
| Promote Android build (`promote-android.yml`) | Manual (`dry_run` default true, `version_code`, `rollout`) | Promotes a Play build from internal to open testing (beta) | `GOOGLE_API_CREDENTIALS_BASE64` |
| OTA fingerprint (diagnostic) (`ota-fingerprint.yml`) | Manual | Computes the native fingerprint as store builds and the OTA publisher do, fails unless they agree | none |

Shared composite actions live in `.github/workflows/actions/` (`setup-node`,
`create-ios-sig-creds`, `export-ios-archive`, `ship-to-itunes`); there is no
`.github/actions/` directory.

Observations:

- Post-release smoke also listens for "OTA publish (ring 0)". No file on `main`
  has that name, but an OTA release runs from the release or hotfix branch it
  fixes and takes its name from that branch's copy, and `release/244`–`250` and
  the hotfix branches cut from them still use it. The name stays while those
  store builds can receive an update (the comment in `post-release.yml` says so).
- A `k0k3-keri-kit` workflow (`.github/workflows/k0k3-keri-kit.yml`) is
  registered and has push runs, but the file is not on `main`: it lives on
  another branch (which one is **unverified**) and is not covered here.

## CI: the framework (`.github/workflows/framework*.yml`)

The framework's jobs, ported from `keyring-bifold`'s workflows in the fold.
Each runs with `bifold/` as its working directory, which keeps its own
`yarn install` and build until the plan's Phase 2.

| Workflow (file) · jobs | Trigger | What it checks or does | Secrets |
|---|---|---|---|
| Framework quality (`framework.yml`) · Framework lint and format | PR against any base (opened, synchronize, reopened, labeled, edited); push to `main` touching `bifold/**` | `yarn build`; on a PR, Prettier and ESLint on the **changed framework files only** (on push, repo-wide and non-blocking, "known debt"); testID manifest, emoji data and test-selector checks; other node tests | none |
| Framework quality · Framework tests part 1–4, Framework tests | PR, any base | Jest in four parts on the tests **selected** for the change (`bifold/scripts/ci/select-tests.mjs`: none, a subset or the full suite); Framework tests passes only when every part passed | none |
| Framework quality · Framework tests scope | PR, any base | Repeats Framework tests' verdict with what it ran in the job name | none |
| Framework quality · Type check (ratchet) | PR, any base; push to `main` touching `bifold/**` | `tsc` over `@bifold/core` including tests, against `bifold/packages/core/tsc-baseline.txt`; no new errors, baseline only shrinks | none |
| Framework full suite (`framework-full.yml`) · Framework jest part (n), Framework full suite | Push to `main` touching `bifold/**`; nightly (07:23 UTC); manual | Every framework package's jest, sharded | none |
| Framework VTI conformance (`framework-vti-conformance.yml`) · VTI SDK accepts Keyring's card and statement | PR (any base) and push to `main` touching `bifold/packages/core/src/modules/trust-tasks/**`, `bifold/packages/trust-tasks/**` or `scripts/openvtc/**`; manual | Upstream's pinned VTI SDK verifies a Vetting Card and statement made by Keyring's shipping code | none |

`keyring-bifold`'s Commit Requirements is covered by this repository's own;
its targeted-jest, maintenance, scorecard, publish and repolinter workflows were
not ported. The repository is archived after store build 282.

## Volatile facts (re-check before relying on them)

Everything in this section was read on 2026-11-20 and drifts without any change
to the workflow files. Re-check with the command given before acting on it.

### Required checks

Read from the wallet's ruleset on 2026-11-22, after the fold. The wallet uses a
repository ruleset on `main`, not classic branch protection.

| Repo | Ruleset | Required |
|---|---|---|
| `berkmancenter/keyring-wallet` | 15135312 | Signed commits; no force-push; no deletion. Status checks: **DCO sign-off and commit signature**, **Workflow files**, **Lint+Format+Types**, **Testing**, **Framework tests**, **Type check (ratchet)** (the last two added on 2026-11-22, after the fold). Not strict (a PR need not be up to date with `main`). No required-review rule |

`keyring-bifold` (ruleset 15135301) is frozen since the fold and archived after
store build 282; its rules no longer gate anything that ships from `main`.
No other workflow is required (Test builds says why in its file: a
path-filtered required check would block unrelated PRs; Framework tests is not
path-filtered, and reports "no jest suite" and passes on a PR that touches no
framework file). Organisation rulesets could not be listed (needs the
`admin:org` scope), but the `rules/branches/main` endpoint returns every rule
that applies, and showed only the repository ruleset.

Re-check: `gh api repos/berkmancenter/keyring-wallet/rules/branches/main`
(look for `required_status_checks`). The required check names are job `name:`
values: renaming one of those jobs needs the ruleset changed with it.

### Runtimes

Median (and 90th percentile) of successful runs among the last 1,000 runs per
repo: back to 2026-11-07 for the wallet, 2026-11-17 for bifold. "—" means no
successful run in that window.

| Repo | Workflow | Runtime |
|---|---|---|
| wallet | Code Quality | 7.8 min (8.3) |
| wallet | Commit Requirements | 0.1 min |
| wallet | Test builds | 49.6 min (59.1) |
| wallet | Gate smoke (CI runners) | 16.4 min (19.6) |
| wallet | Gate OTA (CI runners) | — (**unverified**) |
| wallet | Gate (CI runners) | — (**unverified**; the file says it is not usable until the CI identity is approved) |
| wallet | Dependency cache | 0.3 min |
| wallet | Roadmap card status | 0.2 min |
| wallet | Staging - Internal Testing Build & Deploy | 61.7 min (73.8) |
| wallet | OTA release | 22.1 min (33.5) |
| wallet | Post-release smoke | 17.2 min (74.9) |
| wallet | Brake watchdog | — (skipped when post-release is green) |
| wallet | Promote Android build | 0.6 min (dry run) |
| wallet | Plan structure | — (new) |
| wallet | pnm for CI runners, Short invitation links, Push gateway image, deploy-to-dev-server, OTA fingerprint | — |
| bifold | Code Quality (whole workflow) | 5.0 min (9.0) |
| bifold | Commit Requirements | 0.1 min |
| bifold | Full test suite | 13.7 min (15.0) |
| bifold | VTI conformance | 8.1 min (19.4) |
| bifold | Targeted jest | 3.9 min |
| bifold | Roadmap card status, Backlog Maintenance | 0.2 min |
| bifold | OpenSSF Scorecard | 1.0 min |
| bifold | Update Release PR or Publish, Repolinter | — |

Re-check: `gh run list -R berkmancenter/<repo> -w "<workflow name>" -s success -L 100 --json createdAt,updatedAt`.

Triggers and jobs in the tables above are a summary of the workflow files;
when they disagree, the file wins.
