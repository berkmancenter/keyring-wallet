# Vendored `acl/_shared` entry schemas

Copied verbatim from the Trust Tasks specification registry. Test fixtures:
`../../hiddenVettingAcl.test.ts` validates the ACL entries the hidden-vetting
tests put in front of `VtaClient`'s parser against these, so the fake cannot
quietly take a shape the agent never sends. That is not a hypothetical — it
already happened: the fake put a capability in `scopes`, the parser read
`scopes` as capabilities, and the suite passed while the code was wrong in
both directions.

## Attribution

Required by the licence (see `../pcs-schemas/README.md` for the OWFa 1.0 terms,
which apply identically here).

|                   |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| **Specification** | Trust Tasks — `acl/_shared` **0.1** and **0.2**                       |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                   |
| **Commit**        | `7b6bb488ffd838bef058310c909207d4a7b77125` (also in `PROVENANCE.sha`) |
| **Copied**        | 2026-10-15                                                            |

| File here                   | Path in the registry                          |
| --------------------------- | --------------------------------------------- |
| `acl-entry-0.1.schema.json` | `specs/acl/_shared/0.1/acl-entry.schema.json` |
| `acl-entry-0.2.schema.json` | `specs/acl/_shared/0.2/acl-entry.schema.json` |

**These are at the shared pin** (`scripts/openvtc/PINS.json`,
`dtgwg-trust-tasks-tf` at `7b6bb488`, pinned 2026-10-07), unlike the
`vta/pcs/*` fixtures next door — see their README for why those are knowingly
off-pin.

## Why both versions

`VtaClient` asks for `acl/list/0.1` and `0.2` in that order, so either shape
can come back and both have to be read correctly.

**0.1 states authority by shape; 0.2 states it outright.** The 0.2 schema's own
description gives the reason: 0.1's `scopes` was "a list whose emptiness meant
`everywhere` for one role and `nowhere` for another, depending on a maintainer
convention the wire could not carry". 0.2 replaces it with an explicit `act`
scope — `all`, `none`, or a non-empty context list — and promotes capabilities
to a declared member with the same three shapes (`ceiling`, `none`, `listed`),
where 0.1 carries them in `ext["org.openvtc.capabilities"]`.

vta-service **0.60 serves 0.1 only** (its discovery list names no 0.2, read at
`vta-service-v0.60.0`), so 0.1 is what agents answer today and 0.2 is what they
will answer later. Both are tested because a shape that arrives unread would
refuse a phone that is in fact allowed.
