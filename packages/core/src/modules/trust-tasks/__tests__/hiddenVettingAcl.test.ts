/**
 * The ACL entries the hidden-vetting tests rely on, graded by the registry's
 * own `acl/_shared` schemas rather than by our reading of them.
 *
 * This file exists because of a specific failure. `hiddenVetting.test.ts`'s
 * fake agent put the `pcs-applicant` capability in an entry's `scopes`, and
 * `VtaClient` read `scopes` as capabilities — so the fake and the parser
 * shared one wrong belief and 25 tests passed over a check that was broken in
 * both directions: it could never match a correctly granted entry, and it read
 * an entry that can reach nothing as unrestricted. A fake that agrees with the
 * parser proves only that they agree.
 *
 * So the shapes below are validated against upstream's schemas, and the parser
 * is then run over those same validated documents. A fixture that drifts from
 * the wire now fails here before it can mislead anything else.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import Ajv from 'ajv/dist/2020'

import { parseAclEntries } from '../module/VtaClient'

import { expectNoDrift, registryPath } from './fixtures/registryDrift'

const SCHEMA_DIR = join(__dirname, 'fixtures', 'acl-schemas')

/**
 * Which framework version each entry schema's `ext` member refs, and the URL
 * the relative ref actually resolves to.
 *
 * `acl/_shared/0.1/acl-entry` refs `../../../_framework/0.1/framework.schema.json`,
 * which from `…/spec/acl/_shared/0.1/` resolves to
 * `…/spec/_framework/0.1/framework.schema.json` — written out rather than
 * computed, so an upstream move shows up as a resolution failure instead of
 * being papered over. Same reasoning as the pcs fixtures next door.
 */
const FRAMEWORK: Record<'0.1' | '0.2', { file: string; registerAs: string }> = {
  '0.1': {
    file: 'framework-0.1.schema.json',
    registerAs: 'https://trusttasks.org/spec/_framework/0.1/framework.schema.json',
  },
  '0.2': {
    file: 'framework-0.4.schema.json',
    registerAs: 'https://trusttasks.org/spec/_framework/0.4/framework.schema.json',
  },
}

/** The `AclEntry` definition out of a vendored `acl/_shared` schema. */
function entryValidator(version: '0.1' | '0.2') {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, `acl-entry-${version}.schema.json`), 'utf8'))
  const framework = FRAMEWORK[version]
  const ext = JSON.parse(readFileSync(join(SCHEMA_DIR, framework.file), 'utf8'))
  ajv.addSchema(ext, framework.registerAs)
  // `_shared` is a bag of $defs, not a schema in itself: compile the entry.
  ajv.addSchema(schema)
  return ajv.compile({ $ref: `${schema.$id}#/$defs/AclEntry` })
}

/**
 * How a 0.1 agent states a phone that may apply: the capability rides `ext`,
 * and `scopes` is the context list. This is the shape vta-service 0.60 sends.
 */
const entry01 = {
  subject: 'did:peer:2.Ephone',
  role: 'initiator',
  scopes: ['vta'],
  ext: { 'org.openvtc.capabilities': ['pcs-applicant'] },
}

/** The same authority at 0.2, stated outright rather than implied by a shape. */
const entry02 = {
  subject: 'did:peer:2.Ephone',
  role: 'initiator',
  act: { scope: 'contexts', contexts: ['vta'] },
  keys: { scope: 'none' },
  capabilities: { scope: 'listed', grants: [{ capability: 'pcs-applicant' }] },
}

describe('the ACL entries these tests put in front of the parser are real', () => {
  it('the 0.1 shape validates against acl/_shared 0.1', () => {
    const validate = entryValidator('0.1')
    expect(validate(entry01) || validate.errors).toBe(true)
  })

  it('the 0.2 shape validates against acl/_shared 0.2', () => {
    const validate = entryValidator('0.2')
    expect(validate(entry02) || validate.errors).toBe(true)
  })

  it('the mistake that started this is refused by the schema', () => {
    // 0.2 is `additionalProperties: false` and requires the explicit scopes, so
    // the old fake — a capability sitting in `scopes` — is not a 0.2 entry at
    // all. Had the fixtures been graded, the fake could never have agreed with
    // the parser's error.
    const validate = entryValidator('0.2')
    expect(validate({ subject: 'did:peer:2.Ephone', role: 'member', scopes: ['pcs-applicant'] })).toBe(false)
  })

  it('0.2 refuses an empty context list, which 0.1 could not say', () => {
    // The ambiguity that caused the bug: at 0.1 an empty list is "everywhere"
    // for an admin and "nowhere" for anyone else. 0.2 makes the empty list
    // invalid outright — `none` and `all` are their own shapes.
    const validate = entryValidator('0.2')
    expect(
      validate({
        subject: 'did:peer:2.Ephone',
        role: 'initiator',
        act: { scope: 'contexts', contexts: [] },
        keys: { scope: 'none' },
        capabilities: { scope: 'ceiling' },
      })
    ).toBe(false)
  })
})

describe('the parser reads what those documents actually say', () => {
  /** The real parser, over the documents the schemas just validated. */
  const parse = (entry: unknown) => parseAclEntries([entry])[0]

  it('reads a 0.1 entry: contexts by shape, capability out of ext', () => {
    expect(parse(entry01)).toMatchObject({
      subject: 'did:peer:2.Ephone',
      role: 'initiator',
      act: { stated: 'byShape', contexts: ['vta'] },
      capabilityScope: { stated: 'listed', capabilities: ['pcs-applicant'] },
    })
  })

  it('reads a 0.2 entry: both authorities as stated', () => {
    expect(parse(entry02)).toMatchObject({
      act: { stated: 'contexts', contexts: ['vta'] },
      capabilityScope: { stated: 'listed', capabilities: ['pcs-applicant'] },
    })
  })

  it('does not read a 0.1 capability list as contexts, or the reverse', () => {
    const parsed = parse(entry01)
    expect(parsed?.scopes).toEqual(['vta'])
    expect(parsed?.capabilityScope).not.toEqual({ stated: 'listed', capabilities: ['vta'] })
  })

  it('keeps `ceiling` distinct from a narrowing that names nothing', () => {
    expect(parse({ ...entry02, capabilities: { scope: 'ceiling' } })?.capabilityScope).toEqual({ stated: 'ceiling' })
    expect(parse({ ...entry02, capabilities: { scope: 'none' } })?.capabilityScope).toEqual({ stated: 'none' })
  })

  it('refuses a document that is not an entry at all', () => {
    // The parser drops a row with no subject or role rather than returning a
    // half-built entry: a policy decision taken over `undefined` members is
    // how a missing permission reads as a granted one.
    expect(parseAclEntries([{ role: 'initiator' }, { subject: 'did:peer:2.Ex' }, 'nonsense', null])).toEqual([])
  })
})

describe('the vendored acl schemas still match the registry', () => {
  const maybe = registryPath() ? it : it.skip

  maybe('byte-identical to the commit PROVENANCE names', () => {
    expectNoDrift(SCHEMA_DIR, {
      'acl-entry-0.1.schema.json': 'specs/acl/_shared/0.1/acl-entry.schema.json',
      'acl-entry-0.2.schema.json': 'specs/acl/_shared/0.2/acl-entry.schema.json',
      'framework-0.1.schema.json': 'specs/_framework/0.1/framework.schema.json',
      'framework-0.4.schema.json': 'specs/_framework/0.4/framework.schema.json',
    })
  })
})
