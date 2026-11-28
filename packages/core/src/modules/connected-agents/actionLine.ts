/**
 * The words for an agent action that did not fully happen (ac's #1122 obligation 1): each failure code an action
 * returns, mapped to the line the screen draws in place of the control it spends. The keys and their words are the
 * views' (`components/AgentActionNotice.tsx`); this map is the logic's.
 *
 * It is total by type: the table is a `Record` over every code `actions.ts` (`ActionFailure`) and `keepConnected.ts`
 * (`KeepConnectedResult`) can return, so a new code is a type error here, never a silent fallback. Each code means one
 * thing wherever it appears, so the shared `Action*` lines serve every action that returns it; the few that depend on
 * the action (a VDC not issued after Extend or Keep it connected) are chosen by the action.
 *
 * Null means "keep the screen as it is": only `retryPending` answering `unreachable`, whose line and "Try again" the
 * plan settles (§6: "Doesn't have "<memory>" yet." with "Try again"; "a failed retry keeps the line").
 *
 * @module connected-agents/actionLine
 */
import type { ActionFailure } from './actions'
import type { AgentActionLine, AgentActionLineKey, AgentActionName } from './components/AgentActionNotice'
import type { KeepConnectedResult } from './keepConnected'

/** Every code an agent action can fail with. */
export type AgentActionCode = ActionFailure | Extract<KeepConnectedResult, { ok: false }>['code']

/** What each code means, whichever action returned it. `vdc` is told by the action (Extend or Keep it connected). */
const BY_CODE: Record<Exclude<AgentActionCode, 'vdc'>, AgentActionLineKey> = {
  noRecord: 'ActionGone',
  notOffered: 'ActionNotOffered',
  notListed: 'ActionNotListed',
  // Not "couldn't reach": `unreachable` also covers a write that was sent and not answered, so only "didn't confirm"
  // is true in every case.
  unreachable: 'ActionNotConfirmed',
  notApplied: 'ActionNotApplied',
  lastMemory: 'RestoreLastMemory',
  revokeUnavailable: 'RemoveNotAvailable',
  revokeNotConfirmed: 'RemoveNotConfirmed',
  goneUnproven: 'RemoveGoneUnproven',
  notSaved: 'KeepNotSaved',
  notRecorded: 'KeepNotRecorded',
}

/**
 * The line for `action` failing with `code`, carrying the agent's name for the lines whose words take it (a line
 * whose words do not ignores it); null where the screen keeps what it shows (`retryPending`'s `unreachable`).
 */
export function agentActionLine(action: AgentActionName, code: AgentActionCode, name?: string): AgentActionLine | null {
  if (action === 'retryPending' && code === 'unreachable') return null
  const key: AgentActionLineKey =
    code === 'vdc' ? (action === 'keepConnected' ? 'KeepNoCredential' : 'ExtendNoCredential') : BY_CODE[code]
  return name === undefined ? { key } : { key, name }
}

/**
 * The line for an action's result, or undefined when it succeeded or the screen keeps what it shows. A promise that
 * threw is told as not confirmed: the action may have reached the VTA, and nothing says it did not.
 */
export async function lineOfAction(
  action: AgentActionName,
  run: Promise<{ ok: true } | { ok: false; code: AgentActionCode }>,
  name?: string
): Promise<AgentActionLine | undefined> {
  try {
    const result = await run
    return result.ok ? undefined : (agentActionLine(action, result.code, name) ?? undefined)
  } catch {
    return { key: 'ActionNotConfirmed' }
  }
}
