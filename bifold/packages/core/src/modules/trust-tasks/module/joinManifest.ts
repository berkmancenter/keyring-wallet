/**
 * joinManifest — a community's join criteria, read the same way whichever
 * version of the manifest published them.
 *
 * `vtc/join-requests/manifest/0.3` makes a criterion a complete statement of
 * one way in: its `admission` (`automatic` or `review`), what it requires —
 * credentials from stated issuers, peer vetting, an invitation, or nothing —
 * and a `requirementsDigest` on every one, listed in the order the community
 * decides by. A 0.2 criterion states no admission, and nobody but the
 * community can say what it was (manifest/0.3 spec, Changes from 0.2), so it
 * is read as `unstated` and never as either mode.
 *
 * A criterion this wallet cannot read as published is not guessed at: it stays
 * in the list, marked unusable, with the reason — so a screen can say the
 * community's requirements are not supported instead of hiding a way in
 * (manifest/0.3 Conformance, applicant item 1). The wallet's reading is
 * advisory throughout: the community's decision is authoritative.
 *
 * @module trust-tasks/module/joinManifest
 */

import { digestMultibase } from '@bifold/trust-tasks'

import type { JoinWire } from './joinWire'
import { checkVettingRequirements, isDigestMultibase } from './vettingShape'

/** A community's published join criteria, as a manifest states them. */
export interface VtiCriterion {
  id?: string
  description?: string
  /** How a submission meeting the criterion is decided (manifest/0.3). */
  admission?: string
  /** The credentials required, as a DCQL query (manifest/0.3: optional). */
  presentationDefinition?: unknown
  /** Whose credentials meet `presentationDefinition` (manifest/0.3). */
  credentialIssuers?: string
  /** True: a valid invitation this community issued is required (manifest/0.3). */
  invitationRequired?: boolean
  /** Per-criterion digest — what an applicant is held to. On every criterion from manifest/0.3. */
  requirementsDigest?: string
  /** The vetting requirement object, when the criterion needs peer vetting. */
  vetting?: {
    version?: string
    statementType?: string
    minStatements?: number
    acceptedMethods?: string[]
    requiredClaims?: string[]
    maxStatementAge?: string
    eligibleVetters?: Record<string, unknown>
    independence?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface VtiManifest {
  /** The version of the manifest task this was read in. Absent: 0.2. */
  wire?: JoinWire
  communityDid?: string
  /** The criteria exactly as published — from manifest/0.3, in the order the community decides by. */
  criteria: VtiCriterion[]
  requirementsDigest?: string
  /**
   * What the community calls itself. Optional and often absent: a community
   * publishes none until its admin sets one, so a screen must read well
   * without it.
   */
  branding?: {
    displayName?: string
    accentColor?: string
    logoUrl?: string
    [key: string]: unknown
  }
}

/** A manifest answer's payload as a manifest, with the version it was asked in. */
export function readManifest(payload: Partial<VtiManifest> | undefined, wire: JoinWire): VtiManifest {
  return {
    wire,
    communityDid: payload?.communityDid,
    criteria: Array.isArray(payload?.criteria) ? payload.criteria : [],
    requirementsDigest: payload?.requirementsDigest,
    branding: payload?.branding,
  }
}

export type JoinAdmission = 'automatic' | 'review' | 'unstated'
export type JoinCredentialIssuers = 'any' | 'community' | 'recognised'

/**
 * Why this wallet cannot apply under a criterion as published. Each names the
 * member at fault, so the reason can be said rather than the way hidden.
 */
export type JoinWayFault =
  | 'idMissing'
  | 'admissionMissing'
  | 'admissionUnknown'
  | 'digestMissing'
  | 'digestMismatch'
  | 'issuersMissing'
  | 'issuersUnknown'
  | 'vettingUnreadable'

/** One way into a community: a criterion, read for the Join screen. */
export interface JoinWay {
  id: string
  description?: string
  admission: JoinAdmission
  requires: {
    invitation: boolean
    credentials?: { issuers?: JoinCredentialIssuers; types: string[] }
    vetting?: { statements: number; claims: string[]; methods: string[] }
  }
  /** It states no requirement at all: every submission meets it. */
  requiresNothing: boolean
  /** The criterion's `requirementsDigest` — what a submission names it by. */
  digest?: string
  usable: boolean
  unusableBecause?: JoinWayFault
  /** The fault in the reader's words, for Details — never for the sentence a person reads. */
  unusableDetail?: string
  /**
   * Whether what the phone holds now meets it. `unknown` where the wallet does
   * not evaluate the requirement here (a credential query).
   */
  meets: 'yes' | 'no' | 'unknown'
}

/** What a community asks, for the Join screen. */
export interface JoinAsks {
  wire: JoinWire
  /** False: the community publishes no criteria, so it accepts no applications at present (manifest/0.3 item 9). */
  accepting: boolean
  /** Every way in, in the community's own order. */
  ways: JoinWay[]
  /** The first usable way this phone meets now — the rule the community decides by when a submission names none. */
  suggested?: JoinWay
  /**
   * What meeting the suggested way leads to. Only `joined` may be told as
   * admission: under `review` an administrator decides (applicant item 5).
   */
  outcomeIfMet?: 'joined' | 'reviewed' | 'unstated'
}

/** What the phone holds towards a join, as far as the wallet can tell. */
export interface JoinHolds {
  invitation?: boolean
  /** Vetting statements gathered for this community. */
  statements?: number
}

const ADMISSIONS: readonly string[] = ['automatic', 'review']
const ISSUERS: readonly string[] = ['any', 'community', 'recognised']

/**
 * A criterion's `requirementsDigest`, recomputed: the digest of the criterion
 * as received with that one member removed and nothing else changed
 * (manifest/0.3, Computing `requirementsDigest`).
 */
export function criterionDigest(criterion: VtiCriterion): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { requirementsDigest: _published, ...rest } = criterion
  return digestMultibase(rest)
}

/** The credential types a DCQL query names (`credentials[].meta.type_values`), each once. */
function queriedTypes(query: unknown): string[] {
  const credentials = (query as { credentials?: unknown } | undefined)?.credentials
  if (!Array.isArray(credentials)) return []
  const types = credentials.flatMap((c) => {
    const values = (c as { meta?: { type_values?: unknown } } | undefined)?.meta?.type_values
    return Array.isArray(values) ? values.flat() : []
  })
  return [...new Set(types.filter((t): t is string => typeof t === 'string'))]
}

function faultOf(criterion: VtiCriterion, wire: JoinWire): Pick<JoinWay, 'unusableBecause' | 'unusableDetail'> {
  const fault = (unusableBecause: JoinWayFault, unusableDetail?: string) => ({ unusableBecause, unusableDetail })
  if (wire === '0.3') {
    if (typeof criterion.id !== 'string' || !criterion.id) return fault('idMissing')
    if (criterion.admission === undefined) return fault('admissionMissing')
    if (!ADMISSIONS.includes(criterion.admission)) return fault('admissionUnknown', String(criterion.admission))
    const hasQuery = criterion.presentationDefinition !== undefined
    if (hasQuery !== (criterion.credentialIssuers !== undefined)) return fault('issuersMissing')
    if (hasQuery && !ISSUERS.includes(String(criterion.credentialIssuers))) {
      return fault('issuersUnknown', String(criterion.credentialIssuers))
    }
    const published = criterion.requirementsDigest
    if (!isDigestMultibase(published)) return fault('digestMissing')
    // SHA-256 in base58btc — the recommended form, and the only one compared
    // here: equal strings in one encoding are equal bytes. Another encoding is
    // echoed as the community gave it.
    if (published.startsWith('zQm') && criterionDigest(criterion) !== published) {
      return fault('digestMismatch', `published ${published}, recomputed ${criterionDigest(criterion)}`)
    }
  }
  if (criterion.vetting !== undefined) {
    const shape = checkVettingRequirements(criterion.vetting)
    if (!shape.ok) return fault('vettingUnreadable', shape.detail)
  }
  return {}
}

function wayOf(criterion: VtiCriterion, wire: JoinWire, holds: JoinHolds): JoinWay {
  const vetting = criterion.vetting
  const hasQuery = criterion.presentationDefinition !== undefined
  const invitation =
    (wire === '0.3' && criterion.invitationRequired === true) ||
    (vetting as { invitation?: unknown } | undefined)?.invitation === 'required'
  const requires: JoinWay['requires'] = {
    invitation,
    ...(hasQuery
      ? {
          credentials: {
            ...(ISSUERS.includes(String(criterion.credentialIssuers))
              ? { issuers: criterion.credentialIssuers as JoinCredentialIssuers }
              : {}),
            types: queriedTypes(criterion.presentationDefinition),
          },
        }
      : {}),
    ...(vetting
      ? {
          vetting: {
            statements: typeof vetting.minStatements === 'number' ? vetting.minStatements : 1,
            claims: Array.isArray(vetting.requiredClaims) ? vetting.requiredClaims : [],
            methods: Array.isArray(vetting.acceptedMethods) ? vetting.acceptedMethods : [],
          },
        }
      : {}),
  }
  const fault = faultOf(criterion, wire)
  const meets: JoinWay['meets'] =
    (requires.invitation && !holds.invitation) ||
    (requires.vetting && (holds.statements ?? 0) < requires.vetting.statements)
      ? 'no'
      : requires.credentials
        ? 'unknown'
        : 'yes'
  return {
    id: typeof criterion.id === 'string' ? criterion.id : '',
    ...(typeof criterion.description === 'string' ? { description: criterion.description } : {}),
    admission:
      wire === '0.3' && ADMISSIONS.includes(String(criterion.admission))
        ? (criterion.admission as JoinAdmission)
        : 'unstated',
    requires,
    // Only a 0.3 criterion can state that it requires nothing: a 0.2 one is a
    // presentation-definition, which this wallet does not read.
    requiresNothing: wire === '0.3' && !requires.invitation && !requires.credentials && !requires.vetting,
    ...(typeof criterion.requirementsDigest === 'string' ? { digest: criterion.requirementsDigest } : {}),
    usable: !fault.unusableBecause,
    ...fault,
    meets,
  }
}

/**
 * A manifest's criteria as ways in, with which one a submission from this
 * phone would be decided under.
 *
 * `suggested` follows the community's own rule for a submission that names no
 * criterion — the first, in published order, that it meets (submit/0.3,
 * Deciding a submission) — over the ways this wallet can read.
 */
export function joinAsks(manifest: VtiManifest, holds: JoinHolds = {}): JoinAsks {
  const wire = manifest.wire ?? '0.2'
  const ways = manifest.criteria.map((criterion) => wayOf(criterion, wire, holds))
  const suggested = ways.find((way) => way.usable && way.meets === 'yes')
  return {
    wire,
    // A 0.2 manifest with no criteria does not say what it means; only 0.3
    // defines the empty list as "not accepting".
    accepting: wire === '0.3' ? ways.length > 0 : true,
    ways,
    ...(suggested
      ? {
          suggested,
          outcomeIfMet:
            suggested.admission === 'automatic' ? 'joined' : suggested.admission === 'review' ? 'reviewed' : 'unstated',
        }
      : {}),
  }
}
