# Vendored Trust Task bundles — a voter's eight tasks

Copied verbatim from the Verifiable Trust Infrastructure repository's spec
crates. They are test fixtures: `../../pollTasks.test.ts` validates the payloads
`../../../pollTasks.ts` builds, and the answers it parses, against them. That way
upstream's own schemas grade our hand-mirrored types, not our reading of them.

Each file is a **bundle**: the task's payload schema (`schema`) and response
schema (`responseSchema`), each with every shared definition inlined under
`$defs`, plus the task's policy and error codes. So no cross-file `$ref` needs
resolving, unlike `../../../../trust-tasks/__tests__/fixtures/pcs-schemas`.

## Attribution

|                   |                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **Specification** | Trust Tasks — the voter's tasks listed below, `voting/_shared` **0.2**, framework **0.4** |
| **Source**        | https://github.com/OpenVTC/verifiable-trust-infrastructure                                |
| **Commit**        | `3139e00ec202351dc253d89b5b4f9885d7ae071e` (also in `PROVENANCE.sha`)                     |
| **Copied**        | 2026-11-02                                                                                |
| **Licence**       | Apache License 2.0 (`LICENSE` at the commit above)                                        |

| File here                                     | Path at the commit                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `vtc-elections-list-0.3.bundle.json`          | `vti-specs-vtc/trust-tasks/vtc/elections/list/0.3.bundle.json`          |
| `vtc-elections-show-0.2.bundle.json`          | `vti-specs-vtc/trust-tasks/vtc/elections/show/0.2.bundle.json`          |
| `vtc-elections-tickets-issue-0.1.bundle.json` | `vti-specs-vtc/trust-tasks/vtc/elections/tickets/issue/0.1.bundle.json` |
| `vta-pcs-voter-register-0.2.bundle.json`      | `vti-specs-vta/trust-tasks/vta/pcs/voter/register/0.2.bundle.json`      |
| `vta-pcs-voter-accept-0.1.bundle.json`        | `vti-specs-vta/trust-tasks/vta/pcs/voter/accept/0.1.bundle.json`        |
| `vta-pcs-vote-0.2.bundle.json`                | `vti-specs-vta/trust-tasks/vta/pcs/vote/0.2.bundle.json`                |
| `voting-ballot-cast-0.1.bundle.json`          | `vti-specs-core/trust-tasks/voting/ballot/cast/0.1.bundle.json`         |
| `vta-pcs-voter-receipt-0.1.bundle.json`       | `vti-specs-vta/trust-tasks/vta/pcs/voter/receipt/0.1.bundle.json`       |

## The later generations

The newer versions `POLL_GENERATIONS` names, copied 2026-11-04 from commit
`e84bb1eda56e64a0e4ea4b151423ab30aa654cb5` (the second line of `PROVENANCE.sha`), `voting/_shared` 0.3 and 0.4. Paths as above, by version:
`vtc/elections/list/0.5`, `show/0.3`, `show/0.6`, `tickets/issue/0.3`,
`vta/pcs/voter/register/0.3`, `register/0.5`, `vta/pcs/vote/0.3`, `vote/0.4`.

## Off the shared pin, deliberately

`scripts/openvtc/PINS.json` pins `verifiable-trust-infrastructure` at an older
commit than this one. The commit above is the one the plan reads
(`docs/plans/community-polls-plan.md` in the wallet); the pin was not moved for this,
because it feeds spec-watch and conformance for everything else.

## Updating these

Re-copy from the repository rather than editing in place, update the commit in
this file and in `PROVENANCE.sha`, and read what changed upstream first.
