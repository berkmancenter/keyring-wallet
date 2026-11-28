/**
 * The vendored `hcp/entries/get`, `withdraw` and `revise` 0.1 schemas compiled for the C10 seam's tests: a request and
 * a response validator for each. The three payloads come from `hcp-suite-4e2dd42fa/` here (see its README); the
 * shared files from the `hcp/*` fixture folder at the same pin, and `_shared/directive` (which `entries/get`'s
 * response names) from the "Answers on" fixture folder at that pin. As in
 * `../../../__tests__/fixtures/hcpSchemas.ts`, each shared file is added under its own `$id` and each payload under
 * the URL of its file.
 */
import Ajv, { type ValidateFunction } from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { HCP_SUITE_DIR } from '../../../__tests__/fixtures/hcpSchemas'
import { HCP_ENTRIES_GET, HCP_ENTRIES_REVISE, HCP_ENTRIES_WITHDRAW } from '../../management'

const HERE = join(__dirname, 'hcp-suite-4e2dd42fa')
const ANSWERS_ON = join(__dirname, '../../../answersOn/__tests__/fixtures/hcp-suite-4e2dd42fa')

const SHARED = [
  'common.schema.json',
  'context-entry.schema.json',
  'disclosure.schema.json',
  'entry-write.schema.json',
  'grant.schema.json',
]

/** Each task's vendored payload schema, by its path under this fixture folder. */
export const ENTRIES_PAYLOAD_FILES: Record<string, string> = {
  [HCP_ENTRIES_GET]: 'specs/hcp/entries/get/0.1/payload.schema.json',
  [HCP_ENTRIES_WITHDRAW]: 'specs/hcp/entries/withdraw/0.1/payload.schema.json',
  [HCP_ENTRIES_REVISE]: 'specs/hcp/entries/revise/0.1/payload.schema.json',
}

const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>

export type EntriesValidators = Record<string, { request: ValidateFunction; response: ValidateFunction }>

export function entriesSchemas(): EntriesValidators {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  for (const file of SHARED) ajv.addSchema(read(HCP_SUITE_DIR, `specs/hcp/_shared/0.1/${file}`))
  ajv.addSchema(read(ANSWERS_ON, 'specs/hcp/_shared/0.1/directive.schema.json'))
  const validators: EntriesValidators = {}
  for (const [type, file] of Object.entries(ENTRIES_PAYLOAD_FILES)) {
    const schema = { ...read(HERE, file) }
    if (schema.$id !== type) throw new Error(`${file} has $id ${String(schema.$id)}, not ${type}`)
    const url = `${type}/payload.schema.json`
    delete schema.$id
    ajv.addSchema(schema, url)
    const request = ajv.getSchema(url)
    if (!request) throw new Error(`no schema for ${type}`)
    validators[type] = { request, response: ajv.compile({ $ref: `${url}#/$defs/Response` }) }
  }
  return validators
}

/** Throws with Ajv's errors when `value` does not validate. */
export function expectValid(validate: ValidateFunction, value: unknown): void {
  if (!validate(value)) throw new Error(JSON.stringify(validate.errors, null, 1))
}
