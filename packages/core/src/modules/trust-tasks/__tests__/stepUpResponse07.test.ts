/**
 * `auth/step-up/approve-response/0.7` (trust-tasks-tf a91f2e76): from 84ed3250 (vta-service v0.68.0) the agent
 * answers a step-up only in 0.7, and refused this phone's 0.6 as `unsupportedVersion`, so on a 0.68 agent every
 * approval from the phone was refused. 0.7 is asked first now, 0.6 next, then the request's own version, so an
 * agent on an older build is still answered.
 *
 * The shape is held by the registry's own schemas (fixtures/step-up-schemas): 0.7 has 0.6's members, so the answer
 * checked against 0.6 in stepUp.test.ts is one a 0.7 relying party takes.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { STEP_UP_TASK, approveResponseTypeFor, approveResponseTypesFor } from '../module/stepUp'

import { expectNoDrift, registryPath } from './fixtures/registryDrift'

const SCHEMA_DIR = join(__dirname, 'fixtures', 'step-up-schemas')
const schema = (version: '0.6' | '0.7') =>
  JSON.parse(readFileSync(join(SCHEMA_DIR, `approve-response-${version}.payload.schema.json`), 'utf8'))

/** A schema with its words and its own version's name taken out: what is left is the shape. */
const shape = (s: unknown): unknown =>
  JSON.parse(
    JSON.stringify(s, (key, value) =>
      key === 'description' || key === '$id'
        ? undefined
        : typeof value === 'string'
          ? value.replace(/approve-response\/0\.[67]/g, 'approve-response/*')
          : value
    )
  )

const SPEC = 'https://trusttasks.org/spec/auth/step-up/'

describe('auth/step-up/approve-response/0.7', () => {
  it('is the type the phone knows', () => {
    expect(STEP_UP_TASK.approveResponse07).toBe(`${SPEC}approve-response/0.7`)
  })

  it("has 0.6's shape: the same members, the same required ones, the same evidence kinds", () => {
    expect(shape(schema('0.7'))).toEqual(shape(schema('0.6')))
  })

  it('is asked first, then 0.6, then the request’s own version, for every request the phone reads', () => {
    // What vta-service mints from 0d3f268e (approve-request/0.5), answered at 0.7 by v0.68.0 and at 0.6 before it.
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest05)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
    ])
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest04)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
    ])
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest03)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
      STEP_UP_TASK.approveResponse05,
    ])
    expect(approveResponseTypesFor(STEP_UP_TASK.approveRequest02)).toEqual([
      STEP_UP_TASK.approveResponse07,
      STEP_UP_TASK.approveResponse06,
      STEP_UP_TASK.approveResponse,
    ])
  })

  it("the request's own version stays what it was: the last step down, never moved by 0.7", () => {
    expect(approveResponseTypeFor(STEP_UP_TASK.approveRequest05)).toBe(STEP_UP_TASK.approveResponse06)
    expect(approveResponseTypeFor(STEP_UP_TASK.approveRequest02)).toBe(STEP_UP_TASK.approveResponse)
  })
})

describe('the vendored approve-response schemas still match the registry', () => {
  const maybe = registryPath() ? it : it.skip

  maybe('the same JSON documents as at the commit PROVENANCE names', () => {
    expectNoDrift(
      SCHEMA_DIR,
      {
        'approve-response-0.6.payload.schema.json': 'specs/auth/step-up/approve-response/0.6/payload.schema.json',
        'approve-response-0.7.payload.schema.json': 'specs/auth/step-up/approve-response/0.7/payload.schema.json',
      },
      { as: 'json' }
    )
  })
})
