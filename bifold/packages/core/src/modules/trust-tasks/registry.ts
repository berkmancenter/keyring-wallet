/**
 * The open Trust Task type→handler registry — R5 of
 * docs/plans/reference-app-sdk-packaging.md, specified precisely by
 * docs/plans/reference-app-sdk-packaging/2026-09-01-al.md §2 ("Yes, we wrap
 * — but we wrap orchestration, not types"): registration carries
 * `{ spec, orchestration, renderer }`, not a bare `typeUri -> callback`
 * dispatch table.
 *
 * `setupTrustTasksInbound` in `ceremony.ts` used to route an inbound document
 * to a handler via a hardcoded if/else on `document.type` — one branch per
 * known VRC/witness/discovery type. This module is the open registry that
 * replaces it: every type this wallet understands, including the built-in
 * VRC/witness/discovery ones, is a registration here, looked up by
 * {@link TrustTaskRegistry.resolveForDocumentType}. A new demo adds a task
 * type by registering into this same registry — it never edits
 * `ceremony.ts`'s dispatch.
 *
 * What this module does NOT own: the renderer half of R5 (the UI-side
 * registry mapping a `typeUri` to display data, mirroring
 * `ICredentialDisplayRegistry`) lives in `./display/trustTaskDisplayRegistry`
 * — this module stays platform-neutral (no React), matching how
 * `TrustTasksService` and `ceremony.ts` itself are structured. The composite
 * `registerTrustTask({ spec, orchestration, renderer })` call surface the
 * plan asks for lives in `./registerTrustTask` and registers into both.
 *
 * @module trust-tasks/registry
 */

import type { Agent } from '@credo-ts/core'

import type { TrustTaskSpecPolicy, TrustTasksService } from './services/TrustTasksService'

/** The transport-authenticated peer context a registered handler receives — same shape ceremony.ts's existing handlers already take. */
export interface InboundContext {
  connectionId: string
  senderDid: string
  recipientDid: string
}

/** A handler for one leg (request or response) of a registered Trust Task type. */
export type TrustTaskDocumentHandler = (
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
) => Promise<void>

/**
 * The orchestration a registration carries beyond the document-level
 * framework — the part 2026-09-01-al.md §2 calls "real Keyring behaviour with
 * no upstream equivalent": who proposes, whether the peer can play, version
 * gating, and idempotence. `ceremony.ts`'s existing VRC exchange has bespoke
 * versions of all four (`isDeterministicProposer`, `peerSupportsTaskType`,
 * `TRUST_TASKS_MIN_RCE_VERSION`, documents queried by `{typeUri,
 * connectionId}`); a registration for a NEW task type declares the same
 * shape here rather than reinventing it inline. Every field is optional
 * because not every task type needs every hook — the Approver demo's
 * access-request task, for instance, is always user-initiated (never
 * auto-proposed), so it declares no `isDeterministicProposer`.
 */
export interface TrustTaskOrchestration {
  /**
   * Deterministic tie-break for who proposes when either peer could open the
   * exchange — the same shape as `ceremony.ts`'s own
   * `isDeterministicProposer`(myConnectionDid, theirConnectionDid) (lower DID
   * proposes). Undefined means this task type is never auto-proposed — it is
   * always opened by explicit user or app action, which is the common case
   * for a task type built on top of an existing relationship (an approval
   * request, a factor check) rather than one that negotiates itself into
   * existence like the VRC relationship handshake does.
   */
  isDeterministicProposer?: (myConnectionDid: string, theirConnectionDid: string) => boolean
  /**
   * Minimum RCE protocol version required on both sides before this task
   * type is attempted. Defaults to {@link TRUST_TASKS_MIN_RCE_VERSION} — any
   * peer that can run Trust Tasks at all satisfies the default.
   */
  minRceVersion?: number
  /**
   * Whether a proposer must confirm (via `trust-task-discovery`) that the
   * peer advertises this type before sending the first document. Defaults to
   * true — the same discipline `openRelationshipExchange` and
   * `sendWitnessShareForExchange` already apply. A registration can opt out
   * when it doesn't need capability discovery (e.g. because both sides are
   * expected to be running the same demo build, so "unsupported" fails loud
   * and immediately on send rather than needing negotiation).
   */
  requiresDiscovery?: boolean
}

/**
 * One task type's registration: what governs its documents (`spec` — reused
 * from {@link TrustTaskSpecPolicy}, the same shape `TrustTasksService.consume`
 * already takes), how it fits into the relationship's orchestration
 * (`orchestration`), and how its two legs are handled.
 *
 * `responseSpec` is separate from `spec` because the framework's own
 * generated modules keep them separate (`SPEC` / `RESPONSE_SPEC` — see e.g.
 * `@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload`):
 * `isRecipientRequired` tracks the *issuing* party's requirement on a
 * response, which is a different value than the request's.
 */
export interface TrustTaskRegistration {
  /** The base (request) Type URI. Its `#response` is registered under the same entry — see {@link TrustTaskRegistry.resolveForDocumentType}. */
  typeUri: string
  spec: TrustTaskSpecPolicy
  responseSpec?: TrustTaskSpecPolicy
  orchestration?: TrustTaskOrchestration
  /** Handles an inbound document whose type is exactly {@link typeUri}. */
  handleRequest: TrustTaskDocumentHandler
  /**
   * Handles an inbound document whose type is `${typeUri}#response`.
   * Optional: a registration with no response leg (or one that doesn't care
   * to observe it) falls back to the registry's documented default — retain
   * and log, same as an unregistered type, so nothing is silently dropped.
   */
  handleResponse?: TrustTaskDocumentHandler
}

/**
 * The open registry itself. One instance is enough for a running agent —
 * `./ceremony.ts` uses the module singleton {@link trustTaskRegistry} — but
 * the class is exported so tests can build an isolated instance rather than
 * mutate shared module state.
 */
export class TrustTaskRegistry {
  private registrations = new Map<string, TrustTaskRegistration>()

  /**
   * Register a task type. Throws on a duplicate `typeUri` — a second
   * registration for the same type is almost always a bug (two profiles
   * both claiming the same task type), and unlike a DI container token
   * (where "last one wins" is the documented, deliberate behaviour for
   * app-chrome overrides — see demo-profiles/README.md) a Trust Task type is
   * not something two demos should ever legitimately share.
   */
  register(registration: TrustTaskRegistration): void {
    if (this.registrations.has(registration.typeUri)) {
      throw new Error(`a Trust Task type is already registered for ${registration.typeUri}`)
    }
    this.registrations.set(registration.typeUri, registration)
  }

  /** Remove a registration — tests only; a running agent never needs to. */
  unregister(typeUri: string): void {
    this.registrations.delete(typeUri)
  }

  get(typeUri: string): TrustTaskRegistration | undefined {
    return this.registrations.get(typeUri)
  }

  /**
   * Resolve the registration governing a raw inbound `document.type`,
   * stripping `#response` and reporting whether it was present — the one
   * lookup `ceremony.ts`'s dispatch needs. Returns undefined for a type
   * nothing has registered, same as today's if/else falling through to its
   * "unhandled trust-task type" branch.
   */
  resolveForDocumentType(documentType: string): { registration: TrustTaskRegistration; isResponse: boolean } | undefined {
    const isResponse = documentType.endsWith('#response')
    const baseType = isResponse ? documentType.slice(0, -'#response'.length) : documentType
    const registration = this.registrations.get(baseType)
    return registration ? { registration, isResponse } : undefined
  }

  /** All registered entries — used by discovery to advertise supported types. */
  list(): readonly TrustTaskRegistration[] {
    return [...this.registrations.values()]
  }

  /** Just the type URIs, for a trust-task-discovery answer. */
  listTypeUris(): string[] {
    return [...this.registrations.keys()]
  }

  /** Tests only — reset to empty. */
  clear(): void {
    this.registrations.clear()
  }
}

/**
 * The module-level registry `ceremony.ts` dispatches through. Built-in
 * VRC/witness/discovery handling registers into this same instance at module
 * load (see the bottom of `ceremony.ts`) rather than being a separate,
 * privileged path — proving the registry is real dispatch, not a decoration
 * sitting beside the actual if/else.
 */
export const trustTaskRegistry = new TrustTaskRegistry()
