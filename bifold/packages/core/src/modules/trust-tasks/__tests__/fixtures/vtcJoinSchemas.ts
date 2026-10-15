/**
 * Vendored Trust Task schemas, compiled so a test grades a payload against the
 * registry's own schema rather than its reading of it. Same approach as
 * `pcsVtaPayloads.test.ts`; each directory is copied verbatim at the commit its
 * `PROVENANCE.sha` names, and its README says which.
 *
 * - `vtc-join-schemas/`: `vtc/vetting/pcs-challenge/0.1`, `vtc/join-requests/submit/0.3`.
 * - `vetting-schemas/`: `vetting/attestation/0.1`, `vetting/request/0.1`.
 *
 * @module trust-tasks/__tests__/fixtures/vtcJoinSchemas
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
// The registry's schemas declare draft 2020-12; ajv's default export is draft-07.
import Ajv from 'ajv/dist/2020'

export const VTC_JOIN_SCHEMA_DIR = join(__dirname, 'vtc-join-schemas')
export const VETTING_SCHEMA_DIR = join(__dirname, 'vetting-schemas')

/**
 * The URLs the payload schemas' relative `$ref`s actually resolve to, which
 * are not the referenced schemas' own `$id`s (see pcsVtaPayloads.test.ts).
 * Written out rather than computed, so a change upstream shows as a failure to
 * resolve instead of being papered over.
 */
const REGISTER_AS: Record<string, string[]> = {
  'framework-0.2.schema.json': ['https://trusttasks.org/_framework/0.2/framework.schema.json'],
  'framework-0.3.schema.json': ['https://trusttasks.org/_framework/0.3/framework.schema.json'],
  'vtc-shared-ceremony.schema.json': ['https://trusttasks.org/spec/vtc/_shared/0.1/ceremony.schema.json'],
  // From `vetting/attestation/0.1`: `../../../vetting/_shared/0.1/hidden-vetting.schema.json`.
  'vetting-shared-hidden-vetting.schema.json': [
    'https://trusttasks.org/vetting/_shared/0.1/hidden-vetting.schema.json',
  ],
  // From `vetting/request/0.1`: `../../_shared/0.1/vetting.schema.json`.
  'vetting-shared-vetting.schema.json': ['https://trusttasks.org/spec/_shared/0.1/vetting.schema.json'],
}

/** Validate against a schema in `dir`, or one of its `$defs` by anchor (`#response`). */
export function vendoredValidatorIn(dir: string, file: string, anchor?: string) {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { $id?: string }
    for (const id of [s.$id, ...(REGISTER_AS[f] ?? [])].filter(Boolean) as string[]) {
      try {
        ajv.addSchema(s, id)
      } catch {
        // already registered under an equivalent id
      }
    }
  }
  const own = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { $id: string }
  return ajv.compile({ $ref: `${own.$id}${anchor ? `#${anchor}` : ''}` })
}

/** `vendoredValidatorIn` for `vtc-join-schemas/`. */
export const vendoredValidator = (file: string, anchor?: string) =>
  vendoredValidatorIn(VTC_JOIN_SCHEMA_DIR, file, anchor)
