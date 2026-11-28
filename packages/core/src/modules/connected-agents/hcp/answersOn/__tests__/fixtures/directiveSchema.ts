/**
 * The vendored `hcp/directives/set/0.1` schemas compiled for the "Answers on" tests: a request and a response
 * validator. The payload and `_shared/directive` come from `hcp-suite-4e2dd42fa/` here (see its README);
 * `_shared/common` from the `hcp/*` fixture folder at the same pin. As in `../../../__tests__/fixtures/hcpSchemas.ts`,
 * each shared file is added under its own `$id` and the payload under the URL of its file.
 */
import Ajv, { type ValidateFunction } from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { HCP_SUITE_DIR } from '../../../__tests__/fixtures/hcpSchemas'
import { HCP_DIRECTIVES_SET } from '../../directive'

const HERE = join(__dirname, 'hcp-suite-4e2dd42fa')

const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>

export function directiveSetSchemas(): { request: ValidateFunction; response: ValidateFunction } {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  ajv.addSchema(read(HCP_SUITE_DIR, 'specs/hcp/_shared/0.1/common.schema.json'))
  ajv.addSchema(read(HERE, 'specs/hcp/_shared/0.1/directive.schema.json'))
  const schema = { ...read(HERE, 'specs/hcp/directives/set/0.1/payload.schema.json') }
  if (schema.$id !== HCP_DIRECTIVES_SET) throw new Error(`directives/set has $id ${String(schema.$id)}`)
  const url = `${HCP_DIRECTIVES_SET}/payload.schema.json`
  delete schema.$id
  ajv.addSchema(schema, url)
  const request = ajv.getSchema(url)
  if (!request) throw new Error('no schema for directives/set')
  return { request, response: ajv.compile({ $ref: `${url}#/$defs/Response` }) }
}

/** Throws with Ajv's errors when `value` does not validate. */
export function expectValid(validate: ValidateFunction, value: unknown): void {
  if (!validate(value)) throw new Error(JSON.stringify(validate.errors, null, 1))
}

/** A `directives/set` answer for `payload`, as a fake VTA gives it. */
export function directiveAnswer(payload: Record<string, unknown>, directiveId: string): Record<string, unknown> {
  return {
    directive: { ...payload, directiveId, setBy: 'context-subject', createdAt: '2026-11-27T12:00:01Z' },
  }
}
