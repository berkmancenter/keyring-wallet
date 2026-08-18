/**
 * The payload validator the §7.2 pipeline requires (SPEC item 2).
 *
 * `@openvtc/trust-tasks` 0.9 made `payloadPolicy` mandatory — skipping schema
 * validation must be an explicit statement, never a default (the fix Keyring
 * proposed in upstream #230). This is the module's single Ajv instance,
 * wired for the registry's JSON Schema 2020-12 documents (all cross-file
 * `$ref`s arrive pre-inlined, so no resolver is needed).
 *
 * @module trust-tasks/validator
 */

import { Ajv2020 } from 'ajv/dist/2020'

const ajv = new Ajv2020({ strict: false })

export const trustTaskPayloadValidator = {
  validate(schema: unknown, payload: unknown): true | { ok: false; errors: string[] } {
    const valid = ajv.validate(schema as object, payload)
    if (valid) return true
    return {
      ok: false,
      errors: (ajv.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
    }
  },
}
