---
name: openvtc-workspace
description: Conventions and setup for the OpenVTC/TSP integration workstream — the living plan, pinned upstream clones in external/, the sync policy, and the reference ladder. Use when working on TSP, Trust Tasks, the VTA, mediators, agent names, or anything under docs/plans/, scripts/openvtc/, or tsp-reference/.
---

# OpenVTC integration workstream

Keyring is being made interoperable with the OpenVTC / First Person Project
infrastructure: **TSP** (the message envelope), **Trust Tasks** (the operation
layer), and the **VTA** (the server-side agent a wallet enrols with).

## Read first

[`docs/plans/openvtc-integration-plan.md`](../../../docs/plans/openvtc-integration-plan.md)
is the living plan and the single source of truth. Don't restate or re-derive
its decisions from scratch — read it, then work from it.
[`docs/plans/README.md`](../../../docs/plans/README.md) describes how plan
changes are proposed and agreed.

## Upstream code lives in `external/`, pinned

The upstream projects are cloned into `external/` (gitignored) and pinned to
exact commits in `scripts/openvtc/PINS.json`.

```sh
node scripts/openvtc/setup-external.mjs     # clone/checkout to the pins
node scripts/openvtc/sync-external.mjs      # what changed upstream (reports only)
```

Full guide: [`scripts/openvtc/README.md`](../../../scripts/openvtc/README.md).

**Rules:**

- **Never commit anything under `external/`.**
- **Fetching is free; advancing a pin is a decision.** Only
  `sync-external.mjs --advance <repo> --why "..."` moves a pin, never a bare
  `git pull` in a clone. Don't advance mid-task — do it at a boundary and then
  re-run the reference ladder bottom-up.
- **Verify claims about upstream against the pinned clones** before acting on
  them — cite a file path and commit, or a runnable check. These repos change
  daily; documentation and memory go stale fast. This rule exists because a
  previous review round turned on facts that were true when written and wrong a
  week later.

## The reference ladder

[`tsp-reference/`](../../../tsp-reference/) holds small
runnable programs, one per layer of the stack (`ref-00` … `ref-05`), with
frozen fixtures. Each has a README saying what it proves.

```sh
cd tsp-reference/ref-00-hello-direct && npm install && npm start
for d in tsp-reference/ref-*/; do (cd "$d" && npm run -s check); done
```

When adding a rung: pure TypeScript/JS core with **no React Native imports**
(the same code must run under Node and Hermes), frozen fixtures, a README
stating what it proves, and an honest note about what it does *not* prove.

## Contributing upstream

Fixes and improvements to the OpenVTC projects are expected and welcome — this
is a young ecosystem and we are one of its implementers. The workflow:

1. Develop the change on a branch inside the relevant `external/` clone.
2. Write a candidate document alongside the rung it came from (see
   `tsp-reference/ref-03-noble-crypto/PR-CANDIDATE.md` for the
   shape): the change, the **community rationale** (why it helps the ecosystem,
   not only us), and **evidence it breaks nothing** (upstream's own tests,
   vectors, fixtures).
3. **Show it to a human and wait for approval before pushing or opening
   anything.** Nothing is published to an external repository without review.
4. Stage on a personal fork first for internal review; the official PR comes
   later.
5. Commits to upstream repos need a DCO `Signed-off-by` trailer.

The reference ladder never blocks on upstream review — consume the change
locally (patched clone or vendored module) and keep moving.

## Environment notes

- Node 20+ here; Node 24+ to build `vta-browser-plugin`; Rust ≥ 1.95 for the VTA.
- Node has **no global `WebSocket`** at 20.x — mediator clients must inject one
  (`ws@8`).
- The VTA binary is `vta` (not `vta-service`); `--features setup` implies
  `webvh`, which is what lets it serve its own DID document.
