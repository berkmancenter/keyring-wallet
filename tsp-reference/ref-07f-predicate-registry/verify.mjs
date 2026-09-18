// A verifier configured from accept-list.json, applying PR #47's Predicate
// Handling (steps 1-3) and every profile constraint it can check generically.
//
// Two phases, as #47 requires: configure() runs once and may load schemas;
// verify() runs per credential and never touches the network.
import Ajv from 'ajv'

const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/ // RFC 3986 scheme ':' ...

/** Configuration time: import the accept-list and compile member schemas. */
export function configure(acceptList, schemaStore) {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const profiles = {}
  for (const [iri, entry] of Object.entries(acceptList)) {
    const members = {}
    for (const [name, m] of Object.entries(entry.additionalMembers ?? {})) {
      const key = m.schema ? m.schema.split('/').pop() : null
      const schema = key ? schemaStore[key] : null
      members[name] = { required: m.required, validate: schema ? ajv.compile(schema) : null, schemaUrl: m.schema ?? null }
    }
    profiles[iri] = { ...entry, members }
  }
  return { profiles }
}

/** Verification time. Returns the verdict plus exactly what was and wasn't checked. */
export function verify(config, cred, { relations = {}, referenced = [] } = {}) {
  const checked = []
  const unchecked = []
  const reject = (reason) => ({ ok: false, reason, checked, unchecked })
  const cs = cred.credentialSubject ?? {}
  const predicate = cs.predicate

  // Step 1 — absolute IRI
  if (predicate === undefined) return reject('step 1: no predicate')
  if (typeof predicate !== 'string' || !ABSOLUTE_IRI.test(predicate)) return reject('step 1: predicate is not an absolute IRI')
  checked.push('absolute IRI')

  // Step 2 — accepted vocabulary (the verifier's configuration, never the credential)
  const profile = config.profiles[predicate]
  if (!profile) return reject('step 2: predicate not in the accept-list')
  checked.push('in accept-list')

  // Step 3 — the profile's constraints
  const kinds = ['id', 'digestMultibase', 'value'].filter((k) => cs.object && k in cs.object)
  if (kinds.length !== 1) return reject(`object must carry exactly one of id|digestMultibase|value (has ${kinds.join(',') || 'none'})`)
  if (!profile.objectKind.includes(kinds[0])) return reject(`object kind ${kinds[0]} not permitted`)
  checked.push('objectKind')

  if (profile.taskContextRequired && typeof cred.taskContext !== 'string') return reject('taskContext required but absent')
  checked.push('taskContextRequired')

  for (const [name, m] of Object.entries(profile.members)) {
    if (!(name in cs)) {
      if (m.required) return reject(`additional member ${name} required but absent`)
      continue
    }
    if (m.schemaUrl && !m.validate) return reject(`schema for ${name} named but not loaded at configuration time`)
    if (m.validate && !m.validate(cs[name])) {
      return reject(`${name} fails its schema: ${m.validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`)
    }
    checked.push(`additional member ${name}`)
  }
  const defined = new Set(['id', 'predicate', 'object', ...Object.keys(profile.members)])
  const ignored = Object.keys(cs).filter((k) => !defined.has(k))
  if (ignored.length) checked.push(`ignored undefined members: ${ignored.join(', ')}`) // #47 profile item 5

  // What the accept-list cannot express as a check today.
  const relation = relations[predicate]
  if (profile.subjectObjectRelationship && !relation) {
    unchecked.push('subjectObjectRelationship (free text)')
  } else if (relation) {
    const target = referenced.find((r) => r.digestMultibase === cs.object?.digestMultibase)
    if (!target) return reject('referenced credential not available to check the subject relationship')
    const expected = relation === 'subjectIsReferencedIssuer'
      ? (typeof target.credential.issuer === 'string' ? target.credential.issuer : target.credential.issuer?.id)
      : target.credential.credentialSubject?.id
    if (cs.id !== expected) return reject(`${relation}: subject ${cs.id} is not ${expected}`)
    checked.push(`subject relationship (${relation})`)
  }
  if (profile.minimumIssuerScope) unchecked.push('minimumIssuerScope (no credential property carries a declared scope — #46)')

  return { ok: true, reason: 'accepted', checked, unchecked, ignored }
}
