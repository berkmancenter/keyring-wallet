/**
 * Memories for agent connect (docs/plans/agent-connect-plan.md §3.15, §2.6, §7.7): what the picker offers, "New
 * memory", the count the details show, and the guard a connect starts with. Everything goes through a narrow port
 * over the owner's VTA session (`VtaClient`), so the rules are tested against fakes held to the specification's
 * schemas.
 *
 * @module connected-agents/memories
 */

import type { CreateMemoryResult, PickerMemory } from './types'

/** The part of `VtaClient` this module uses. */
export interface MemoryPort {
  listContexts(): Promise<{ id: string; name?: string }[]>
  createContext(id: string, name: string): Promise<unknown>
  whoAmI(): Promise<{ roles?: string[]; scopes?: string[] }>
  task(type: string, payload: Record<string, unknown>): Promise<unknown>
}

/** A memory's id prefix (§3.15, D35): `keyring-memory-` and 10 random base32 characters, derived from nothing. */
export const MEMORY_ID_PREFIX = 'keyring-memory-'

/**
 * The prefix of the empty context Keyring creates for an agent bound to no memory (§3.3's `act` row). It is the agent's,
 * not a memory, so the picker never offers it.
 */
export const AGENT_CONTEXT_PREFIX = 'keyring-agent-'

/** Contexts that are never a memory: the persona context (§3.15, "never create under the persona context") and the VTA's default. */
export const NOT_MEMORIES: readonly string[] = ['keyring', 'vta']

/** §3.15's tunable warning: a memory holding more items than this is flagged in the details. */
export const MEMORY_COUNT_WARNING = 1000

/** `vta/memory/list` at 0.3: the first version with `includeValues`, so a count reads no value. */
// version-pinned: includeValues, which keeps a count from reading any value, exists only from 0.3
export const MEMORY_LIST_TASK = 'https://trusttasks.org/spec/vta/memory/list/0.3'

/** The most pages read for one count (500 items a page): past it the count is reported as incomplete. */
export const MEMORY_COUNT_MAX_PAGES = 40

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** 10 lowercase base32 characters (50 bits) from `randomBytes`, the phone's secure generator (§3.15). */
export function randomContextSuffix(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(10)
  if (bytes.length < 10) throw new Error('not enough random bytes')
  return Array.from(bytes.slice(0, 10), (b) => BASE32[b & 31]).join('')
}

/**
 * Whether the session is an unrestricted administrator (§3.15, §1.5): `admin` among its roles and no scopes, as step
 * 0.1(p) recorded it (`{"roles": ["admin"], "scopes": []}`). A scoped administrator cannot create a top-level context.
 */
export function isUnrestrictedAdministrator(who: { roles?: string[]; scopes?: string[] } | undefined): boolean {
  return !!who && Array.isArray(who.roles) && who.roles.includes('admin') && (who.scopes ?? []).length === 0
}

const isMemoryContext = (id: string) =>
  !NOT_MEMORIES.includes(id) &&
  !id.startsWith(AGENT_CONTEXT_PREFIX) &&
  !NOT_MEMORIES.some((n) => id.startsWith(`${n}/`))

/**
 * The memories the picker offers (§3.15, §6): every context but the persona context, the VTA's default and agents'
 * own contexts, each by its name (a context without one is not offered: a context id is never a label). A context
 * that contains another, whose id is its own followed by "/" (step 0.1(o)), is greyed. Sorted by name.
 */
export async function pickerMemories(port: Pick<MemoryPort, 'listContexts'>): Promise<PickerMemory[]> {
  const contexts = await port.listContexts()
  const ids = contexts.map((c) => c.id)
  return contexts
    .filter((c) => isMemoryContext(c.id) && typeof c.name === 'string' && c.name.trim() !== '')
    .map((c) => ({
      id: c.id,
      name: (c.name as string).trim(),
      containsOthers: ids.some((o) => o.startsWith(`${c.id}/`)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** The most ids drawn for one new memory or agent context: a collision is a redraw (§3.15), and 50 bits make a second one vanishingly rare. */
const CREATE_ATTEMPTS = 3

/** What creating an agent's own context answers: its id, or why there is none. */
export type CreateAgentContextResult = { ok: true; id: string } | { ok: false; code: 'heldForApproval' | 'failed' }

/**
 * The agent's own context, for a connect with no memory chosen (§3.3's `act` row: "the entry's context is a new empty
 * context Keyring creates for the agent"): a top-level context `keyring-agent-<10 random base32>`, named after the
 * agent. It is no memory, so the picker never offers it (`isMemoryContext`) and no memory's name can collide with it.
 * Like a memory create (step 5), it is sent without waiting for consent: one an approval rule holds is
 * `heldForApproval`, never retried. A collision with an existing id is a redraw.
 */
export async function createAgentContext(
  port: Pick<MemoryPort, 'listContexts' | 'createContext'>,
  agentName: string,
  randomBytes: (length: number) => Uint8Array,
  isHeld: (error: unknown) => boolean = () => false
): Promise<CreateAgentContextResult> {
  const name = agentName.trim()
  if (name.length < 1 || name.length > 64) return { ok: false, code: 'failed' }
  let taken: Set<string>
  try {
    taken = new Set((await port.listContexts()).map((c) => c.id))
  } catch {
    return { ok: false, code: 'failed' }
  }
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const id = `${AGENT_CONTEXT_PREFIX}${randomContextSuffix(randomBytes)}`
    if (taken.has(id)) continue
    try {
      await port.createContext(id, name)
      return { ok: true, id }
    } catch (error) {
      if (isHeld(error)) return { ok: false, code: 'heldForApproval' }
      // As for a memory: a refusal does not say whether the id existed, so re-list; a now-listed id of another name
      // was a collision (redraw), one of this name was made.
      try {
        const after = await port.listContexts()
        if (after.some((c) => c.id === id && c.name?.trim() !== name)) {
          taken.add(id)
          continue
        }
        if (after.some((c) => c.id === id)) return { ok: true, id }
      } catch {
        // fall through to failed
      }
      return { ok: false, code: 'failed' }
    }
  }
  return { ok: false, code: 'failed' }
}

/**
 * "New memory" (§3.15): a top-level context `keyring-memory-<10 random base32>` named as typed (1 to 64 characters
 * after trimming). A name another memory already has is refused before anything is created (`duplicateName`,
 * compared ignoring case). The id is never derived from the name; a collision with an existing id is a redraw.
 */
export async function createMemory(
  port: Pick<MemoryPort, 'listContexts' | 'createContext'>,
  typed: string,
  randomBytes: (length: number) => Uint8Array,
  /** Whether a refused create was held for consent (`VtaClient`'s `consentPendingOf`); never retried. */
  isHeld: (error: unknown) => boolean = () => false
): Promise<CreateMemoryResult> {
  const name = typed.trim()
  if (name.length < 1 || name.length > 64) return { ok: false, code: 'failed' }
  let contexts: { id: string; name?: string }[]
  try {
    contexts = await port.listContexts()
  } catch {
    return { ok: false, code: 'failed' }
  }
  const taken = new Set(contexts.map((c) => c.id))
  if (contexts.some((c) => isMemoryContext(c.id) && c.name?.trim().toLowerCase() === name.toLowerCase())) {
    return { ok: false, code: 'duplicateName' }
  }
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const id = `${MEMORY_ID_PREFIX}${randomContextSuffix(randomBytes)}`
    if (taken.has(id)) continue
    try {
      await port.createContext(id, name)
      return { ok: true, memory: { id, name } }
    } catch (error) {
      if (isHeld(error)) return { ok: false, code: 'heldForApproval' }
      // A create refused because the id exists (step 0.1(p): a second create is refused) is a redraw; anything else
      // fails. Keyring cannot tell the two apart from the refusal, so it re-lists: a now-listed id was a collision.
      try {
        const after = await port.listContexts()
        if (after.some((c) => c.id === id && c.name?.trim() !== name)) {
          taken.add(id)
          continue
        }
        if (after.some((c) => c.id === id)) return { ok: true, memory: { id, name } }
      } catch {
        // fall through to failed
      }
      return { ok: false, code: 'failed' }
    }
  }
  return { ok: false, code: 'failed' }
}

/** A memory's size as the details show it (§3.15): live items, and the latest write among them. */
export type MemoryCount = { ok: true; count: number; lastChange?: string; complete: boolean } | { ok: false }

/**
 * Count one memory's live items with `vta/memory/list/0.3`, `includeValues: false`, every page (§3.15). Counted when
 * the details open, never on a timer: the caller decides when. The last change is the latest `updatedAt` among the live
 * items (`MemoryRecord.updatedAt` is required at the pin). A listing cut short by the page limit is `complete: false`.
 */
export async function countMemory(port: Pick<MemoryPort, 'task'>, contextId: string): Promise<MemoryCount> {
  let count = 0
  let latest: number | undefined
  let latestIso: string | undefined
  let cursor: string | undefined
  try {
    for (let page = 0; page < MEMORY_COUNT_MAX_PAGES; page++) {
      const answer = (await port.task(MEMORY_LIST_TASK, {
        contextId,
        includeValues: false,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      })) as { items?: unknown; nextCursor?: unknown }
      if (!answer || !Array.isArray(answer.items)) return { ok: false }
      for (const item of answer.items as { deleted?: unknown; updatedAt?: unknown }[]) {
        if (item?.deleted === true) continue
        count++
        const at = typeof item?.updatedAt === 'string' ? Date.parse(item.updatedAt) : NaN
        if (!Number.isNaN(at) && (latest === undefined || at > latest)) {
          latest = at
          latestIso = item.updatedAt as string
        }
      }
      if (typeof answer.nextCursor !== 'string' || answer.nextCursor === '') {
        return { ok: true, count, ...(latestIso ? { lastChange: latestIso } : {}), complete: true }
      }
      cursor = answer.nextCursor
    }
  } catch {
    return { ok: false }
  }
  return { ok: true, count, ...(latestIso ? { lastChange: latestIso } : {}), complete: false }
}

/** Whether a count crossed §3.15's warning, and by how much it rose since the last opening. */
export function countNotice(count: number, previous: number | undefined): { overWarning: boolean; rose?: number } {
  const rose = previous !== undefined && count > previous ? count - previous : undefined
  return { overWarning: count > MEMORY_COUNT_WARNING, ...(rose ? { rose } : {}) }
}

/** The answer of the guard a connect starts with (§3.15, §2.6). */
export type ConnectGuard = 'ok' | 'notAdministrator' | 'unreachable'

/**
 * The guard before the picker shows (§3.15): an unrestricted administrator may connect; anything else ends the
 * connect with nothing created. §2.6's version check runs beside it (`vtaTooOld`, step 7.7's driver).
 */
export async function connectGuard(port: Pick<MemoryPort, 'whoAmI'>): Promise<ConnectGuard> {
  try {
    return isUnrestrictedAdministrator(await port.whoAmI()) ? 'ok' : 'notAdministrator'
  } catch {
    return 'unreachable'
  }
}
