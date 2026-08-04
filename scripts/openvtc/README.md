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

## Checking claims

Anything asserted about upstream behaviour should be checkable against these
clones — a file path and a commit, or a runnable script. The reference ladder
in [`docs/spikes/tsp-reference/`](../../docs/spikes/tsp-reference/) exists for
exactly that: each rung is a small runnable program that proves one layer of the
stack, with frozen fixtures so a change upstream turns something red instead of
quietly drifting.
