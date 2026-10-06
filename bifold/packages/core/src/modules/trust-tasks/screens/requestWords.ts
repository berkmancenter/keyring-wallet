/**
 * What a request card says about who asks and what for (Alberto's approval
 * loop on al-signer, 10-06): "Someone asks your agent to run
 * vta/contexts/create/1.0", and "Keyring couldn't tell what this would do".
 *
 * - The task: the common ones in plain words ("create a context"), the rest
 *   by their short name as before.
 * - The one asking: this phone; else a device of this agent by the name My
 *   devices gives it (its own name, its label, or "A computer or other app"
 *   for a key such as pnm's); else as anyone else is named. Never the DID.
 *
 * @module trust-tasks/screens/requestWords
 */
import type { TFunction } from 'i18next'

import type { KnownDevice } from '../module/vtaAgent'

import { partyLabelStartOf } from './communityName'
import { deviceNameOf } from './deviceWords'
import { shortTask } from './RequestCard'

/** The tasks a request card names in words, by their path without the version. */
export const TASK_WORDS: Readonly<Record<string, string>> = {
  'vta/contexts/create': 'Requests.TaskContextsCreate',
  'vta/contexts/delete': 'Requests.TaskContextsDelete',
  'vta/webvh/dids/create': 'Requests.TaskDidsCreate',
  'vta/webvh/dids/delete': 'Requests.TaskDidsDelete',
  'keys/revoke': 'Requests.TaskKeysRevoke',
  'keys/export-secret': 'Requests.TaskKeysExport',
  'acl/grant': 'Requests.TaskAclGrant',
  'acl/update': 'Requests.TaskAclUpdate',
  'acl/revoke': 'Requests.TaskAclRevoke',
  'acl/swap-key': 'Requests.TaskAclSwapKey',
  'policy/upsert': 'Requests.TaskPolicyUpsert',
  'device/wipe': 'Requests.TaskDeviceWipe',
  'device/set-wake': 'Requests.TaskDeviceSetWake',
}

/** `https://trusttasks.org/spec/vta/contexts/create/1.0` → `vta/contexts/create`. */
export const taskPath = (taskType: string): string => shortTask(taskType).replace(/\/\d+(\.\d+)*$/, '')

/** The task in words ("create a context"), or undefined for one Keyring has no words for. */
export function taskWords(taskType: string, t: TFunction): string | undefined {
  const key = TASK_WORDS[taskPath(taskType)]
  return key ? (t(key) as string) : undefined
}

export interface RequesterContext {
  /** This phone's manager DID on the current agent. */
  managerDid?: string
  knownDevices?: Readonly<Record<string, KnownDevice>>
}

/** Who asks, at the start of a sentence. */
export function requesterName(did: string, context: RequesterContext, t: TFunction): string {
  const device = context.knownDevices?.[did]
  if (did === context.managerDid || device?.isThisPhone) return t('Requests.ThisPhone') as string
  if (device) return deviceNameOf(device, t as never)
  // A key with no record on the list yet: what kind of device it is, as My devices says.
  if (did.startsWith('did:key:') || did.startsWith('did:peer:')) return deviceNameOf({ did }, t as never)
  return partyLabelStartOf(did, t)
}

/** "This phone asks your agent to create a context", or with the task's short name when it has no words. */
export function requestLine(
  approval: { requester: string; taskType: string },
  context: RequesterContext,
  t: TFunction
): string {
  const requester = requesterName(approval.requester, context, t)
  const action = taskWords(approval.taskType, t)
  return (
    action
      ? t('Requests.AsksTo', { requester, action, interpolation: { escapeValue: false } })
      : t('MyAgent.ApprovalAsks', {
          requester,
          task: shortTask(approval.taskType),
          interpolation: { escapeValue: false },
        })
  ) as string
}
