/**
 * The HCP directive behind "Answers on" (step 7.29, C5): Keyring, as the person's Management Client, sends
 * `hcp/directives/set/0.1` to their own VTA, without `accessToken`. The plugin applies the directive in code
 * (track B); nothing here does.
 *
 * On sets a `permit`, Off sets a `deny`. HCP 6.4: where two directives that apply disagree, `deny` prevails, and
 * `directives/remove` is P2, so after a `deny` a later `permit` would lose. Callers go through `./view.ts`'s
 * `changeHcpAnswers`, which never sends a `permit` after a `deny`.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/answersOn/directive
 */
import type { HcpCopyLanguage } from '../copy'
import { callHcp, type HcpVtaPort, onHcpFailure } from '../vtaPort'
import { answersText } from './copy'

// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_DIRECTIVES_SET = 'https://trusttasks.org/spec/hcp/directives/set/0.1'

/**
 * The directive's `action`. PROPOSED (brief, "Decided here"): the plan writes it `<directive-action-iri>`, and its
 * registry home is an editor question (N8). Defined once, here: if the registry names it otherwise, this constant is
 * the one place to change.
 */
export const HCP_ANSWERS_OTHERS_ACTION = 'https://registry.trustoverip.org/dtg/directive-action/answerOthers/1'

export interface HcpAnswersInput {
  /** The grant's Client Operator id (the `hcpGrantClient` effect's `operator.id`): the directive applies to it only. */
  operatorId: string
  /** On sets a `permit`, off a `deny`. */
  on: boolean
  /** The person's current language: `text` is in their own words. */
  language: HcpCopyLanguage
}

/**
 * The `directives/set` payload: `action`, `effect`, `text` in the person's language, and `operators` naming only this
 * grant's operator. No `categories` (every category) and no `accessToken`.
 */
export function hcpAnswersPayload({ operatorId, on, language }: HcpAnswersInput): Record<string, unknown> {
  return {
    action: HCP_ANSWERS_OTHERS_ACTION,
    effect: on ? 'permit' : 'deny',
    text: answersText(on ? 'AnswersOnDirectiveText' : 'AnswersOffDirectiveText', language),
    operators: [operatorId],
  }
}

export type HcpAnswersSetResult =
  /**
   * The VTA set the directive. `directiveId` is the one its answer names, or null when the answer carries none in the
   * expected shape: the VTA answered success, so the directive is held as set either way (an Off must lock the switch
   * whatever the answer looked like).
   */
  | { ok: true; directiveId: string | null }
  | { ok: false; refused: string }
  | { ok: false; unreachable: true }
  | { ok: false; off: true }

/** The `directiveId` of a `directives/set` answer, if it has one. */
function readDirectiveId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const directive = (value as { directive?: unknown }).directive
  if (typeof directive !== 'object' || directive === null) return null
  const id = (directive as { directiveId?: unknown }).directiveId
  return typeof id === 'string' && id !== '' ? id : null
}

/** Send one `directives/set`, once (never retried on its own). */
export async function setHcpAnswers(port: HcpVtaPort, input: HcpAnswersInput): Promise<HcpAnswersSetResult> {
  const outcome = await callHcp<unknown>(port, HCP_DIRECTIVES_SET, hcpAnswersPayload(input))
  if (outcome.ok) return { ok: true, directiveId: readDirectiveId(outcome.value) }
  return onHcpFailure<HcpAnswersSetResult>(outcome, {
    refused: (code) => ({ ok: false, refused: code }),
    unreachable: () => ({ ok: false, unreachable: true }),
    off: () => ({ ok: false, off: true }),
  })
}
