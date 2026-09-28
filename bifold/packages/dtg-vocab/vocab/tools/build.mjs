// Validates predicates/*.jsonld against meta/predicate.schema.json, then
// emits dist/ — the three artifacts a verifier or issuer actually consumes.
// Run with: node vocab/tools/build.mjs (writes dist/, exits non-zero on any
// invalid predicate definition).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import Ajv from 'ajv'

const vocabDir = new URL('../', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, vocabDir), 'utf8'))

export function loadDefinitions() {
  return readdirSync(new URL('predicates/', vocabDir))
    .filter((f) => f.endsWith('.jsonld'))
    .sort()
    .map((f) => ({ file: f, def: read(`predicates/${f}`) }))
}

export function validateDefinitions(defs) {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const check = ajv.compile(read('meta/predicate.schema.json'))
  return defs.map(({ file, def }) => ({
    file,
    valid: check(def),
    errors: (check.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`),
  }))
}

/**
 * accept-list.json: the active/draft IRIs with their machine-checkable
 * constraints (object kinds, taskContextRequired, minimum scope, additional
 * members). `statuses` defaults to ['active', 'draft'] rather than cred-spec
 * #52's 'active'-only rule, because both real registry entries this mirrors
 * are currently status "draft" — the registry has not formally activated a
 * version of either predicate yet. This is a deliberate, documented choice,
 * not an oversight: a consumer that wants #52's stricter reading passes
 * { statuses: ['active'] } explicitly, and will get an EMPTY accept-list
 * against today's real registry content until it activates a version.
 */
export function buildAcceptList(defs, { statuses = ['active', 'draft'] } = {}) {
  const out = {}
  for (const { def } of defs) {
    if (!statuses.includes(def.status)) continue
    out[def.id] = {
      status: def.status,
      objectKind: def.objectKind,
      taskContextRequired: def.taskContextRequired,
      ...(def.minimumIssuerScope ? { minimumIssuerScope: def.minimumIssuerScope } : {}),
      ...(def.additionalMembers ? { additionalMembers: def.additionalMembers } : {}),
      ...(def.subjectObjectRelationship ? { subjectObjectRelationship: def.subjectObjectRelationship } : {}),
    }
  }
  return out
}

/** vocab.jsonld: the aggregate vocabulary document — every predicate definition, as published. */
export function buildVocabDocument(defs) {
  return {
    '@context': 'https://registry.trustoverip.org/dtg/meta/v1/predicate-context.jsonld',
    type: 'PredicateVocabulary',
    predicates: defs.map(({ def }) => def),
  }
}

/**
 * context/v1.jsonld: the JSON-LD @context a credential using this
 * vocabulary's shared members (predicate, object, taskContext,
 * witnessContext.*) would need. This mirrors the vocabulary's OWN context —
 * it is NOT what @bifold/vrc-contexts serves the wallet (that is V2's job,
 * wiring this vocabulary into the app's actual verification context).
 */
export function buildContextDocument() {
  const NS = 'https://registry.trustoverip.org/dtg/credentials#'
  return {
    '@context': {
      dtg: NS,
      DTGCredential: `${NS}DTGCredential`,
      StatementCredential: `${NS}StatementCredential`,
      predicate: { '@id': `${NS}predicate`, '@type': '@id' },
      object: `${NS}object`,
      taskContext: `${NS}taskContext`,
      witnessContext: {
        '@id': `${NS}witnessContext`,
        '@context': {
          event: `${NS}event`,
          sessionId: `${NS}sessionId`,
          method: `${NS}method`,
        },
      },
    },
  }
}

function main() {
  const defs = loadDefinitions()
  const results = validateDefinitions(defs)
  const invalid = results.filter((r) => !r.valid)
  if (invalid.length) {
    for (const r of invalid) {
      console.error(`✗ ${r.file}`)
      for (const e of r.errors) console.error(`    ${e}`)
    }
    console.error(`${invalid.length} of ${results.length} predicate definition(s) failed schema validation.`)
    process.exit(1)
  }
  for (const r of results) console.log(`✓ ${r.file}`)

  const distDir = new URL('../dist/', import.meta.url)
  mkdirSync(new URL('context/', distDir), { recursive: true })
  writeFileSync(new URL('accept-list.json', distDir), JSON.stringify(buildAcceptList(defs), null, 2) + '\n')
  writeFileSync(new URL('vocab.jsonld', distDir), JSON.stringify(buildVocabDocument(defs), null, 2) + '\n')
  writeFileSync(new URL('context/v1.jsonld', distDir), JSON.stringify(buildContextDocument(), null, 2) + '\n')
  console.log(`built dist/ from ${results.length} predicate definition(s)`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
