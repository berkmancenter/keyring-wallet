/**
 * The vendored `hcp/*` schemas (`hcp-suite-4e2dd42fa/`, see its README) compiled for the HCP tests: a request and a
 * response validator for each of the three tasks Keyring sends. Each shared file is added under its own `$id`; each
 * payload schema under the URL of its file, since its `$id` is its directory and its relative `$ref`s resolve to the
 * shared `$id`s only from the file.
 */
import Ajv, { type ValidateFunction } from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { HCP_DISCLOSURES_SUMMARY, HCP_ENTRIES_CREATE, HCP_GRANTS_REVOKE } from '../../types'

export const HCP_SUITE_DIR = join(__dirname, 'hcp-suite-4e2dd42fa')

const SHARED = [
  'common.schema.json',
  'context-entry.schema.json',
  'disclosure.schema.json',
  'entry-write.schema.json',
  'grant.schema.json',
]

/** The vendored payload schema of each task, by its path under the fixture folder. */
export const HCP_PAYLOAD_FILES: Record<string, string> = {
  [HCP_ENTRIES_CREATE]: 'specs/hcp/entries/create/0.1/payload.schema.json',
  [HCP_GRANTS_REVOKE]: 'specs/hcp/grants/revoke/0.1/payload.schema.json',
  [HCP_DISCLOSURES_SUMMARY]: 'specs/hcp/disclosures/summary/0.1/payload.schema.json',
}

export const readHcpSchema = (file: string) =>
  JSON.parse(readFileSync(join(HCP_SUITE_DIR, file), 'utf8')) as Record<string, unknown>

export type HcpValidators = Record<string, { request: ValidateFunction; response: ValidateFunction }>

export function hcpSchemas(): HcpValidators {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  for (const file of SHARED) ajv.addSchema(readHcpSchema(`specs/hcp/_shared/0.1/${file}`))
  const validators: HcpValidators = {}
  for (const [type, file] of Object.entries(HCP_PAYLOAD_FILES)) {
    const schema = { ...readHcpSchema(file) }
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
