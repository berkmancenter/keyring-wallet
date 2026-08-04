# Plans

Living planning documents for cross-cutting workstreams, and the lightweight
protocol we use to agree on them.

| Plan | Scope | Status |
|---|---|---|
| [openvtc-integration-plan.md](./openvtc-integration-plan.md) | Making Keyring interoperable with the OpenVTC / First Person Project infrastructure — TSP as the message envelope, Trust Tasks as the operation layer, the VTA as the server-side counterpart | Active. Phase A/B complete, Phase C in progress |

## Why documents instead of only pull-request threads

We work with independent agents that need the same context. A PR thread is a
good *venue* for discussion, but it is a poor *record*: comments are hard to
grep, decay over time, live outside the repository, and are effectively
invisible to an agent reading the codebase. So:

- **Documents carry the decision record** — what we agreed, and the evidence
  behind it. They version with the code and both agents can read them.
- **PRs (when we open them) carry the conversation.** Nothing stops us using
  both; the document is what survives.

## The protocol

1. **One living plan per workstream** is the single source of truth. It is the
   first thing to read, and the first thing an agent should be pointed at.
2. **Changes arrive as dated proposals**, not silent edits to the living plan.
   Naming: `YYYYMMDD_topic_author.md` (e.g. `20260729_revisions_brendan.md`).
3. **A proposal gets a response with evidence**, not opinions: claim → verdict
   → citation (file path, commit, or a runnable check).
4. **Agreed items merge into the living plan**, which bumps its revision line
   and names the proposal it absorbed. Rejected items are recorded *with their
   reasoning* so they don't come back around.
5. **Claims about upstream get verified against the pinned clones before
   adoption.** This is the load-bearing rule. The upstream repositories change
   daily; several claims in the first review round were accurate when written
   and stale a week later. `scripts/openvtc/` exists to make that verification
   reproducible for everyone.

## Working on this workstream

```sh
node scripts/openvtc/setup-external.mjs     # clone the upstream repos at pinned SHAs
node scripts/openvtc/sync-external.mjs      # what changed upstream since the pins
```

See [`scripts/openvtc/README.md`](../../scripts/openvtc/README.md) for the full
environment guide, and
[`docs/spikes/tsp-reference/`](../spikes/tsp-reference/) for the runnable
reference ladder that backs the plan's technical claims.
