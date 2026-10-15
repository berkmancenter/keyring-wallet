/**
 * The vendored `vtc/vetting/pcs-challenge/0.1` and `vtc/join-requests/submit/0.3`
 * schemas (`vtc-join-schemas/`, copied at the commit its `PROVENANCE.sha`
 * names), compiled so a test grades a payload against the registry's own
 * schema rather than its reading of it. Same approach as `pcsVtaPayloads.test.ts`.
 *
 * @module trust-tasks/__tests__/fixtures/vtcJoinSchemas
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
// The registry's schemas declare draft 2020-12; ajv's default export is draft-07.
import Ajv from 'ajv/dist/2020'

export const VTC_JOIN_SCHEMA_DIR = join(__dirname, 'vtc-join-schemas')
/** The URLs the payload schemas' relative `$ref`s resolve to (see pcsVtaPayloads.test.ts for why by hand). */
const REGISTER_AS: Record<string, string[]> = {
  'framework-0.2.schema.json': ['https://trusttasks.org/_framework/0.2/framework.schema.json'],
  'framework-0.3.schema.json': ['https://trusttasks.org/_framework/0.3/framework.schema.json'],
  'vtc-shared-ceremony.schema.json': ['https://trusttasks.org/spec/vtc/_shared/0.1/ceremony.schema.json'],
}
/** Validate against a vendored schema, or one of its `$defs` by anchor (`#response`). */
export function vendoredValidator(file: string, anchor?: string) {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  for (const f of readdirSync(VTC_JOIN_SCHEMA_DIR).filter((n) => n.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(VTC_JOIN_SCHEMA_DIR, f), 'utf8')) as { $id?: string }
    for (const id of [s.$id, ...(REGISTER_AS[f] ?? [])].filter(Boolean) as string[]) {
      try {
        ajv.addSchema(s, id)
      } catch {
        // already registered under an equivalent id
      }
    }
  }
  const own = JSON.parse(readFileSync(join(VTC_JOIN_SCHEMA_DIR, file), 'utf8')) as { $id: string }
  return ajv.compile({ $ref: `${own.$id}${anchor ? `#${anchor}` : ''}` })
}
