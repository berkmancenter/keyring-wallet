/**
 * The request and response validators for the two reads of "What my agent saw": `hcp/audit/read/0.1`, vendored here
 * (`hcp-suite-4e2dd42fa/`, see its README), and `hcp/disclosures/summary/0.1`, from the HCP suite folder track C
 * vendored (`../../../__tests__/fixtures/hcp-suite-4e2dd42fa/`), read and not changed. Built as
 * `../../../__tests__/fixtures/hcpSchemas.ts` builds its own: each shared file under its own `$id`, each payload
 * schema under the URL of its file.
 */
import Ajv, { type ValidateFunction } from 'ajv/dist/2020'
import { readFileSync } from 'fs'
import { join } from 'path'

import { HCP_DISCLOSURES_SUMMARY } from '../../../types'
import { HCP_AUDIT_READ } from '../../audit'

/** The audit schemas this part vendors. */
export const WHAT_IT_SAW_SUITE_DIR = join(__dirname, 'hcp-suite-4e2dd42fa')
/** The HCP suite track C vendored, at the same commit. */
const TRACK_C_SUITE_DIR = join(__dirname, '..', '..', '..', '__tests__', 'fixtures', 'hcp-suite-4e2dd42fa')

const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>

const TRACK_C_SHARED = [
  'common.schema.json',
  'context-entry.schema.json',
  'disclosure.schema.json',
  'entry-write.schema.json',
  'grant.schema.json',
]

/** Each read's payload schema: the folder it is in, and its path there. */
export const WHAT_IT_SAW_PAYLOADS: Record<string, { dir: string; file: string }> = {
  [HCP_AUDIT_READ]: { dir: WHAT_IT_SAW_SUITE_DIR, file: 'specs/hcp/audit/read/0.1/payload.schema.json' },
  [HCP_DISCLOSURES_SUMMARY]: {
    dir: TRACK_C_SUITE_DIR,
    file: 'specs/hcp/disclosures/summary/0.1/payload.schema.json',
  },
}

export const readWhatItSawSchema = (file: string) => read(WHAT_IT_SAW_SUITE_DIR, file)

export type WhatItSawValidators = Record<string, { request: ValidateFunction; response: ValidateFunction }>

export function whatItSawSchemas(): WhatItSawValidators {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, logger: false })
  for (const file of TRACK_C_SHARED) ajv.addSchema(read(TRACK_C_SUITE_DIR, `specs/hcp/_shared/0.1/${file}`))
  ajv.addSchema(readWhatItSawSchema('specs/hcp/_shared/0.1/audit-event.schema.json'))
  const validators: WhatItSawValidators = {}
  for (const [type, { dir, file }] of Object.entries(WHAT_IT_SAW_PAYLOADS)) {
    const schema = { ...read(dir, file) }
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
