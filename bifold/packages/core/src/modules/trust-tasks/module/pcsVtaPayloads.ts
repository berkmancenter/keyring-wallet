/**
 * The applicant's five `vta/pcs/*` payloads, mirrored from the registry.
 *
 * Hidden vetting is proved by the user's VTA, not by this app: the agent
 * derives a per-application PCS key, holds it, and builds the proof, while
 * Keyring carries messages between the agent, the vetters and the community
 * (`docs/plans/zero-knowledge-plan.md` D4). These are the payloads of the five
 * tasks the applicant's side needs; the other seven `vta/pcs/*` tasks belong to
 * a vetter and are not built here.
 *
 * **Why these types are written out rather than imported.** The registry
 * generates them (`trust-tasks-ts/src/vta/pcs/…/payload.ts`) and this module
 * already imports generated types of that kind elsewhere — but they ship in
 * `@openvtc/trust-tasks` 0.26.1, and the repository is pinned at 0.9.0 behind a
 * deliberate tripwire ("the Cypress lock; any bump past 0.9.x = post-Cypress
 * framework movement", `scripts/openvtc/PINS.json` in the wallet). 0.9.0 has no
 * `vta/pcs` types at all, so there is no partial path, and a seventeen-version
 * framework bump is not something hidden vetting should carry in as a side
 * effect. The bump is queued separately.
 *
 * What keeps these honest meanwhile: `__tests__/pcsVtaPayloads.test.ts`
 * validates every payload this module builds against the registry's own
 * `payload.schema.json`, vendored under `__tests__/fixtures/pcs-schemas/` with
 * the commit they came from. Upstream's schemas grade us even though the
 * dependency has not moved.
 *
 * @module trust-tasks/module/pcsVtaPayloads
 */

/** The suite this app implements. Anything else is refused, never downgraded. */
export const HIDDEN_VETTING_SUITE = 'ps-ddh-bls12381'

/** The five task types of the applicant's round. */
export const PCS_VTA_TASK = {
  applicationsCreate: 'https://trusttasks.org/spec/vta/pcs/applications/create/0.1',
  applicationsShow: 'https://trusttasks.org/spec/vta/pcs/applications/show/0.1',
  verifyAttestation: 'https://trusttasks.org/spec/vta/pcs/verify-attestation/0.1',
  prove: 'https://trusttasks.org/spec/vta/pcs/prove/0.1',
  applicationsDelete: 'https://trusttasks.org/spec/vta/pcs/applications/delete/0.1',
} as const

/**
 * A community's published hidden-vetting configuration, as its join manifest
 * carries it under the criterion's `vetting.ext["org.openvtc.hidden-vetting"]`.
 *
 * Read it from the raw criterion JSON: a typed parse drops members it does not
 * know, and this object is copied to the agent verbatim.
 */
export interface PublishedConfig {
  suite: string
  helperKey: string
  tokenKey: string
  vetterLabels: string[]
  tokenLabels: string[]
  dripPerTick: number
  tickLength: string
  events: unknown[]
}

/** What a community may leave out, and what the engine's schema then requires. */
const PARAMETER_DEFAULTS = { tickLength: 'P3D', dripPerTick: 3 } as const

/**
 * The parameters to send, with anything the community omitted filled in.
 *
 * The engine's schema requires all eight members even though a community need
 * not publish them all, so an omission is the caller's to repair — the same
 * repair openvtc's own `pcs_vta::parameters` makes. `dripPerTick` is never
 * below 1, which the schema enforces as a minimum rather than a default.
 *
 * Returns undefined when the published object is not hidden-vetting
 * configuration we can act on, so a caller cannot accidentally send a
 * half-built `parameters` and have the agent refuse it as `parametersInvalid`.
 */
export function parametersToSend(published: unknown): PublishedConfig | undefined {
  if (!published || typeof published !== 'object' || Array.isArray(published)) return undefined
  const p = published as Record<string, unknown>
  if (p.suite !== HIDDEN_VETTING_SUITE) return undefined
  if (typeof p.helperKey !== 'string' || typeof p.tokenKey !== 'string') return undefined
  const labels = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined
  const vetterLabels = labels(p.vetterLabels)
  const tokenLabels = labels(p.tokenLabels)
  if (!vetterLabels || !tokenLabels) return undefined
  const drip = typeof p.dripPerTick === 'number' && Number.isInteger(p.dripPerTick) ? p.dripPerTick : undefined
  return {
    suite: p.suite,
    helperKey: p.helperKey,
    tokenKey: p.tokenKey,
    vetterLabels,
    tokenLabels,
    dripPerTick: Math.max(1, drip ?? PARAMETER_DEFAULTS.dripPerTick),
    tickLength: typeof p.tickLength === 'string' && p.tickLength ? p.tickLength : PARAMETER_DEFAULTS.tickLength,
    events: Array.isArray(p.events) ? p.events : [],
  }
}

/** `vta/pcs/applications/create/0.1`. One application per join attempt, before any vetter is asked. */
export interface ApplicationsCreatePayload {
  /** The VTA context the app acts in. */
  contextId: string
  /** The community being joined. */
  community: string
  /** The DID that will sign the join submission: the proof is bound to it. */
  joinDid: string
  parameters: PublishedConfig
}

/**
 * The id the version probe asks for: no agent can hold it, so the answer is
 * `notFound` from one that serves `vta/pcs/*` and `unsupportedType` from one
 * that does not. A probe must not create anything, and this creates nothing.
 */
export const PCS_PROBE_APPLICATION_ID = 'urn:uuid:00000000-0000-4000-8000-000000000000'

/** What the agent returns for an application. `attestations` is the progress surface. */
export interface PcsApplication {
  applicationId: string
  /** The applicant's PCS identifier, carried to vetters in the request's ext. */
  id?: string
  attestations?: Array<{ meta?: Record<string, unknown> } & Record<string, unknown>>
}

/** `vta/pcs/applications/show/0.1`. The agent is the source of truth; this re-reads it. */
export interface ApplicationsShowPayload {
  applicationId: string
}

/** A vetter's hidden attestation, passed through to the agent unchanged. */
export interface HiddenAttestation {
  suite: string
  attestation: string
  meta: Record<string, unknown>
  token: { label: string; serial: string; shown: string }
}

/** `vta/pcs/verify-attestation/0.1`. The agent keeps it; the app stores no attestation. */
export interface VerifyAttestationPayload {
  applicationId: string
  parameters: PublishedConfig
  attestation: HiddenAttestation
}

/** `vta/pcs/prove/0.1`. Slower than the others: allow 90s against 30s elsewhere. */
export interface ProvePayload {
  applicationId: string
  parameters: PublishedConfig
  /** The criterion's requirements digest, from the join manifest. */
  requirementsDigest: string
  /** Single-use, from `vtc/vetting/pcs-challenge/0.1`, fetched immediately before proving. */
  challenge: string
}

/** `vta/pcs/applications/delete/0.1`. Sent once the join is decided, either way. */
export interface ApplicationsDeletePayload {
  applicationId: string
}

/**
 * The error codes the applicant's round can return, as `payload.code` of a
 * `trust-task-error` document. A refusal is not a response, so the parse of a
 * normal reply fails first and the raw JSON is read for this.
 */
export const PCS_ERROR = {
  /** Not enough valid attestations yet. A progress state, not a failure. */
  noUsableAttestation: 'vta/pcs/prove:noUsableAttestation',
  /** The agent holds no such application, or it is in a context this app cannot act in. */
  proveNotFound: 'vta/pcs/prove:notFound',
  verifyNotFound: 'vta/pcs/verify-attestation:notFound',
  /** An old openvtc vetter, another community, or a closed token label. */
  attestationInvalid: 'vta/pcs/verify-attestation:attestationInvalid',
  /** The parameters object does not match the schema — ours to fix, not the user's. */
  parametersInvalid: 'parametersInvalid',
  /** The agent does not implement the community's suite. The user cannot join this criterion. */
  unsupportedSuite: 'unsupportedSuite',
  /** The agent is older than 0.60 and does not serve vta/pcs at all. */
  unsupportedType: 'unsupportedType',
} as const

/** The code of a `trust-task-error`, or undefined when the document is not one. */
export function pcsErrorCode(document: unknown): string | undefined {
  if (!document || typeof document !== 'object') return undefined
  const payload = (document as { payload?: unknown }).payload
  if (!payload || typeof payload !== 'object') return undefined
  const code = (payload as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
