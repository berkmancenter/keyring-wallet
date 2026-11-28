/**
 * What the HCP approve screen shows (step 7.27 track C, part 2): copy keys and parameters, never formatted text.
 *
 * The checklist rows are the effects' `summary` strings, verbatim and in the order sent ("Decided here"), a kind
 * Keyring does not know included (VTI hcp.md §5.1): a
 * `task-consent/request` surface renders `summary` as the VTA wrote it and never substitutes its own prose. They are
 * plain text; the screen must never interpret them as markup. The title, the warning, the "not signing in" line and
 * the button are Keyring's own strings (`./copy.ts`); the "not signing in" line is on every consent, whatever effects
 * arrive. Nothing here holds the match number.
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
    // Keyring's own, on every consent: not an effect, so no effect (or lack of one) can drop it.
    notSignIn: { key: 'ApproveNotSignIn' },
    approve: { key: 'Approve' },
    clientVid: effects.client.clientId,
    ...(effects.client.grantId ? { grantId: effects.client.grantId } : {}),
    threadId,
    expiresAt: effects.term.expiresAt,
    operator: effects.client.operator,
    persistence: effects.term.persistence,
    ...(effects.useUntil ? { maxUseSeconds: effects.useUntil.maxUseSeconds } : {}),
    // The request names no purpose. No picker: no choice would reach the VTA, so the grant allows them all, and the
    // screen states that scope. TODO(vti): offer a choice once task-consent/decision can carry it.
    ...(effects.choices.length > 0
      ? {
          purposesAllowed: {
            key: 'ApproveAllowsPurposes' as const,
            params: { name },
            rows: effects.choices.map((c) => c.summary),
          },
        }
      : {}),
  }
}
