// My own pairing of Trust Task schema objects with HCP schemas, written from each
// spec.md's `carries.operation` and "HCP field mapping" table (out/field-mappings.txt),
// NOT from the PR's scripts/lib/hcp-drift-map.json. Ids follow the PR's convention so
// the two lists can be lined up afterwards.
//   tt  : path under tt-drift/specs/hcp + JSON pointer
//   hcp : path under hcp-spec/schemas/2.0-draft-3 + JSON pointer
//   renames: TT member path -> HCP member name (the **Renamed** rows)
//   extra: true where the PR's map has no such pairing (my addition)
const S = '_shared/0.1';
const P = (slug) => `${slug}/0.1/payload.schema.json`;
const RESP = '#/$defs/Response';

export const objects = [
  // shared value shapes
  { id: 'hcp/_shared:Urn', tt: `${S}/common.schema.json#/$defs/Urn`, hcp: 'common.json#/$defs/urnUuid' },
  { id: 'hcp/_shared:Uri', tt: `${S}/common.schema.json#/$defs/Uri`, hcp: 'common.json#/$defs/uri' },
  { id: 'hcp/_shared:Category', tt: `${S}/common.schema.json#/$defs/Category`, hcp: 'common.json#/$defs/category' },
  { id: 'hcp/_shared:PurposeCode', tt: `${S}/common.schema.json#/$defs/PurposeCode`, hcp: 'common.json#/$defs/purposeCode' },
  { id: 'hcp/_shared:Instant', tt: `${S}/common.schema.json#/$defs/Instant`, hcp: 'common.json#/$defs/dateTime' },
  { id: 'hcp/_shared:Assurance', tt: `${S}/common.schema.json#/$defs/Assurance`, hcp: 'common.json#/$defs/assurance' },
  { id: 'hcp/_shared:RelationshipType', tt: `${S}/common.schema.json#/$defs/RelationshipType`, hcp: 'common.json#/$defs/relationshipType' },
  { id: 'hcp/_shared:MinimizationReport', tt: `${S}/common.schema.json#/$defs/MinimizationReport`, hcp: 'common.json#/$defs/minimization' },
  // shared objects
  { id: 'hcp/_shared:Content', tt: `${S}/context-entry.schema.json#/$defs/Content`, hcp: 'common.json#/$defs/content' },
  { id: 'hcp/_shared:Assertion', tt: `${S}/context-entry.schema.json#/$defs/Assertion`, hcp: 'common.json#/$defs/assertion' },
  { id: 'hcp/_shared:Basis', tt: `${S}/context-entry.schema.json#/$defs/Basis`, hcp: 'common.json#/$defs/basis' },
  { id: 'hcp/_shared:Classification', tt: `${S}/context-entry.schema.json#/$defs/Classification`, hcp: 'common.json#/$defs/classification' },
  { id: 'hcp/_shared:EvidenceItem', tt: `${S}/context-entry.schema.json#/$defs/EvidenceItem`, hcp: 'common.json#/$defs/evidenceItem' },
  { id: 'hcp/_shared:ClientDescription', tt: `${S}/context-entry.schema.json#/$defs/ClientDescription`, hcp: 'common.json#/$defs/clientDescription' },
  { id: 'hcp/_shared:Entry', tt: `${S}/context-entry.schema.json#/$defs/Entry`, hcp: 'entry.json' },
  { id: 'hcp/_shared:Disclosure', tt: `${S}/disclosure.schema.json#/$defs/Disclosure`, hcp: 'disclosure.json' },
  { id: 'hcp/_shared:Named', tt: `${S}/grant.schema.json#/$defs/Named`, hcp: 'common.json#/$defs/named' },
  { id: 'hcp/_shared:LegalRetention', tt: `${S}/grant.schema.json#/$defs/LegalRetention`, hcp: 'common.json#/$defs/legalRetention' },
  { id: 'hcp/_shared:Purpose', tt: `${S}/grant.schema.json#/$defs/Purpose`, hcp: 'common.json#/$defs/purpose' },
  { id: 'hcp/_shared:AccessDetail', tt: `${S}/grant.schema.json#/$defs/AccessDetail`, hcp: 'common.json#/$defs/accessDetail' },
  { id: 'hcp/_shared:Grant', tt: `${S}/grant.schema.json#/$defs/Grant`, hcp: 'grant.json' },
  { id: 'hcp/_shared:StandingRule', tt: `${S}/standing-rule.schema.json#/$defs/StandingRule`, hcp: 'standing-rule.json' },
  { id: 'hcp/_shared:Directive', tt: `${S}/directive.schema.json#/$defs/Directive`, hcp: 'directive.json' },
  { id: 'hcp/_shared:Delegation', tt: `${S}/delegation.schema.json#/$defs/Delegation`, hcp: 'delegation.json' },
  { id: 'hcp/_shared:AuditEvent', tt: `${S}/audit-event.schema.json#/$defs/AuditEvent`, hcp: 'audit-event.json' },
  { id: 'hcp/_shared:Export', tt: `${S}/export.schema.json#/$defs/Export`, hcp: 'export.json' },
  // tasks
  { id: 'hcp/entries/create:request', tt: `${P('entries/create')}#`, hcp: 'operations/create-request.json' },
  { id: 'hcp/entries/create:response', tt: `${P('entries/create')}${RESP}/properties/entry`, hcp: 'operations/create-result.json', wrapped: 'entry' },
  { id: 'hcp/entries/get:request', tt: `${P('entries/get')}#`, hcp: 'operations/get-entry-request.json' },
  { id: 'hcp/entries/get:response', tt: `${P('entries/get')}${RESP}`, hcp: 'operations/get-entry-result.json', renames: { respondedAt: 'timestamp' } },
  { id: 'hcp/entries/query:request', tt: `${P('entries/query')}#`, hcp: 'operations/query-request.json' },
  { id: 'hcp/entries/query:response', tt: `${P('entries/query')}${RESP}`, hcp: 'operations/query-result.json', renames: { respondedAt: 'timestamp' } },
  { id: 'hcp/entries/revise:request', tt: `${P('entries/revise')}#`, hcp: 'operations/revise-request.json' },
  { id: 'hcp/entries/revise:response', tt: `${P('entries/revise')}${RESP}/properties/entry`, hcp: 'operations/revise-result.json', wrapped: 'entry' },
  { id: 'hcp/entries/withdraw:request', tt: `${P('entries/withdraw')}#`, hcp: 'operations/withdraw-request.json' },
  { id: 'hcp/entries/withdraw:response', tt: `${P('entries/withdraw')}${RESP}`, hcp: 'operations/withdraw-result.json', renames: { respondedAt: 'timestamp' } },
  { id: 'hcp/entries/hard-delete:response', tt: `${P('entries/hard-delete')}${RESP}`, hcp: 'operations/withdraw-result.json', renames: { respondedAt: 'timestamp' }, extra: 'HCP 9.4.5 shows one result for DELETE; the PR lists this side as notCompared (Q11)' },
  { id: 'hcp/entries/confirm:response', tt: `${P('entries/confirm')}${RESP}/properties/entry`, hcp: 'entry.json', wrapped: 'entry' },
  { id: 'hcp/entries/set-categories:response', tt: `${P('entries/set-categories')}${RESP}/properties/entry`, hcp: 'entry.json', wrapped: 'entry' },
  { id: 'hcp/entries/restrict-purposes:response', tt: `${P('entries/restrict-purposes')}${RESP}/properties/entry`, hcp: 'entry.json', wrapped: 'entry' },
  { id: 'hcp/import:request', tt: `${P('import')}#`, hcp: 'operations/import-request.json' },
  { id: 'hcp/import:response', tt: `${P('import')}${RESP}`, hcp: 'operations/import-result.json' },
  { id: 'hcp/export:request', tt: `${P('export')}#`, hcp: 'export.json#/properties/options' },
  { id: 'hcp/export:response', tt: `${P('export')}${RESP}/properties/export`, hcp: 'export.json', wrapped: 'export' },
  { id: 'hcp/shares/report:request', tt: `${P('shares/report')}#`, hcp: 'operations/report-sharing-request.json' },
  { id: 'hcp/rules/set:request', tt: `${P('rules/set')}#`, hcp: 'standing-rule.json' },
  { id: 'hcp/rules/set:response', tt: `${P('rules/set')}${RESP}/properties/rule`, hcp: 'standing-rule.json', wrapped: 'rule' },
  { id: 'hcp/rules/list:response', tt: `${P('rules/list')}${RESP}/properties/rules/items`, hcp: 'standing-rule.json', wrapped: 'rules[]' },
  { id: 'hcp/directives/set:request', tt: `${P('directives/set')}#`, hcp: 'directive.json' },
  { id: 'hcp/directives/set:response', tt: `${P('directives/set')}${RESP}/properties/directive`, hcp: 'directive.json', wrapped: 'directive' },
  { id: 'hcp/directives/list:response', tt: `${P('directives/list')}${RESP}/properties/directives/items`, hcp: 'directive.json', wrapped: 'directives[]' },
  { id: 'hcp/delegations/list:response', tt: `${P('delegations/list')}${RESP}`, hcp: 'operations/delegations-result.json' },
  { id: 'hcp/disclosures/summary:response', tt: `${P('disclosures/summary')}${RESP}`, hcp: 'operations/disclosure-summary-result.json' },
  { id: 'hcp/grants/read-own:response', tt: `${P('grants/read-own')}${RESP}/properties/grant`, hcp: 'operations/read-own-grant-result.json', wrapped: 'grant' },
  { id: 'hcp/grants/list:response', tt: `${P('grants/list')}${RESP}/properties/grants/items`, hcp: 'grant.json', wrapped: 'grants[]' },
  { id: 'hcp/audit/read:response', tt: `${P('audit/read')}${RESP}/properties/events/items`, hcp: 'audit-event.json', wrapped: 'events[]' },
  // my additions: the task the PR says carries no HCP schema still reuses HCP shapes
  { id: 'hcp/grants/request:request.access[]', tt: `${P('grants/request')}#/$defs/AccessRequest`, hcp: 'common.json#/$defs/accessDetail', extra: 'spec.md says each detail is "as HCP 6.1.5 defines them"' },
  { id: 'hcp/grants/request:request.requestingParty', tt: `${P('grants/request')}#/$defs/ProposedRequestingParty`, hcp: 'grant.json#/properties/requestingParty', extra: 'spec.md: grant requestingParty "Unchanged"' },
  { id: 'hcp/grants/request:response.grant', tt: `${P('grants/request')}${RESP}/properties/grant`, hcp: 'grant.json', extra: 'spec.md: HCP grant object "whole and unrenamed"', wrapped: 'grant' },
];

// Task sides with no HCP JSON Schema at all (my reading of the HCP schema directory).
export const noHcpSchema = [
  'hcp/audit/read:request', 'hcp/delegations/end:request', 'hcp/delegations/end:response', 'hcp/delegations/list:request',
  'hcp/directives/list:request', 'hcp/directives/remove:request', 'hcp/directives/remove:response',
  'hcp/disclosures/summary:request', 'hcp/entries/confirm:request', 'hcp/entries/hard-delete:request',
  'hcp/entries/restrict-purposes:request', 'hcp/entries/set-categories:request', 'hcp/grants/list:request',
  'hcp/grants/read-own:request', 'hcp/grants/relinquish:request', 'hcp/grants/relinquish:response',
  'hcp/grants/revoke:request', 'hcp/grants/revoke:response', 'hcp/grants/revoked:request', 'hcp/grants/revoked:response',
  'hcp/rules/list:request', 'hcp/rules/remove:request', 'hcp/rules/remove:response', 'hcp/shares/report:response',
];
