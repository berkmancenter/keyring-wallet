# Vendored rooms schemas

Copied verbatim from the Trust Tasks specification registry, keeping the
registry's own layout under `specs/` so every relative `$ref` resolves the
way it does upstream. `../roomsDataPath.test.ts` checks the requests the real
rooms service sends, and the answers its fake agent gives, against these
schemas. That way the fake cannot quietly accept or give a shape the agent
never would; the `acl-schemas` README next door describes how that once
happened.

|                   |                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Specification** | Trust Tasks: `rooms/keys/list` 0.2, `rooms/keys/browse` 0.3, `rooms/keys/read` 0.1, `rooms/keys/seal` 0.2 and 0.3, `rooms/keys/profile/read` 0.1, `rooms/keys/act` 0.9, `rooms/records/put` 0.3, `vtc/rooms/memberships/list` 0.1, and the `_shared` and `_framework` schemas they reference |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                                                                                                                                                                                                                                          |
| **Commit**        | `3ef8d4907aa0da40c4eb5c46ffb211581dd93870` (also in `PROVENANCE.sha`)                                                                                                                                                                                                                        |
| **Copied**        | 2026-11-08                                                                                                                                                                                                                                                                                   |

These are knowingly **ahead of the shared pin** (`scripts/openvtc/PINS.json`).
`rooms/keys/seal/0.3` and the record members of `SealedRecordBody`
(trust-tasks-tf #1027) postdate the pin, and Keyring sends them.

Licence: OWFa 1.0, as for the `pcs-schemas` fixtures (see their README).
