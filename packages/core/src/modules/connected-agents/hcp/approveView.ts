/**
 * What the HCP approve screen shows (step 7.27 track C, part 2): copy keys and parameters, never formatted text.
 *
 * The checklist rows are the effects' `summary` strings, verbatim and in the order sent ("Decided here"), a kind
 * Keyring does not know included (VTI hcp.md §5.1): a
 * `task-consent/request` surface renders `summary` as the VTA wrote it and never substitutes its own prose. They are
 * plain text; the screen must never interpret them as markup. The title, the warning and the button are Keyring's
 * own strings (`./copy.ts`). Nothing here holds the match number.
 *
 * @module connected-agents/hcp/approveView
 */
import type { HcpEffects } from './approvals'
import type { HcpApprovalView } from './types'

/**
 * The approve screen's view model, for the name the person gave, the request's effects and the thread the request
 * answers (the scanned one, already matched by `isHcpApprovalFor`).
 */
export function hcpApproveView(name: string, effects: HcpEffects, threadId: string): HcpApprovalView {
  return {
    title: { key: 'ApproveTitle', params: { name } },
    rows: [...effects.rows],
    warning: { key: 'ApproveOwnTerminal' },
    approve: { key: 'Approve' },
    clientVid: effects.client.clientId,
    ...(effects.client.grantId ? { grantId: effects.client.grantId } : {}),
    threadId,
    expiresAt: effects.term.expiresAt,
    operator: effects.client.operator,
    persistence: effects.term.persistence,
    ...(effects.choices.length > 0
      ? {
          purposeChoice: {
            key: 'ApproveChoosePurpose' as const,
            options: effects.choices.map(({ purpose, description, summary }) => ({ purpose, description, summary })),
          },
        }
      : {}),
  }
}
