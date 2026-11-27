/**
 * A new memory the person declares (step 7.27 track C, part 3, "A new memory (C3)"): Keyring sends
 * `hcp/entries/create/0.1` to the person's own VTA as its Management Client, without `accessToken`.
 *
 * Decided by the brief: the category is `general_preferences` for every memory added in the demo (the screen has no
 * category picker); the subject is the person's manager DID; `language` is the app's current language tag.
 *
 * Nothing here logs the text, the payload or the response.
 *
 * @module connected-agents/hcp/newMemory
 */
import { HCP_ENTRIES_CREATE } from './types'
import { callHcp, type HcpVtaPort } from './vtaPort'

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
  | { ok: false; refused: string }
  | { ok: false; unreachable: true; message: { key: 'MemoryNotSaved' } }

/** The `refused` code given when the VTA answers without `entry`. */
export const HCP_NO_ENTRY = 'noEntry'

/**
 * Save a memory. Invalid text sends nothing. Success is a response with `entry`; a response without one is
 * `refused` with {@link HCP_NO_ENTRY}. Unreachable gives the copy key `MemoryNotSaved`.
 */
export async function addHcpMemory(port: HcpVtaPort, input: HcpNewMemoryInput): Promise<HcpAddMemoryResult> {
  if (typeof input.text !== 'string' || !hcpMemoryTextValid(input.text)) return { ok: false, invalid: true }
  const outcome = await callHcp<unknown>(port, HCP_ENTRIES_CREATE, hcpCreatePayload(input))
  if (!outcome.ok) {
    if ('refused' in outcome) return { ok: false, refused: outcome.refused }
    return { ok: false, unreachable: true, message: { key: 'MemoryNotSaved' } }
  }
  const value = outcome.value
  if (typeof value === 'object' && value !== null && 'entry' in value && (value as { entry: unknown }).entry != null) {
    return { ok: true, entry: (value as { entry: unknown }).entry }
  }
  return { ok: false, refused: HCP_NO_ENTRY }
}
