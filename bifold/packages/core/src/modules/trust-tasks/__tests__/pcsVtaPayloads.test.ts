/**
 * The applicant's five `vta/pcs/*` payloads are graded by the registry's own
 * JSON Schemas, not by our reading of them.
 *
 * The schemas live in `dtgwg-trust-tasks-tf`, which this repository does not
 * depend on and CI cannot reach, so they are vendored under
 * `fixtures/pcs-schemas/` with the commit they came from in `PROVENANCE.sha`.
 * The last test here fails when that copy has drifted from the registry, but
 * only where the registry is actually checked out — on CI it skips rather than
 * passing silently, which is the honest behaviour for a check whose input is
 * absent.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import Ajv from 'ajv'

import {
  ApplicationsCreatePayload,
  HIDDEN_VETTING_SUITE,
  ProvePayload,
  VerifyAttestationPayload,
  parametersToSend,
  pcsErrorCode,
} from '../module/pcsVtaPayloads'

const SCHEMA_DIR = join(__dirname, 'fixtures', 'pcs-schemas')

/**
 * Ajv with every vendored schema registered under both the id it declares and
 * the relative path its siblings `$ref` it by, so cross-file references
 * resolve without rewriting the schemas we are supposed to be checked against.
 */
function validatorFor(file: string) {
  const ajv = new Ajv({ strict: false, allErrors: true })
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.json'))
  const byName: Record<string, unknown> = {}
  for (const f of files) byName[f] = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8'))

  // The registry refs siblings by relative path; map each to the flat name it
  // was vendored under, so '…/_shared/0.4/pcs-engine.schema.json' resolves.
  const alias: Record<string, string> = {
    'vta-shared-pcs-engine.schema.json': 'pcs-engine.schema.json',
    'vetting-shared-hidden-vetting.schema.json': 'hidden-vetting.schema.json',
  }
  for (const [f, schema] of Object.entries(byName)) {
    const s = schema as Record<string, unknown>
    const tail = alias[f]
    for (const id of [f, tail].filter(Boolean) as string[]) {
      try {
        ajv.addSchema(s, id)
      } catch {
        // already registered under an equivalent id
      }
    }
  }
  return ajv.compile(byName[file] as object)
}

const publishedConfig = {
  suite: HIDDEN_VETTING_SUITE,
  helperKey: 'z6MkhelperKeyExample',
  tokenKey: 'z6MktokenKeyExample',
  vetterLabels: ['vetter/2026-10'],
  tokenLabels: ['token/2026-10'],
  dripPerTick: 3,
  tickLength: 'P3D',
  events: [],
}

describe('the parameters a community publishes, completed as the engine requires', () => {
  it('passes a complete config through unchanged', () => {
    expect(parametersToSend(publishedConfig)).toEqual(publishedConfig)
  })

  it('fills in what a community may leave out', () => {
    const { tickLength: _t, dripPerTick: _d, events: _e, ...sparse } = publishedConfig
    expect(parametersToSend(sparse)).toMatchObject({ tickLength: 'P3D', dripPerTick: 3, events: [] })
  })

  it('never sends a drip below 1, which the schema forbids', () => {
    expect(parametersToSend({ ...publishedConfig, dripPerTick: 0 })?.dripPerTick).toBe(1)
  })

  it('refuses a suite we do not implement rather than completing it', () => {
    // Downgrading here is the failure mode the criticality marker exists to
    // prevent: a suite we cannot prove must stop, not proceed half-built.
    expect(parametersToSend({ ...publishedConfig, suite: 'ps-other-suite' })).toBeUndefined()
  })

  it('refuses configuration that is missing a key, rather than inventing one', () => {
    const { helperKey: _h, ...noHelper } = publishedConfig
    expect(parametersToSend(noHelper)).toBeUndefined()
  })
})

describe('every payload validates against the registry schema it is built for', () => {
  const parameters = parametersToSend(publishedConfig)!

  it('applications/create', () => {
    const payload: ApplicationsCreatePayload = {
      contextId: 'ctx-1',
      community: 'did:webvh:QmCommunity:example.org',
      joinDid: 'did:peer:2.Ejoin',
      parameters,
    }
    const validate = validatorFor('vta-pcs-applications-create.payload.schema.json')
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('applications/show and applications/delete', () => {
    for (const file of [
      'vta-pcs-applications-show.payload.schema.json',
      'vta-pcs-applications-delete.payload.schema.json',
    ]) {
      const validate = validatorFor(file)
      expect(validate({ applicationId: 'app-1' }) || validate.errors).toBe(true)
    }
  })

  it('verify-attestation', () => {
    const payload: VerifyAttestationPayload = {
      applicationId: 'app-1',
      parameters,
      attestation: {
        suite: HIDDEN_VETTING_SUITE,
        attestation: 'z2attestationBytes',
        meta: {
          community: 'did:webvh:QmCommunity:example.org',
          requirementsDigest: 'zQmRequirements',
          method: 'in-person',
          claimsVerified: ['name'],
          livenessConfirmed: true,
          declaredRelationship: 'colleague',
          identityCommitment: 'zQmIdentity',
          cardDigestMultibase: 'zQmCard',
          validFrom: '2026-10-14T00:00:00Z',
          validUntil: '2026-11-14T00:00:00Z',
          tokenLabel: 'token/2026-10',
          tokenSerial: 'z2serial',
        },
        token: { label: 'token/2026-10', serial: 'z2serial', shown: 'z2shown' },
      },
    }
    const validate = validatorFor('vta-pcs-verify-attestation.payload.schema.json')
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('prove', () => {
    const payload: ProvePayload = {
      applicationId: 'app-1',
      parameters,
      requirementsDigest: 'zQmRequirements',
      challenge: 'challenge-from-the-community',
    }
    const validate = validatorFor('vta-pcs-prove.payload.schema.json')
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('a payload missing a required member is refused by the schema, so these tests can fail', () => {
    const validate = validatorFor('vta-pcs-prove.payload.schema.json')
    expect(validate({ applicationId: 'app-1', parameters })).toBe(false)
  })
})

describe('a refusal is read from the error document', () => {
  it('reads payload.code', () => {
    expect(pcsErrorCode({ payload: { code: 'vta/pcs/prove:noUsableAttestation' } })).toBe(
      'vta/pcs/prove:noUsableAttestation'
    )
  })

  it('is undefined for anything that is not one', () => {
    expect(pcsErrorCode({ payload: {} })).toBeUndefined()
    expect(pcsErrorCode(undefined)).toBeUndefined()
  })
})

describe('the vendored schemas still match the registry', () => {
  // Only meaningful where the registry is checked out: this repository does not
  // depend on it, and CI has no copy.
  const registry = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'external',
    'dtgwg-trust-tasks-tf'
  )
  const have = existsSync(registry)
  const maybe = have ? it : it.skip

  maybe('the vendored copies are byte-identical to the pinned registry files', () => {
    const map: Record<string, string> = {
      'vta-pcs-applications-create.payload.schema.json': 'specs/vta/pcs/applications/create/0.1/payload.schema.json',
      'vta-pcs-applications-show.payload.schema.json': 'specs/vta/pcs/applications/show/0.1/payload.schema.json',
      'vta-pcs-applications-delete.payload.schema.json': 'specs/vta/pcs/applications/delete/0.1/payload.schema.json',
      'vta-pcs-verify-attestation.payload.schema.json': 'specs/vta/pcs/verify-attestation/0.1/payload.schema.json',
      'vta-pcs-prove.payload.schema.json': 'specs/vta/pcs/prove/0.1/payload.schema.json',
      'vta-shared-pcs-engine.schema.json': 'specs/vta/_shared/0.4/pcs-engine.schema.json',
      'vetting-shared-hidden-vetting.schema.json': 'specs/vetting/_shared/0.1/hidden-vetting.schema.json',
    }
    for (const [vendored, source] of Object.entries(map)) {
      const live = join(registry, source)
      if (!existsSync(live)) continue
      expect({ [vendored]: readFileSync(join(SCHEMA_DIR, vendored), 'utf8') }).toEqual({
        [vendored]: readFileSync(live, 'utf8'),
      })
    }
  })
})
