| vector | HCP schema | TT schema | HCP | TT | #1381 lists it | note |
|---|---|---|---|---|---|---|
| temporary grant without expiresAt | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | **rejects** | **rejects** | yes |  |
| temporary grant with expiresAt null | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | **rejects** | accepts | yes |  |
| persistent grant with an expiresAt instant | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | **rejects** | accepts | yes |  |
| get request naming both ref and entryId | `operations/get-entry-request.json` | `entries/get/0.1/payload.schema.json` | accepts | accepts | yes |  |
| get request naming neither ref nor entryId | `operations/get-entry-request.json` | `entries/get/0.1/payload.schema.json` | accepts | accepts | yes |  |
| withdraw request naming both ref and entryId | `operations/withdraw-request.json` | `entries/withdraw/0.1/payload.schema.json` | accepts | accepts | yes |  |
| withdraw result naming both ref and entryId | `operations/withdraw-result.json` | `entries/withdraw/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | yes |  |
| withdraw result with hardDeleted true | `operations/withdraw-result.json` | `entries/withdraw/0.1/payload.schema.json#/$defs/Response` | accepts | **rejects** | - | Q10: TT closes hardDeleted to false on withdraw; HCP 9.4.5 answers DELETE with the same shape |
| get result, directives absent | `operations/get-entry-result.json` | `entries/get/0.1/payload.schema.json#/$defs/Response` | accepts | **rejects** | - | Q42 presence |
| get result, directives null | `operations/get-entry-result.json` | `entries/get/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | - | Q5: null for a Management Client |
| query result, directives null | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | - | Q5 |
| audit event, entryId absent | `audit-event.json` | `_shared/audit-event.schema.json#/$defs/AuditEvent` | accepts | **rejects** | - | Q42: TT requires the member (null when none) |
| audit event, entryId null | `audit-event.json` | `_shared/audit-event.schema.json#/$defs/AuditEvent` | accepts | accepts | - |  |
| audit event, purpose null | `audit-event.json` | `_shared/audit-event.schema.json#/$defs/AuditEvent` | accepts | accepts | - |  |
| restrict-purposes request, permittedPurposes null (removes the narrowing) | `-` | `entries/restrict-purposes/0.1/payload.schema.json` | n/a | accepts | - | no HCP schema: HCP 9.4.10 prose says null removes the narrowing |
| restrict-purposes request, permittedPurposes absent | `-` | `entries/restrict-purposes/0.1/payload.schema.json` | n/a | **rejects** | - |  |
| grant, expiresAt null on a persistent grant (control) | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | accepts | accepts | - |  |
| entry whose type lacks ContextEntry | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | **rejects** | accepts | yes |  |
| entry, model-inferred with confidence null | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | **rejects** | accepts | yes |  |
| entry, General Context content without value | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | **rejects** | accepts | yes |  |
| entry with a member HCP does not define (HCP 4.2, A.3: preserved) | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | accepts | accepts | - |  |
| create request with a member HCP does not define (HCP 4.2, A.3) | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | **rejects** | - | TT payload root is additionalProperties:false |
| create request with record.metadata (nested, open on both sides) | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | accepts | - |  |
| create request with classification.permittedPurposes | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | accepts | yes | Q7 (allowlisted hcp-only) |
| revise request carrying subject | `operations/revise-request.json` | `entries/revise/0.1/payload.schema.json` | **rejects** | **rejects** | - | HCP `not` rule vs TT closed root |
| standing rule with neither operators nor requires | `standing-rule.json` | `rules/set/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | yes |  |
| rules/set request with neither operators nor requires | `-` | `rules/set/0.1/payload.schema.json` | n/a | **rejects** | - | request side: the TT schema has the anyOf |
| import whose export holds a rule with neither | `operations/import-request.json` | `import/0.1/payload.schema.json` | **rejects** | accepts | yes |  |
| import of a realistic export (control) | `operations/import-request.json` | `import/0.1/payload.schema.json` | accepts | accepts | - |  |
| query with empty categories | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | **rejects** | - | Q42: documented |
| query with 257 categories | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | **rejects** | - | framework bound 256 |
| query with maxEntries 1000 | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | accepts | - | neither side caps it; the provider returns at most 20 |
| query result with 21 entries | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | **rejects** | **rejects** | - | HCP 7.2 cap on both sides |
| query with a 2049-character purpose | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | **rejects** | - | framework bound 2048 on every URI |
| entry content.language of 65 characters | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | accepts | **rejects** | - | undocumented bound 64 |
| create request with 65 evidence items | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | **rejects** | - | framework bound 64 |
| accessToken of 8193 characters | `-` | `entries/query/0.1/payload.schema.json` | n/a | **rejects** | - | carriage member; framework bound 8192 |
| query result: disclosed VC evidence item without credential | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | **no** | #1381 lists this rule for get (anyOf/0) but not for query |
| query result: disclosed VC evidence item WITH a credential (control) | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | accepts | accepts | - |  |
| disclosed evidence item with revealed (allOf over an open EvidenceItem) | `disclosure.json` | `_shared/disclosure.schema.json#/$defs/Disclosure` | accepts | accepts | - |  |
| category "health_context" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| category "Health" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | **rejects** | - |  |
| category "foo:" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | **rejects** | - |  |
| category "foo:bar" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| category "a:b c" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | **rejects** | - |  |
| category "x:<y>" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | accepts | - |  |
| category "a:%zz" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | accepts | - |  |
| category "https://cat.example/x" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| category "urn:x:y" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| directive action "share" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | accepts | accepts | - |  |
| directive action "Share" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | **rejects** | - |  |
| directive action "foo:" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | **rejects** | - |  |
| directive action "x:<y>" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | accepts | - |  |
| directive action "a:%zz" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | accepts | - |  |
| directive action "https://act.example/x" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | accepts | accepts | - |  |
| delegation relationship "caregiver" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | accepts | accepts | - |  |
| delegation relationship "Caregiver" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | **rejects** | **rejects** | - |  |
| delegation relationship "foo:" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | **rejects** | **rejects** | - |  |
| delegation relationship "x:<y>" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | **rejects** | accepts | - |  |
| delegation relationship "https://rel.example/x" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | accepts | accepts | - |  |
| audit purpose "https://purposes.example/x" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | accepts | accepts | - |  |
| audit purpose "x:<y>" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | **rejects** | accepts | - |  |
| audit purpose "a:%zz" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | **rejects** | accepts | - |  |
| audit purpose "foo:" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | **rejects** | **rejects** | - |  |
| purpose code "x:<y>" (control: both have format uri) | `common.json#/$defs/purposeCode` | `_shared/common.schema.json#/$defs/PurposeCode` | **rejects** | **rejects** | - |  |
| purpose code "a:%zz" (control: both have format uri) | `common.json#/$defs/purposeCode` | `_shared/common.schema.json#/$defs/PurposeCode` | **rejects** | **rejects** | - |  |
