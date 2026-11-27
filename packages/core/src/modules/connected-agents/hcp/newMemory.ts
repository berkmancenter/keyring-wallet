/**
 * A new memory the person declares (step 7.27 track C, part 3, "A new memory (C3)"): Keyring sends
 * `hcp/entries/create/0.1` to the person's own VTA as its Management Client, without `accessToken`.
 *
 * Decided by the brief: the category is `general_preferences` for every memory added in the demo (the screen has no
 * category picker); the subject is the person's manager DID, which {@link addHcpMemory} reads from the VTA session
 * (the screen does not supply it); `language` is the app's current language tag.
 *
 * Nothing here logs the text, the payload or the response.
 *
 * @module connected-agents/hcp/newMemory
 */
import type { VtaSession } from '../services'
import { HCP_ENTRIES_CREATE } from './types'
import { callHcp, type HcpVtaPort, onHcpFailure } from './vtaPort'

/** The app's language tags. */
export type HcpMemoryLanguage = 'en' | 'fr' | 'pt-BR'

export const HCP_ENTRY_SCHEMA = 'https://hcp.example/spec/entry/2.0'
export const HCP_GENERAL_CONTEXT_PROFILE = 'https://hcp.example/spec/profiles/general-context/2.0'
export const HCP_MEMORY_CATEGORY = 'general_preferences'
/** The most characters (Unicode code points, as JSON Schema's `maxLength` counts them) a memory may have. */
export const HCP_MEMORY_MAX_CHARS = 4096

export interface HcpNewMemoryInput {
  text: string
  language: HcpMemoryLanguage
  managerDid: string
  now: Date
}

/** The `entries/create` payload, exactly the brief's object. `text` is trimmed. */
export function hcpCreatePayload({ text, language, managerDid, now }: HcpNewMemoryInput): Record<string, unknown> {
  return {
    schema: HCP_ENTRY_SCHEMA,
    subject: { id: managerDid },
    content: { profile: HCP_GENERAL_CONTEXT_PROFILE, value: text.trim(), language },
    classification: { categories: [HCP_MEMORY_CATEGORY] },
    assertion: { declarationType: 'person-declared' },
    record: {
      provenance: { source: 'person-input', assertedBy: { id: managerDid }, assertedAt: now.toISOString() },
    },
  }
}

/** 1 to {@link HCP_MEMORY_MAX_CHARS} characters after trimming. */
export function hcpMemoryTextValid(text: string): boolean {
  const length = [...text.trim()].length
  return length >= 1 && length <= HCP_MEMORY_MAX_CHARS
}

export type HcpAddMemoryResult =
  | { ok: true; entry: unknown }
  | { ok: false; invalid: true }
  | { ok: false; refused: string; message: { key: 'MemoryRefused' } }
  | { ok: false; unreachable: true; message: { key: 'MemoryNotSaved' } }
  | { ok: false; noManager: true; message: { key: 'MemoryNoVta' } }
  /**
   * The HCP flags are off: nothing was saved. No copy, on purpose: with the flags off the new-memory screen is not
   * reachable, so a string here would only show when something is already wrong.
   */
  | { ok: false; off: true }

/** The `refused` code given when the VTA answers without `entry`. */
export const HCP_NO_ENTRY = 'noEntry'

/** What adding a memory needs: the port, and the VTA session whose manager DID is the memory's subject. */
export interface HcpAddMemoryDeps {
  port: HcpVtaPort
  /** `vtaAgent` in the app: its state's `managerDid`, read at each save, as `../services.ts`'s `administratorSigner`. */
  session: Pick<VtaSession, 'getState'>
}

/** What the screen gives: never the manager DID, which is read from the session. */
export type HcpAddMemoryInput = Omit<HcpNewMemoryInput, 'managerDid'>

/**
 * Save a memory. Invalid text sends nothing. The subject is the session's manager DID, read when the payload is built
 * (so a rotated key is followed); with none (the phone is not signed in to its VTA) nothing is sent and the result is
 * `noManager`, with its own `MemoryNoVta` (not the unreachable string: nothing was sent), rather than a memory about
 * nobody. Success is a response with `entry`; a response without one is `refused` with {@link HCP_NO_ENTRY}. A refusal
 * gives `MemoryRefused`, which offers no retry; unreachable gives `MemoryNotSaved`.
 */
export async function addHcpMemory(deps: HcpAddMemoryDeps, input: HcpAddMemoryInput): Promise<HcpAddMemoryResult> {
  if (typeof input.text !== 'string' || !hcpMemoryTextValid(input.text)) return { ok: false, invalid: true }
  const managerDid = deps.session.getState().managerDid
  if (typeof managerDid !== 'string' || managerDid === '') {
    return { ok: false, noManager: true, message: { key: 'MemoryNoVta' } }
  }
  const payload = hcpCreatePayload({ text: input.text, language: input.language, managerDid, now: input.now })
  const outcome = await callHcp<unknown>(deps.port, HCP_ENTRIES_CREATE, payload)
  if (!outcome.ok) {
    return onHcpFailure<HcpAddMemoryResult>(outcome, {
      refused: (code) => ({ ok: false, refused: code, message: { key: 'MemoryRefused' } }),
      unreachable: () => ({ ok: false, unreachable: true, message: { key: 'MemoryNotSaved' } }),
      off: () => ({ ok: false, off: true }),
    })
  }
  const value = outcome.value
  if (typeof value === 'object' && value !== null && 'entry' in value && (value as { entry: unknown }).entry != null) {
    return { ok: true, entry: (value as { entry: unknown }).entry }
  }
  return { ok: false, refused: HCP_NO_ENTRY, message: { key: 'MemoryRefused' } }
}
