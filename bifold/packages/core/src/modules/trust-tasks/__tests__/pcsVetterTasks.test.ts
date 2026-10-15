/**
 * The vetter's seven payloads, graded by the registry's own schemas.
 *
 * Same contract as the applicant's five next door: we mirror the types by
 * hand because the generated ones are behind the Cypress lock, so upstream's
 * schemas have to be what judges the shapes. A hand-mirrored type that nothing
 * grades is a guess with a type annotation on it.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import Ajv from 'ajv/dist/2020'

import {
  DECLARED_RELATIONSHIPS,
  HIDDEN_VETTING_SUITE,
  PCS_VETTER_ERROR,
  VOUCH_METHODS,
  isNotAVetter,
  type AttestPayload,
  type PublishedConfig,
  type RootRequestPayload,
  type TokensRequestPayload,
} from '../module/pcsVetterTasks'

import { expectNoDrift, registryPath } from './fixtures/registryDrift'

const SCHEMA_DIR = join(__dirname, 'fixtures', 'pcs-vetter-schemas')

/** The shared schema's id differs from the URL a sibling's relative $ref reaches it by. */
const REGISTER_AS: Record<string, string[]> = {
  'vta-shared-pcs-engine.schema.json': ['https://trusttasks.org/spec/_shared/0.4/pcs-engine.schema.json'],
  'framework-0.2.schema.json': ['https://trusttasks.org/_framework/0.2/framework.schema.json'],
  // pcs-engine refs `../../../vetting/_shared/0.1/hidden-vetting.schema.json`,
  // which from `…/spec/vta/_shared/0.4/` resolves to `…/spec/vetting/_shared/…`
  // — not to that file's own $id. Written out so an upstream move fails to
  // resolve rather than being papered over.
  'vetting-shared-hidden-vetting.schema.json': [
    'https://trusttasks.org/spec/vetting/_shared/0.1/hidden-vetting.schema.json',
  ],
}

function validatorFor(file: string) {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.json'))) {
    if (f === file) continue
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')) as { $id?: string }
    for (const id of [schema.$id, ...(REGISTER_AS[f] ?? [])].filter(Boolean) as string[]) {
      try {
        ajv.addSchema(schema, id)
      } catch {
        // already registered under an equivalent id
      }
    }
  }
  return ajv.compile(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')))
}

const parameters: PublishedConfig = {
  suite: HIDDEN_VETTING_SUITE,
  helperKey: 'z6MkhelperKey',
  tokenKey: 'z6MktokenKey',
  vetterLabels: ['vetter/2026-10'],
  tokenLabels: ['token/2026-10'],
  dripPerTick: 3,
  tickLength: 'P3D',
  events: [],
}

// Every multibase member must be base58btc, which excludes 0, O, I and
// lowercase l — so a plausible-looking "z2blinded" is invalid. Checked against
// the pattern rather than by eye: that mistake has cost two rounds already.
const CONTEXT = 'vta'
const COMMUNITY = 'did:webvh:QmCommunity:example.org'

describe('every vetter payload validates against the registry schema it is built for', () => {
  it('vetter/show', () => {
    const validate = validatorFor('vta-pcs-vetter-show.payload.schema.json')
    expect(validate({ contextId: CONTEXT, community: COMMUNITY }) || validate.errors).toBe(true)
  })

  it('root-request', () => {
    const payload: RootRequestPayload = {
      contextId: CONTEXT,
      community: COMMUNITY,
      memberDid: 'did:webvh:QmMember:example.org:vetter',
      parameters,
      label: 'vetter/2026-10',
    }
    const validate = validatorFor('vta-pcs-root-request.payload.schema.json')
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('root-accept names the label and the blinded credential', () => {
    const validate = validatorFor('vta-pcs-root-accept.payload.schema.json')
    // The response is declared and closed — `label` and `preCredential` — not
    // an opaque blob to forward whole, which is what this test caught.
    const payload = {
      contextId: CONTEXT,
      community: COMMUNITY,
      parameters,
      response: { label: 'vetter/2026-10', preCredential: 'z2BxCdEfGhJk' },
    }
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('tokens/request', () => {
    const payload: TokensRequestPayload = {
      contextId: CONTEXT,
      community: COMMUNITY,
      parameters,
      label: 'token/2026-10',
      tick: 1,
      count: 3,
    }
    const validate = validatorFor('vta-pcs-tokens-request.payload.schema.json')
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('tokens/accept and tokens/abandon', () => {
    const accept = validatorFor('vta-pcs-tokens-accept.payload.schema.json')
    const drawn = {
      contextId: CONTEXT,
      community: COMMUNITY,
      parameters,
      // Declared and closed, like root-accept: the label, the tick it was
      // drawn for, and one pre-credential per token.
      response: { label: 'token/2026-10', tick: 1, preCredentials: ['z2TokenAaa', 'z2TokenBbb', 'z2TokenCcc'] },
    }
    expect(accept(drawn) || accept.errors).toBe(true)
    const abandon = validatorFor('vta-pcs-tokens-abandon.payload.schema.json')
    // A draw is named by what it was for, not by an id we invent.
    const given = { contextId: CONTEXT, community: COMMUNITY, draw: { label: 'token/2026-10', tick: 1 } }
    expect(abandon(given) || abandon.errors).toBe(true)
  })

  it('attest, with all ten meta members', () => {
    const payload: AttestPayload = {
      contextId: CONTEXT,
      community: COMMUNITY,
      parameters,
      applicantId: 'z4FvpxtP31f2HAEo4V9ffW3VRH1yZJAXY',
      meta: {
        community: COMMUNITY,
        requirementsDigest: 'zQmRequirements',
        method: 'inPerson',
        claimsVerified: ['name.legal'],
        livenessConfirmed: true,
        declaredRelationship: 'closeFriend',
        identityCommitment: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        cardDigestMultibase: 'zQmaCardDigest',
        validFrom: '2026-10-15T00:00:00Z',
        validUntil: '2026-11-15T00:00:00Z',
      },
    }
    const validate = validatorFor('vta-pcs-attest.payload.schema.json')
    expect(validate(payload) || validate.errors).toBe(true)
  })

  it('a payload missing a required member is refused, so these tests can fail', () => {
    const validate = validatorFor('vta-pcs-root-request.payload.schema.json')
    expect(validate({ contextId: CONTEXT, community: COMMUNITY, parameters })).toBe(false)
  })
})

describe('the enums are the registry’s, not ours', () => {
  it('rejects a relationship the schema does not have', () => {
    // "communityColleague" is the VTC console's vocabulary for *named* vetting;
    // the attestation enum has no such value, and sending it would be refused
    // by the agent. The two vocabularies disagree, which is upstream's to
    // settle — this test makes sure we never quietly invent the bridge.
    expect((DECLARED_RELATIONSHIPS as readonly string[]).includes('communityColleague')).toBe(false)
    const validate = validatorFor('vta-pcs-attest.payload.schema.json')
    const payload = {
      contextId: CONTEXT,
      community: COMMUNITY,
      parameters,
      applicantId: 'z4Fvpxt',
      meta: {
        community: COMMUNITY,
        requirementsDigest: 'zQm',
        method: 'inPerson',
        claimsVerified: [],
        livenessConfirmed: true,
        declaredRelationship: 'communityColleague',
        identityCommitment: 'z6Mk',
        cardDigestMultibase: 'zQm',
        validFrom: '2026-10-15T00:00:00Z',
        validUntil: '2026-11-15T00:00:00Z',
      },
    }
    expect(validate(payload)).toBe(false)
  })

  it('carries every method the registry defines, and the screen narrows it', () => {
    // The form offers what the *criterion* accepts, not all of these: a
    // community that takes only inPerson and video would refuse an attestation
    // made by priorAcquaintance.
    expect(VOUCH_METHODS).toEqual(['inPerson', 'video', 'priorAcquaintance'])
  })
})

describe('refusals a vetter screen has to tell apart', () => {
  it('knows "not a vetter here" from every other refusal', () => {
    expect(isNotAVetter(PCS_VETTER_ERROR.vetterNotFound)).toBe(true)
    expect(isNotAVetter(PCS_VETTER_ERROR.attestNoToken)).toBe(false)
    expect(isNotAVetter(undefined)).toBe(false)
  })

  it('keeps the two labelNotLive codes apart, because the remedies differ', () => {
    // Enrolling into a closed period and drawing against a closed token label
    // are different sentences on screen: one needs the next period, the other
    // needs nothing but time.
    expect(PCS_VETTER_ERROR.rootLabelNotLive).not.toBe(PCS_VETTER_ERROR.tokensLabelNotLive)
  })
})

describe('the vendored vetter schemas still match the registry', () => {
  const maybe = registryPath() ? it : it.skip

  maybe('byte-identical to the commit PROVENANCE names', () => {
    expectNoDrift(SCHEMA_DIR, {
      'vta-pcs-vetter-show.payload.schema.json': 'specs/vta/pcs/vetter/show/0.1/payload.schema.json',
      'vta-pcs-attest.payload.schema.json': 'specs/vta/pcs/attest/0.1/payload.schema.json',
      'vta-pcs-root-request.payload.schema.json': 'specs/vta/pcs/root-request/0.1/payload.schema.json',
      'vta-pcs-root-accept.payload.schema.json': 'specs/vta/pcs/root-accept/0.1/payload.schema.json',
      'vta-pcs-tokens-request.payload.schema.json': 'specs/vta/pcs/tokens/request/0.1/payload.schema.json',
      'vta-pcs-tokens-accept.payload.schema.json': 'specs/vta/pcs/tokens/accept/0.1/payload.schema.json',
      'vta-pcs-tokens-abandon.payload.schema.json': 'specs/vta/pcs/tokens/abandon/0.1/payload.schema.json',
      'vta-shared-pcs-engine.schema.json': 'specs/vta/_shared/0.4/pcs-engine.schema.json',
      'framework-0.2.schema.json': 'specs/_framework/0.2/framework.schema.json',
      'vetting-shared-hidden-vetting.schema.json': 'specs/vetting/_shared/0.1/hidden-vetting.schema.json',
    })
  })
})
