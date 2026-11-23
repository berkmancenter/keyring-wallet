/**
 * Trust Task Display Registry Interface
 *
 * The UI-side half of R5 (docs/plans/reference-app-sdk-packaging.md, Idea 1
 * "The Approver"): mapping a Trust Task `typeUri` to display data for a
 * generic approve/deny screen, exactly mirroring
 * `types/credential-display.ts`'s `ICredentialDisplayRegistry` — a registry
 * that extracts structured `Field[]` data from a document, rather than a
 * registry of React components. The actual rendering is one generic
 * component (`screens/TrustTaskApprovalCard.tsx`) that lists whatever
 * `Field[]` the matching handler returns, the same relationship
 * `ICredentialDisplayRegistry` has to `CredentialCard10`/`Card11Pure`.
 *
 * It lives in core so that modules like a demo profile can implement it
 * without core needing to import that profile directly.
 */

import { Field } from '@bifold/oca/build/legacy'

/** Display data for one pending Trust Task request, extracted from its document. */
export interface TrustTaskDisplayResult {
  /** Screen/card title, e.g. "Access request". */
  title: string
  /** Fields to display — reuses the same `Field` shape the credential-display registry returns, so the generic screen can share rendering with credential offer UI if desired. */
  fields: Field[]
  /** Translation key for the approve action's button label. */
  approveLabel: string
  /** Translation key for the deny action's button label. */
  denyLabel: string
}

/** One task type's display handler. */
export interface ITrustTaskDisplayHandler {
  /** The Type URI this handler matches (the base/request URI, not `#response`). */
  typeUri: string
  getDisplayInfo(document: Record<string, unknown>): TrustTaskDisplayResult
}

/**
 * Interface for the Trust Task display registry.
 *
 * This registry allows modules to register custom display handlers for
 * different Trust Task types. Core uses this interface without needing to
 * know about specific implementations — same shape as
 * `ICredentialDisplayRegistry`.
 */
export interface ITrustTaskDisplayRegistry {
  hasHandler(typeUri: string): boolean
  /** Display info for a document of the given type — a documented fallback (empty fields, generic labels) when no handler matches, so an unregistered type still renders something rather than throwing. */
  getDisplayInfo(typeUri: string, document: Record<string, unknown>): TrustTaskDisplayResult
}
