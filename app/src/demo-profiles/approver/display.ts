/**
 * The UI-side half of R5 for this one task type: extracts `Field[]` from an
 * `approver/access-request` document for the generic
 * `TrustTaskApprovalCard` — the Approver demo's registration into
 * `ITrustTaskDisplayRegistry`, mirroring how a credential type registers a
 * `CredentialDisplayHandler`.
 */

import { Attribute } from '@bifold/oca/build/legacy'
import type { ITrustTaskDisplayHandler } from '@bifold/core'

import { AccessRequestPayload, TYPE_URI } from './accessRequestSpec'

export const accessRequestDisplayHandler: ITrustTaskDisplayHandler = {
  typeUri: TYPE_URI,
  getDisplayInfo(document) {
    const payload = ((document as { payload?: AccessRequestPayload }).payload ?? {}) as AccessRequestPayload
    const fields = [new Attribute({ name: 'resource', label: 'Resource', value: payload.resource ?? '' })]
    if (payload.reason) {
      fields.push(new Attribute({ name: 'reason', label: 'Reason', value: payload.reason }))
    }
    return {
      title: 'Access request',
      fields,
      approveLabel: 'Global.Accept',
      denyLabel: 'Global.Decline',
    }
  },
}
