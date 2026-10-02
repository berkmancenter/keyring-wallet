/**
 * Which version of the join tasks a community is asked in.
 *
 * The refusals are shaped as vtc-service sends them
 * (`unsupported_type_or_version`, trust_tasks/mod.rs): the standard code
 * `unsupportedVersion`, and the URIs it serves for that task in
 * `details.servedVersions`. The submit payloads are checked against the
 * published 0.3 schema's own member list (dtgwg-trust-tasks-tf e675cc1b).
 */
import { JOIN_MANIFEST_TYPES, joinTaskType, submitPayload, wireAfterRefusal, wiresToTry } from '../module/joinWire'

import submitSchema from './fixtures/join-0.3/submit-payload.schema.json'

const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest'
const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit'
const vp = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiablePresentation'], holder: 'did:x' }

describe('the task types', () => {
  it('names each task at each version', () => {
    expect(joinTaskType('manifest', '0.3')).toBe(`${MANIFEST}/0.3`)
    expect(joinTaskType('submit', '0.2')).toBe(`${SUBMIT}/0.2`)
    expect(JOIN_MANIFEST_TYPES).toEqual([`${MANIFEST}/0.3`, `${MANIFEST}/0.2`])
  })

  it('asks the newest version first, and the one a community last answered before any other', () => {
    expect(wiresToTry()).toEqual(['0.3', '0.2'])
    expect(wiresToTry('0.2')).toEqual(['0.2', '0.3'])
  })
})

describe('the version to ask in after a refusal', () => {
  it('falls back to 0.2 when a community older than vti #1907 refuses 0.3', () => {
    const refusal = {
      code: 'unsupportedVersion',
      details: { requestedType: `${MANIFEST}/0.3`, servedVersions: [`${MANIFEST}/0.1`, `${MANIFEST}/0.2`] },
    }
    expect(wireAfterRefusal(refusal, 'manifest', ['0.3'])).toBe('0.2')
  })

  it('moves up to 0.3 when a community with vti #1907 refuses 0.2', () => {
    const refusal = { code: 'unsupportedVersion', details: { servedVersions: [`${SUBMIT}/0.3`] } }
    expect(wireAfterRefusal(refusal, 'submit', ['0.2'])).toBe('0.3')
  })

  it('has nowhere to go when the community serves no version this wallet speaks', () => {
    const refusal = { code: 'unsupportedVersion', details: { servedVersions: [`${MANIFEST}/0.4`] } }
    expect(wireAfterRefusal(refusal, 'manifest', ['0.3'])).toBeUndefined()
  })

  it('reads only the versions served for the task that was asked', () => {
    const refusal = { code: 'unsupportedVersion', details: { servedVersions: [`${SUBMIT}/0.2`, `${MANIFEST}/0.3`] } }
    expect(wireAfterRefusal(refusal, 'manifest', ['0.2'])).toBe('0.3')
  })

  it('tries what is left when the refusal names nothing, and an older community says unsupportedType', () => {
    expect(wireAfterRefusal({ code: 'unsupportedVersion' }, 'manifest', ['0.3'])).toBe('0.2')
    expect(wireAfterRefusal({ code: 'unsupportedType' }, 'manifest', ['0.3'])).toBe('0.2')
    expect(wireAfterRefusal({ code: 'unsupportedVersion' }, 'manifest', ['0.3', '0.2'])).toBeUndefined()
  })

  it('is not a reason to ask again for any other refusal, or for no answer at all', () => {
    expect(wireAfterRefusal({ code: 'vtc/join-requests/submit:requestAlreadyOpen' }, 'submit', ['0.3'])).toBeUndefined()
    expect(wireAfterRefusal({ code: 'malformedRequest' }, 'submit', ['0.3'])).toBeUndefined()
    expect(wireAfterRefusal(undefined, 'submit', ['0.3'])).toBeUndefined()
  })
})

describe('the submit payload', () => {
  const declared = Object.keys(submitSchema.properties)

  it('at 0.3 names the criterion in `criterion`, with only members the schema declares', () => {
    const payload = submitPayload('0.3', { vp, registryConsent: false, criterion: 'zQmDigest' })
    expect(payload).toEqual({ vp, registryConsent: false, criterion: 'zQmDigest' })
    expect(submitSchema.additionalProperties).toBe(false)
    expect(Object.keys(payload).every((member) => declared.includes(member))).toBe(true)
    expect(submitSchema.required.every((member) => member in payload)).toBe(true)
  })

  it('at 0.3 names no criterion when none was chosen: the community decides which governs', () => {
    expect(submitPayload('0.3', { vp, registryConsent: true })).toEqual({ vp, registryConsent: true })
  })

  it('at 0.2 carries the digest where a 0.2 community reads it, and no `criterion`', () => {
    expect(submitPayload('0.2', { vp, registryConsent: false, criterion: 'zQmDigest' })).toEqual({
      vp,
      registryConsent: false,
      extensions: { requirementsDigest: 'zQmDigest' },
    })
    expect(submitPayload('0.2', { vp, registryConsent: false })).toEqual({ vp, registryConsent: false, extensions: {} })
  })
})
