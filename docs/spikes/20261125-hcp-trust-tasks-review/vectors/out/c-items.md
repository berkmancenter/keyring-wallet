
#### c1. Lower bounds TT adds that reject a value HCP's schema accepts (empty string or empty array) (67)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | _shared:MinimizationReport `method` | minLength: TT 1, HCP (none) | no | `_shared/common.schema.json#/$defs/MinimizationReport/properties/method` | `common.json#/$defs/minimization/properties/method` |
| 2 | _shared:EvidenceItem `type` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/EvidenceItem/properties/type` | `common.json#/$defs/evidenceItem/properties/type` |
| 3 | _shared:ClientDescription `id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/id` | `common.json#/$defs/clientDescription/properties/id` |
| 4 | _shared:ClientDescription `name` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/name` | `common.json#/$defs/clientDescription/properties/name` |
| 5 | _shared:ClientDescription `operator.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/operator/properties/id` | `common.json#/$defs/named/properties/id` |
| 6 | _shared:ClientDescription `operator.name` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/operator/properties/name` | `common.json#/$defs/named/properties/name` |
| 7 | _shared:Entry `record.provenance.assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/assertedBy/properties/id` | `entry.json#/properties/record/properties/provenance/properties/assertedBy/properties/id` |
| 8 | _shared:Entry `record.provenance.assertedBy.via.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/assertedBy/properties/via/properties/id` | `entry.json#/properties/record/properties/provenance/properties/assertedBy/properties/via/properties/id` |
| 9 | _shared:Entry `record.provenance.authorizedUnder` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/authorizedUnder` | `entry.json#/properties/record/properties/provenance/properties/authorizedUnder` |
| 10 | _shared:Entry `record.provenance.confirmations[].confirmedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/confirmations/items/properties/confirmedBy/properties/id` | `entry.json#/properties/record/properties/provenance/properties/confirmations/items/properties/confirmedBy/properties/id` |
| 11 | _shared:Entry `record.provenance.recordedByProvider` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/recordedByProvider` | `entry.json#/properties/record/properties/provenance/properties/recordedByProvider` |
| 12 | _shared:Entry `record.provenance.source` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/source` | `entry.json#/properties/record/properties/provenance/properties/source` |
| 13 | _shared:Entry `record.relationships[].assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Relationship/properties/assertedBy/properties/id` | `entry.json#/properties/record/properties/relationships/items/properties/assertedBy/properties/id` |
| 14 | _shared:Entry `record.relationships[].proposal.entry` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/RecordedProposal/properties/entry` | `entry.json#/properties/record/properties/relationships/items/properties/proposal/properties/entry` |
| 15 | _shared:Entry `record.relationships[].proposal.proposedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/RecordedProposal/properties/proposedBy/properties/id` | `entry.json#/properties/record/properties/relationships/items/properties/proposal/properties/proposedBy/properties/id` |
| 16 | _shared:Entry `record.relationships[].proposal.weighed[]` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/RecordedProposal/properties/weighed/items` | `entry.json#/properties/record/properties/relationships/items/properties/proposal/properties/weighed/items` |
| 17 | _shared:Entry `record.relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Relationship/properties/target` | `entry.json#/properties/record/properties/relationships/items/properties/target` |
| 18 | _shared:Entry `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/EntrySubject/properties/id` | `entry.json#/properties/subject/properties/id` |
| 19 | _shared:Entry `type[]` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Entry/properties/type/items` | `entry.json#/properties/type/items` |
| 20 | _shared:Disclosure `provenance.submittedBy.name` | minLength: TT 1, HCP (none) | no | `_shared/disclosure.schema.json#/$defs/DisclosedProvenance/properties/submittedBy/properties/name` | `disclosure.json#/properties/provenance/properties/submittedBy/properties/name` |
| 21 | _shared:Disclosure `provenance.submittedBy.operator` | minLength: TT 1, HCP (none) | no | `_shared/disclosure.schema.json#/$defs/DisclosedProvenance/properties/submittedBy/properties/operator` | `disclosure.json#/properties/provenance/properties/submittedBy/properties/operator` |
| 22 | _shared:Disclosure `relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/disclosure.schema.json#/$defs/DisclosedRelationship/properties/target` | `disclosure.json#/properties/relationships/items/properties/target` |
| 23 | _shared:Named `id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/Named/properties/id` | `common.json#/$defs/named/properties/id` |
| 24 | _shared:Named `name` | minLength: TT 1, HCP (none) | yes | `_shared/grant.schema.json#/$defs/Named/properties/name` | `common.json#/$defs/named/properties/name` |
| 25 | _shared:AccessDetail `onwardSharing.domains[]` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/OnwardSharing/properties/domains/items` | `common.json#/$defs/accessDetail/properties/onwardSharing/properties/domains/items` |
| 26 | _shared:AccessDetail `onwardSharing.notTo[]` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/OnwardSharing/properties/notTo/items` | `common.json#/$defs/accessDetail/properties/onwardSharing/properties/notTo/items` |
| 27 | _shared:Grant `authorizingPrincipal.delegation` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/AuthorizingPrincipal/properties/delegation` | `grant.json#/properties/authorizingPrincipal/properties/delegation` |
| 28 | _shared:Grant `authorizingPrincipal.id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/AuthorizingPrincipal/properties/id` | `grant.json#/properties/authorizingPrincipal/properties/id` |
| 29 | _shared:Grant `client.id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/GrantClient/properties/id` | `grant.json#/properties/client/properties/id` |
| 30 | _shared:Grant `requestingParty.id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/RequestingParty/properties/id` | `grant.json#/properties/requestingParty/properties/id` |
| 31 | _shared:Grant `subject.id` | minLength: TT 1, HCP (none) | yes | `_shared/grant.schema.json#/$defs/GrantParty/properties/id` | `grant.json#/properties/subject/properties/id` |
| 32 | _shared:StandingRule `setBy` | minLength: TT 1, HCP (none) | no | `_shared/standing-rule.schema.json#/$defs/StandingRule/properties/setBy` | `standing-rule.json#/properties/setBy` |
| 33 | _shared:Directive `setBy` | minLength: TT 1, HCP (none) | no | `_shared/directive.schema.json#/$defs/Directive/properties/setBy` | `directive.json#/properties/setBy` |
| 34 | _shared:Delegation `basis.description` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/DelegationBasis/properties/description` | `delegation.json#/properties/basis/properties/description` |
| 35 | _shared:Delegation `basis.establishedBy` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/DelegationBasis/properties/establishedBy` | `delegation.json#/properties/basis/properties/establishedBy` |
| 36 | _shared:Delegation `delegate.id` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/Delegation/properties/delegate/properties/id` | `delegation.json#/properties/delegate/properties/id` |
| 37 | _shared:Delegation `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/Delegation/properties/subject/properties/id` | `delegation.json#/properties/subject/properties/id` |
| 38 | _shared:AuditEvent `eventType` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/eventType` | `audit-event.json#/properties/eventType` |
| 39 | _shared:AuditEvent `participants.authorizingPrincipal.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/authorizingPrincipal/properties/id` |
| 40 | _shared:AuditEvent `participants.clientOperator.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/clientOperator/properties/id` |
| 41 | _shared:AuditEvent `participants.initiator.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParticipants/properties/initiator/properties/id` | `audit-event.json#/properties/participants/properties/initiator/properties/id` |
| 42 | _shared:AuditEvent `participants.model.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/model/properties/id` |
| 43 | _shared:AuditEvent `participants.provider.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/provider/properties/id` |
| 44 | _shared:AuditEvent `participants.requestingParty.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/requestingParty/properties/id` |
| 45 | _shared:Export `exportedBy` | minLength: TT 1, HCP (none) | no | `_shared/export.schema.json#/$defs/Export/properties/exportedBy` | `export.json#/properties/exportedBy` |
| 46 | _shared:Export `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/export.schema.json#/$defs/Export/properties/subject/properties/id` | `export.json#/properties/subject/properties/id` |
| 47 | entries/create:request `record.provenance.assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/AssertedBy/properties/id` | `operations/create-request.json#/properties/record/properties/provenance/properties/assertedBy/properties/id` |
| 48 | entries/create:request `record.provenance.source` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/CreateProvenance/properties/source` | `operations/create-request.json#/properties/record/properties/provenance/properties/source` |
| 49 | entries/create:request `record.relationships[].proposal.entry` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/Proposal/properties/entry` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/proposal/properties/entry` |
| 50 | entries/create:request `record.relationships[].proposal.rationale` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/Proposal/properties/rationale` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/proposal/properties/rationale` |
| 51 | entries/create:request `record.relationships[].proposal.weighed[]` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/Proposal/properties/weighed/items` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/proposal/properties/weighed/items` |
| 52 | entries/create:request `record.relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteRelationship/properties/target` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/target` |
| 53 | entries/create:request `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteSubject/properties/id` | `operations/create-request.json#/properties/subject/properties/id` |
| 54 | entries/get:request `ref` | minLength: TT 1, HCP (none) | no | `entries/get/0.1/payload.schema.json#/properties/ref` | `operations/get-entry-request.json#/properties/ref` |
| 55 | entries/query:request `categories` | minItems: TT 1, HCP (none) | yes | `entries/query/0.1/payload.schema.json#/properties/categories` | `operations/query-request.json#/properties/categories` |
| 56 | entries/revise:request `record.provenance.assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/AssertedBy/properties/id` | `operations/revise-request.json#/properties/record/properties/provenance/properties/assertedBy/properties/id` |
| 57 | entries/revise:request `record.provenance.source` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteProvenance/properties/source` | `operations/revise-request.json#/properties/record/properties/provenance/properties/source` |
| 58 | entries/revise:request `record.relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteRelationship/properties/target` | `operations/revise-request.json#/properties/record/properties/relationships/items/properties/target` |
| 59 | entries/revise:request `ref` | minLength: TT 1, HCP (none) | no | `entries/revise/0.1/payload.schema.json#/properties/ref` | `operations/revise-request.json#/properties/ref` |
| 60 | entries/withdraw:request `ref` | minLength: TT 1, HCP (none) | no | `entries/withdraw/0.1/payload.schema.json#/properties/ref` | `operations/withdraw-request.json#/properties/ref` |
| 61 | entries/withdraw:response `ref` | minLength: TT 1, HCP (none) | no | `entries/withdraw/0.1/payload.schema.json#/$defs/Response/properties/ref` | `operations/withdraw-result.json#/properties/ref` |
| 62 | import:request `export.audit[].eventType` | minLength: TT 1, HCP (none) | yes | `import/0.1/payload.schema.json#/$defs/ImportedAuditEvent/properties/eventType` | `audit-event.json#/properties/eventType` |
| 63 | import:request `export.exportedBy` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/ImportedExport/properties/exportedBy` | `export.json#/properties/exportedBy` |
| 64 | import:request `export.subject.id` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/ImportedExport/properties/subject/properties/id` | `export.json#/properties/subject/properties/id` |
| 65 | import:response `outcomes[].id` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/Outcome/properties/id` | `operations/import-result.json#/properties/outcomes/items/properties/id` |
| 66 | import:response `outcomes[].reason` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/Outcome/properties/reason` | `operations/import-result.json#/properties/outcomes/items/properties/reason` |
| 67 | shares/report:request `refs[]` | minLength: TT 1, HCP (none) | no | `shares/report/0.1/payload.schema.json#/properties/refs/items` | `operations/report-sharing-request.json#/properties/refs/items` |

#### c2. HCP schema rules (if/then, contains, oneOf) TT does not check (16)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | _shared:Content `(root)` | HCP schema rule not in the TT schema: if {"properties":{"profile":{"const":"https://hcp.example/spec/profiles/general-context/2.0"}}} then { | yes | `_shared/context-entry.schema.json#/$defs/Content` | `common.json#/$defs/content` |
| 2 | _shared:Content `(root)` | HCP schema rule not in the TT schema: if {"properties":{"profile":{"const":"https://hcp.example/spec/profiles/vc-evidence/2.0"}}} then {"not | yes | `_shared/context-entry.schema.json#/$defs/Content` | `common.json#/$defs/content` |
| 3 | _shared:Assertion `(root)` | HCP schema rule not in the TT schema: if {"properties":{"declarationType":{"const":"model-inferred"}}} then {"properties":{"confidence":{"en | yes | `_shared/context-entry.schema.json#/$defs/Assertion` | `common.json#/$defs/assertion` |
| 4 | _shared:EvidenceItem `(root)` | HCP schema rule not in the TT schema: if {"properties":{"type":{"const":"verifiable-credential"}},"required":["type"]} then {"properties":{" | yes | `_shared/context-entry.schema.json#/$defs/EvidenceItem` | `common.json#/$defs/evidenceItem` |
| 5 | _shared:Entry `evidence` | HCP schema rule not in the TT schema: contains {"properties":{"role":{"const":"content"}},"required":["role"]} minContains 0 maxContains 1 | yes | `_shared/context-entry.schema.json#/$defs/Entry/properties/evidence` | `entry.json#/properties/evidence` |
| 6 | _shared:Entry `record.relationships[]` | HCP schema rule not in the TT schema: if {"not":{"properties":{"type":{"const":"contradicts"}}}} then {"not":{"required":["proposal"]}} | yes | `_shared/context-entry.schema.json#/$defs/Record/properties/relationships/items` | `entry.json#/properties/record/properties/relationships/items` |
| 7 | _shared:Entry `type` | HCP schema rule not in the TT schema: contains {"const":"ContextEntry"} | yes | `_shared/context-entry.schema.json#/$defs/Entry/properties/type` | `entry.json#/properties/type` |
| 8 | _shared:Disclosure `evidence[]` | HCP schema rule not in the TT schema: if {"properties":{"type":{"const":"verifiable-credential"}},"required":["type"]} then {"properties":{" | yes | `_shared/disclosure.schema.json#/$defs/Disclosure/properties/evidence/items` | `disclosure.json#/properties/evidence/items` |
| 9 | _shared:Grant `(root)` | HCP schema rule not in the TT schema: if {"properties":{"grantType":{"const":"temporary"}}} then {"properties":{"expiresAt":{"format":"date- | yes | `_shared/grant.schema.json#/$defs/Grant` | `grant.json#` |
| 10 | _shared:Grant `(root)` | HCP schema rule not in the TT schema: if {"properties":{"grantType":{"const":"persistent"}}} then {"properties":{"expiresAt":{"type":"null"} | yes | `_shared/grant.schema.json#/$defs/Grant` | `grant.json#` |
| 11 | _shared:Delegation `basis` | HCP schema rule not in the TT schema: if {"properties":{"method":{"const":"evidence"}}} then {"properties":{"evidence":{"minItems":1}},"requ | yes | `_shared/delegation.schema.json#/$defs/Delegation/properties/basis` | `delegation.json#/properties/basis` |
| 12 | _shared:Delegation `basis` | HCP schema rule not in the TT schema: if {"properties":{"method":{"const":"delegated"}}} then {"required":["parent"]} else {"not":{"required | yes | `_shared/delegation.schema.json#/$defs/Delegation/properties/basis` | `delegation.json#/properties/basis` |
| 13 | entries/create:request `evidence` | HCP schema rule not in the TT schema: contains {"properties":{"role":{"const":"content"}},"required":["role"]} minContains 0 maxContains 1 | yes | `entries/create/0.1/payload.schema.json#/properties/evidence` | `operations/create-request.json#/properties/evidence` |
| 14 | entries/revise:request `evidence` | HCP schema rule not in the TT schema: contains {"properties":{"role":{"const":"content"}},"required":["role"]} minContains 0 maxContains 1 | yes | `entries/revise/0.1/payload.schema.json#/properties/evidence` | `operations/revise-request.json#/properties/evidence` |
| 15 | entries/hard-delete:response `(root)` | HCP schema rule not in the TT schema: exactly one of (entryId \| ref) present | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 16 | import:response `outcomes[]` | HCP schema rule not in the TT schema: if {"properties":{"outcome":{"const":"rejected"}}} then {"required":["reason"]} | yes | `import/0.1/payload.schema.json#/$defs/Response/properties/outcomes/items` | `operations/import-result.json#/properties/outcomes/items` |

#### c3. Payload roots TT closes where HCP is open (17)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | entries/create:request `(root)` | TT closed, HCP open | no | `entries/create/0.1/payload.schema.json#` | `operations/create-request.json#` |
| 2 | entries/get:request `(root)` | TT closed, HCP open | yes | `entries/get/0.1/payload.schema.json#` | `operations/get-entry-request.json#` |
| 3 | entries/get:response `(root)` | TT closed, HCP open | yes | `entries/get/0.1/payload.schema.json#/$defs/Response` | `operations/get-entry-result.json#` |
| 4 | entries/query:request `(root)` | TT closed, HCP open | yes | `entries/query/0.1/payload.schema.json#` | `operations/query-request.json#` |
| 5 | entries/query:response `(root)` | TT closed, HCP open | yes | `entries/query/0.1/payload.schema.json#/$defs/Response` | `operations/query-result.json#` |
| 6 | entries/revise:request `(root)` | TT closed, HCP open | no | `entries/revise/0.1/payload.schema.json#` | `operations/revise-request.json#` |
| 7 | entries/withdraw:request `(root)` | TT closed, HCP open | yes | `entries/withdraw/0.1/payload.schema.json#` | `operations/withdraw-request.json#` |
| 8 | entries/withdraw:response `(root)` | TT closed, HCP open | yes | `entries/withdraw/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 9 | entries/hard-delete:response `(root)` | TT closed, HCP open | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 10 | import:request `(root)` | TT closed, HCP open | yes | `import/0.1/payload.schema.json#` | `operations/import-request.json#` |
| 11 | import:response `(root)` | TT closed, HCP open | yes | `import/0.1/payload.schema.json#/$defs/Response` | `operations/import-result.json#` |
| 12 | export:request `(root)` | TT closed, HCP open | yes | `export/0.1/payload.schema.json#` | `export.json#/properties/options` |
| 13 | shares/report:request `(root)` | TT closed, HCP open | yes | `shares/report/0.1/payload.schema.json#` | `operations/report-sharing-request.json#` |
| 14 | rules/set:request `(root)` | TT closed, HCP open | yes | `rules/set/0.1/payload.schema.json#` | `standing-rule.json#` |
| 15 | directives/set:request `(root)` | TT closed, HCP open | yes | `directives/set/0.1/payload.schema.json#` | `directive.json#` |
| 16 | delegations/list:response `(root)` | TT closed, HCP open | yes | `delegations/list/0.1/payload.schema.json#/$defs/Response` | `operations/delegations-result.json#` |
| 17 | disclosures/summary:response `(root)` | TT closed, HCP open | yes | `disclosures/summary/0.1/payload.schema.json#/$defs/Response` | `operations/disclosure-summary-result.json#` |

#### c4. Unions merged into one pattern, and a dropped format (6)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | _shared:Category `(root)` | HCP is a choice of [pattern ^[a-z][a-z0-9_]*$ \| format uri pattern ^[A-Za-z][A-Za-z0-9+.-]*:]; TT is a single shape [type string pattern ^( | no | `_shared/common.schema.json#/$defs/Category` | `common.json#/$defs/category` |
| 2 | _shared:Directive `action` | HCP is a choice of [type string enum "share", "sign", "transact" \| type string format uri pattern ^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$]; TT is  | no | `_shared/directive.schema.json#/$defs/Directive/properties/action` | `directive.json#/properties/action` |
| 3 | _shared:Delegation `relationship` | HCP is a choice of [type string enum "attorney-in-fact", "caregiver", "legal-guardian", "parent-or-guardian" \| type string format uri patte | no | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | `delegation.json#/properties/relationship` |
| 4 | _shared:AuditEvent `purpose` | TT (none), HCP uri | no | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | `audit-event.json#/properties/purpose` |
| 5 | import:request `export.audit[].purpose` | TT (none), HCP uri | no | `import/0.1/payload.schema.json#/$defs/ImportedAuditEvent/properties/purpose` | `audit-event.json#/properties/purpose` |
| 6 | directives/set:request `action` | HCP is a choice of [type string enum "share", "sign", "transact" \| type string format uri pattern ^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$]; TT is  | no | `directives/set/0.1/payload.schema.json#/properties/action` | `directive.json#/properties/action` |

#### c5. hcp/entries/hard-delete response vs HCP withdraw-result (my pairing; Q11) (5)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | entries/hard-delete:response `entryId` | required in TT, optional in HCP | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 2 | entries/hard-delete:response `hardDeleted` | required in TT, optional in HCP | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 3 | entries/hard-delete:response `hardDeleted` | closed in TT only (true) | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response/properties/hardDeleted` | `operations/withdraw-result.json#/properties/hardDeleted` |
| 4 | entries/hard-delete:response `ref` | optional in HCP; TT does not declare it | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 5 | entries/hard-delete:response `status` | required in HCP; TT does not declare it | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
