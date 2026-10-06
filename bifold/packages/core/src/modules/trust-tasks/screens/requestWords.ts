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

/**
 * What a task acts on, by its path's family: the object of "see …", "change …"
 * (the longest family that matches wins).
 */
export const TASK_THINGS: Readonly<Record<string, string>> = {
  'vta/contexts': 'Requests.ThingContexts',
  keys: 'Requests.ThingKeys',
  'vta/webvh/dids': 'Requests.ThingDids',
  'did-management/did': 'Requests.ThingDids',
  'did-management/domain': 'Requests.ThingDomains',
  'vta/webvh/servers': 'Requests.ThingServers',
  'did-management/server': 'Requests.ThingServers',
  acl: 'Requests.ThingAccess',
  config: 'Requests.ThingSettings',
  'vta/seeds': 'Requests.ThingSeeds',
  'vta/audit': 'Requests.ThingAudit',
  audit: 'Requests.ThingAudit',
  device: 'Requests.ThingDevices',
  policy: 'Requests.ThingRules',
  consent: 'Requests.ThingApprovals',
  persona: 'Requests.ThingPersona',
  'vault/credentials': 'Requests.ThingCards',
}

/** What a task does to it, by the path's last word. */
const TASK_VERBS: ReadonlyArray<[RegExp, string]> = [
  [/^(list|get|show|info|check-name|stats|health|history|preview|analyze)$/, 'Requests.VerbSee'],
  [/^(create|import|register|put|publish|add|admin-register|receive)$/, 'Requests.VerbAdd'],
  [/^(delete|purge|revoke|disable|deregister|unassign|wipe|purge-version)$/, 'Requests.VerbRemove'],
  [
    /^(update|patch|rename|rotate|enable|assign|set|set-.+|change-.+|promote|rollback|update-.+|upsert)$/,
    'Requests.VerbChange',
  ],
  [/^(sign|derive-and-sign|derive-and-sign-document|present)$/, 'Requests.VerbUse'],
]

/**
 * The task in words ("create a context"), or undefined for one Keyring has no
 * words for. A task with a phrase of its own says it; another is put together
 * from what it does (its path's last word) and what to (its family): a request
 * for `vta/contexts/get` read as "run vta/contexts/get/1.0" (10-06).
 */
export function taskWords(taskType: string, t: TFunction): string | undefined {
  const path = taskPath(taskType)
  const key = TASK_WORDS[path]
  if (key) return t(key) as string
  const cut = path.lastIndexOf('/')
  if (cut < 0) return undefined
  const family = path.slice(0, cut)
  const action = path.slice(cut + 1)
  const thing = TASK_THINGS[family] ?? TASK_THINGS[family.split('/').slice(0, -1).join('/')]
  const verb = TASK_VERBS.find(([match]) => match.test(action))?.[1]
  if (!thing || !verb) return undefined
  return t(verb, { thing: t(thing), interpolation: { escapeValue: false } }) as string
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
  // A task Keyring cannot put in words is not named by its URI in the
  // sentence; its technical name is under the card's toggle.
  return (
    action
      ? t('Requests.AsksTo', { requester, action, interpolation: { escapeValue: false } })
      : t('Requests.AsksSomething', { requester, interpolation: { escapeValue: false } })
  ) as string
}
