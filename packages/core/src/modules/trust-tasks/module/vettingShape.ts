/**
 * vettingShape — the shape checks vta-sdk applies to vetting documents before
 * it reads them, so Keyring refuses what an openvtc client refuses:
 *
 * - the published schema, as `against_own_schema` / `against_definition`
 *   validate it (vta-sdk `protocols/vetting.rs:406-431`, schemas bundled in
 *   vettingSchemas.ts);
 * - and what the schema cannot say, as each `CheckShape` impl adds it by hand
 *   (the vetter profile's event rule, vetting.rs:570-597; the requirements'
 *   https governance URL and method floors, vetting.rs:739-760; the https URI
 *   rule itself, `shape::https_uri`, vetting.rs:1056-1085).
 *
 * @module trust-tasks/module/vettingShape
 */

import { trustTaskPayloadValidator } from '@bifold/trust-tasks'

import { VETTING_SCHEMAS } from './vettingSchemas'

export type VettingShapeResult = { ok: true } | { ok: false; detail: string }

const valid: VettingShapeResult = { ok: true }
const invalid = (detail: string): VettingShapeResult => ({ ok: false, detail })

/** Validate `value` against one of the bundled published schemas. */
export function againstSchema(name: keyof typeof VETTING_SCHEMAS, value: unknown): VettingShapeResult {
  const verdict = trustTaskPayloadValidator.validate(VETTING_SCHEMAS[name], value)
  return verdict === true ? valid : invalid(`${name}: ${verdict.errors.join('; ')}`)
}

/** Longest value a vetting schema gives `format: uri` (vetting.rs `MAX_URI_CHARS`). */
const MAX_URI_CHARS = 2048
const URI_CHARACTER = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/

/**
 * `shape::https_uri` (vta-sdk protocols/vetting.rs:1056-1085): an absolute
 * https URI with a host — no whitespace or control characters, at most 2048
 * characters, only URI characters, well-formed percent escapes, an authority,
 * and one a URL parser reads as https with a non-empty host.
 */
export function isHttpsUri(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(value)) return false
  if ([...value].length > MAX_URI_CHARS) return false
  if (!value.startsWith('https://')) return false
  const rest = value.slice('https://'.length)
  if (!URI_CHARACTER.test(value)) return false
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) return false
  if (!rest || /^[/?#]/.test(rest)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname
  } catch {
    return false
  }
}

/** Longest span of one vetter event, `endDate − startDate`: vta-sdk `MAX_VETTER_EVENT_SPAN_DAYS` (vetting.rs:286). */
export const MAX_VETTER_EVENT_SPAN_DAYS = 31

/** A `YYYY-MM-DD` that names a real day (chrono's `NaiveDate` parse refuses 2026-02-30), as a UTC day number. */
function calendarDay(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return undefined
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return undefined
  return Math.round(ms / 86400000)
}

/**
 * A `vtc/vetting/vetters/profile/0.1` payload, as vta-sdk's `CheckShape`
 * checks it (protocols/vetting.rs:570-597): the schema, then each event's
 * `url` an absolute https URI, `endDate` not before `startDate` and no more
 * than 31 days after it — which the schema states in prose only.
 */
export function checkVetterProfile(payload: unknown): VettingShapeResult {
  const schema = againstSchema('vetterProfilePayload', payload)
  if (!schema.ok) return schema
  const events = (payload as { events?: Record<string, unknown>[] }).events ?? []
  for (const event of events) {
    if (typeof event.url === 'string' && !isHttpsUri(event.url))
      return invalid('events.url: must be an absolute https URI')
    const start = calendarDay(event.startDate)
    const end = calendarDay(event.endDate)
    if (start === undefined) return invalid('events.startDate: must be a calendar date')
    if (end === undefined) return invalid('events.endDate: must be a calendar date')
    if (end < start) return invalid('events.endDate: must not be before startDate')
    if (end - start > MAX_VETTER_EVENT_SPAN_DAYS)
      return invalid(`events.endDate: must be at most ${MAX_VETTER_EVENT_SPAN_DAYS} days after startDate`)
  }
  return valid
}

/**
 * A community's `VettingRequirements`, read as vta-sdk `read_requirements`
 * reads them (protocols/vetting.rs:485, `CheckShape` :739-760) and openvtc's
 * applicant adopts them (`adopt_manifest`, applicant.rs:483-485): the
 * manifest's definition, `governanceFrameworkUrl` an absolute https URI, and
 * every method `minByMethod` names also in `acceptedMethods`. A client treats
 * requirements that fail this as unsatisfiable rather than guess
 * (manifest/0.2 Conformance 3).
 */
export function checkVettingRequirements(requirements: unknown): VettingShapeResult {
  const schema = againstSchema('vettingRequirements', requirements)
  if (!schema.ok) return schema
  const r = requirements as {
    governanceFrameworkUrl?: string
    minByMethod?: Record<string, number>
    acceptedMethods: string[]
  }
  if (r.governanceFrameworkUrl !== undefined && !isHttpsUri(r.governanceFrameworkUrl))
    return invalid('governanceFrameworkUrl: must be an absolute https URI')
  if (Object.keys(r.minByMethod ?? {}).some((method) => !r.acceptedMethods.includes(method)))
    return invalid('minByMethod: names a method acceptedMethods does not accept')
  return valid
}

/** The published `DigestMultibase` (framework 0.3): `z` base58btc or `u` base64url, at least 16 characters. */
export function isDigestMultibase(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && /^(z[1-9A-HJ-NP-Za-km-z]+|u[A-Za-z0-9_-]+)$/.test(value)
}
