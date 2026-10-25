// The registry generator #52 describes (tools/ → dist/), reduced to what a
// verifier consumes: validate every predicates/*.jsonld against the definition
// format, then build accept-list.json from the entries a verifier may accept.
import { readFileSync, readdirSync } from 'node:fs'
import Ajv from 'ajv'

const dir = new URL('./registry/', import.meta.url)
const read = (p) => JSON.parse(readFileSync(new URL(p, dir), 'utf8'))

export function loadDefinitions() {
  return readdirSync(new URL('predicates/', dir))
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
 * accept-list.json per #52: "the active IRIs with their machine-checkable
 * constraints (object kinds, taskContextRequired, minimum scope, schema URLs)".
 * `statuses` defaults to #52's rule — active only — and can be widened to
 * test what a verifier should do with deprecated terms.
 */
export function buildAcceptList(defs, { statuses = ['active'] } = {}) {
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
