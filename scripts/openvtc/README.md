# Working against the OpenVTC infrastructure

We build Keyring's OpenVTC/TSP integration against the real upstream projects
(the VTA, the mediator client, the TSP wire layer). Those projects are **not**
vendored into this repository — they are cloned into `external/`, which is
gitignored, and **pinned to exact commits** so everyone inspects the same
trees.

Plan: [`docs/plans/openvtc-integration-plan.md`](../../docs/plans/openvtc-integration-plan.md).

## Setup

```sh
node scripts/openvtc/setup-external.mjs
```

Clones five repositories into `external/` and checks each out at its pinned
commit:

| Repo | What we use it for |
|---|---|
| `vta-browser-plugin` | `packages/tsp-js` — the TSP wire layer (published as `@openvtc/vti-tsp-js`); `packages/core` — the browser wallet's VTA client, our closest reference implementation |
| `verifiable-trust-infrastructure` | `vta-service` — the VTA itself (Rust); design notes under `docs/` that are the best documentation of the protocol |
| `vti-didcomm-js` | the mediator client (`@openvtc/vti-didcomm-js`) — authentication, pickup socket, TSP frame demux |
| `vti-setup` | deployment recipes |
| `vta-mobile-agent-ios` | the iOS reference agent — mobile flows, and the closest analogue to what Keyring will do |

Re-running is safe: it fetches and moves each clone back to its pin, and skips
any clone with uncommitted changes rather than touching your work. `--status`
reports without changing anything. Note that if you have a *branch* checked out
in a clone (e.g. a staged upstream contribution), setup will move you back to
the pinned commit — the branch ref is untouched, just `git switch` back to it.

Toolchains, only if you need them: **Node 20+** for everything here, **Node 24+**
to build `vta-browser-plugin`, **Rust ≥ 1.95** to build the VTA.

## Staying current

Upstream moves fast — the VTA repo took 82 commits in one recent five-day
stretch, including breaking wire changes. The policy is:

> **Fetching is free; advancing is a decision.**

```sh
node scripts/openvtc/sync-external.mjs
```

Fetches everything, changes nothing, and prints a digest: commits ahead of each
pin, which watchlist paths were touched (TSP code, design notes, feature-flag
defaults), how many commits are marked breaking, the newest tags — including a
detector for the final "Cypress" coordinated release — and npm versions for the
four `@openvtc` packages. It exits non-zero if a tripwire fires, so it can gate
CI later.

When we decide to move to newer upstream code:

```sh
node scripts/openvtc/sync-external.mjs --advance <repo> --why "reason"
```

That updates `PINS.json`, appends to `SYNC_LOG.md`, and reminds you to re-run
the reference ladder. **Don't advance pins in the middle of a piece of work** —
do it at a boundary, then re-run the ladder bottom-up: the first rung that goes
red tells you which layer upstream changed.

## Files here

| File | Purpose |
|---|---|
| `PINS.json` | The pinned commit per repo, why it was pinned, per-repo watchlist paths, and npm version tripwires |
| `setup-external.mjs` | Clone/checkout to pins (idempotent) |
| `sync-external.mjs` | Digest upstream changes; `--advance` to move a pin |
| `SYNC_LOG.md` | History of pin advances and why |
| `BINARY_PINS.json` | Same idea, for `download.firstperson.dev`'s prebuilt binaries (`vta`, `pnm`, `mediator`, …) — see below |
| `fetch-binaries.mjs` | Download/verify/advance those binaries |
| `BINARY_PINS_LOG.md` | History of binary pin advances and why |

## The prebuilt binaries (`vta`, `pnm`, `mediator`, …)

`download.firstperson.dev` publishes compiled binaries — no source clone
needed for these. Same *fetching is free, advancing is a decision* policy as
above, but the mechanism differs in one important way: that server has **no
versioned-artifact URLs**, only `latest` (newest tagged release) / `main`
(newest compiled commit) moving pointers, plus a named release *channel*
(currently `dogwood`) for the `pnm`/`openvtc` client builds. So a pin here
records the last **verified** build (by content sha256 — most of these
binaries have no `--version` flag at all, `pnm` included) for drift detection;
it cannot freeze a re-fetchable historical version the way a git SHA does.
Advancing means "we verified a newer build," never "roll back to an old one."

Concretely, why this matters: the OpenVTC developer tutorial
(`vti-setup/developer/01-personal-vta.md`) states "Verified with: VTA Version
0.17.0"; the `vta` binary `fetch-binaries.mjs` downloaded the same day this
file was written was **0.23.3** — six point-releases the tutorial doesn't know
about. Nothing failed; nothing warned. This exists so drift like that gets
noticed on purpose.

```sh
node scripts/openvtc/fetch-binaries.mjs                # fetch + verify every pinned binary into external/bin/
node scripts/openvtc/fetch-binaries.mjs vta pnm-server  # just the named ones
node scripts/openvtc/fetch-binaries.mjs --status        # report the cache's state, no network
node scripts/openvtc/fetch-binaries.mjs --check          # probe current upstream without touching the cache
node scripts/openvtc/fetch-binaries.mjs --advance vta --why "reason"   # re-fetch, update the pin, log it
```

`e2e/lib/vta.js`'s `startVta()` uses the cached `external/bin/vta` automatically
once fetched (`VTA_BIN` overrides it). See `BINARY_PINS.json` for what's
pinned, exercised, and still just sitting there unverified — most of the
mediator/VTC/did-hosting binaries were downloaded once to confirm the URLs
work, not because anything in this repo runs them yet.

## Checking claims

Anything asserted about upstream behaviour should be checkable against these
clones — a file path and a commit, or a runnable script. The reference ladder
in [`tsp-reference/`](../../tsp-reference/) exists for
exactly that: each rung is a small runnable program that proves one layer of the
stack, with frozen fixtures so a change upstream turns something red instead of
quietly drifting.
