/**
 * The devices that run a person's agent (#10: a new phone is a new device).
 *
 * A device is an admin row of the agent's access list. One that has claimed a
 * device binding (`device/register`) also carries a name, a platform and when
 * it was last seen, and the agent records a wipe on it. The binding hangs off
 * the access-list entry, one per DID (vta-service `operations/device.rs`), so
 * the list here is the access list's admins, each joined to its binding when
 * it has one. The browser plugin, a computer on a `did:key`, and a phone from
 * before registration existed are admins with no binding: they are still
 * listed, from the access list alone.
 *
 * Removing one follows what the agent can do with it:
 * - a registered device is **wiped** (`device/wipe`). The agent refuses it at
 *   login from then on (vta-service `auth/backend.rs`), and it stays listed
 *   with `wipedAt` set. The agent never learns that the wipe happened on the
 *   device, since the device can no longer reach it, so the wipe stays pending.
 * - a device with no binding is **revoked** (`acl/revoke`), which deletes its
 *   entry; it leaves the list.
 *
 * Task versions are the ones `vta-sdk`'s own client sends (`client/
 * agent_devices.rs`), and liveness uses openvtc's window (`openvtc-core
 * devices.rs`: a heartbeat every 5 minutes, live within 15).
 *
 * @module trust-tasks/module/vtaDevices
 */

import { versionsFor } from './taskVersions'
import { VtiRefusal } from './vtiAgent'

/**
 * The device tasks at 0.2: upstream deprecated 0.1 ("will be removed in a
 * future release", vta-sdk trust_tasks.rs at VTI 2240aa7e). 0.2 is the same
 * shape with camelCase enum values on the wire; of what this phone sends, only
 * wipe's `scope` changes (`cacheAndKeys`). Agents accept 0.2 since VTI #303
 * (2026-06). acl/list and acl/revoke are not deprecated.
 */
export const AGENT_DEVICE_TASK = {
  register: 'https://trusttasks.org/spec/device/register/0.2',
  heartbeat: 'https://trusttasks.org/spec/device/heartbeat/0.2',
  list: 'https://trusttasks.org/spec/device/list/0.2',
  wipe: 'https://trusttasks.org/spec/device/wipe/0.2',
  setWake: 'https://trusttasks.org/spec/device/set-wake/0.2',
  aclList: 'https://trusttasks.org/spec/acl/list/0.1',
  aclRevoke: 'https://trusttasks.org/spec/acl/revoke/0.1',
  // 0.2 asked first, 0.1 when the agent does not serve it (taskVersions.ts).
  aclList02: 'https://trusttasks.org/spec/acl/list/0.2',
  aclRevoke02: 'https://trusttasks.org/spec/acl/revoke/0.2',
} as const

/** acl/revoke/0.2 needs its narrowing said: a full removal is `{kind: "entry"}` (trust-tasks-tf ce07a039 acl/revoke/0.2). */
const revokePayload = (uri: string, subject: string) =>
  uri === AGENT_DEVICE_TASK.aclRevoke02 ? { subject, revocation: { kind: 'entry' } } : { subject }

/** How often a running phone tells its agent it is still here. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000
/** How recently a device must have been seen to count as live. */
export const LIVENESS_WINDOW_MS = 15 * 60_000

/** The heartbeat extension that corrects a device's own name (vta-sdk `EXT_DEVICE_NAME`). */
const EXT_DEVICE_NAME = 'org.openvtc.device-name'

/** What these calls need from the agent client: its task call and this phone's own DID. */
export interface AgentDevicePort {
  managerDid?: string
  task<T = unknown>(type: string, payload: Record<string, unknown>): Promise<T>
}

export interface AgentDevice {
  /** The device's access-list subject. */
  did: string
  source: 'registered' | 'aclOnly'
  isThisPhone: boolean
  /** The access list's label for the entry. */
  label?: string
  /** RFC 3339, when the agent added the entry. */
  createdAt?: string
  deviceId?: string
  displayName?: string
  platform?: string
  registeredAt?: string
  lastSeenAt?: string
  disabledAt?: string
  wipedAt?: string
  /** The agent refuses this device at login (disabled or wiped). */
  accessRevoked: boolean
  /** A wipe was recorded; the device has not been able to confirm it. */
  wipePending: boolean
  /** A Keyring phone: registered from iOS or Android. Undefined when unknown. */
  kind?: 'keyring'
}

type Json = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** Every admin of the agent, each with its device binding when it has one. */
export async function listAgentDevices(port: AgentDevicePort): Promise<AgentDevice[]> {
  const [aclAnswer, listAnswer] = await Promise.all([
    versionsFor(port.managerDid ?? port)
      .ask('aclList', [AGENT_DEVICE_TASK.aclList, AGENT_DEVICE_TASK.aclList02], (uri) =>
        port.task<{ entries?: unknown }>(uri, {})
      )
      .then(({ answer }) => answer),
    // Wiped and disabled bindings are left out unless asked for, and a removed
    // device must stay listed as removed rather than fall back to a bare ACL row.
    port.task<{ devices?: unknown }>(AGENT_DEVICE_TASK.list, { includeWiped: true, includeDisabled: true }),
  ])
  const entries = (Array.isArray(aclAnswer?.entries) ? aclAnswer.entries : []) as Json[]
  const rows = (Array.isArray(listAnswer?.devices) ? listAnswer.devices : []) as Json[]
  const bindingOf = new Map<string, Json>()
  for (const row of rows) {
    const did = str(row.consumerDid)
    if (did) bindingOf.set(did, row)
  }
  const devices: AgentDevice[] = []
  for (const entry of entries) {
    const did = str(entry.subject)
    if (!did || entry.role !== 'admin') continue
    const b = bindingOf.get(did)
    const platform = str(b?.platform)
    const disabledAt = str(b?.disabledAt)
    const wipedAt = str(b?.wipedAt)
    devices.push({
      did,
      source: b ? 'registered' : 'aclOnly',
      isThisPhone: did === port.managerDid,
      label: str(entry.label),
      createdAt: str(entry.createdAt),
      ...(b
        ? {
            deviceId: str(b.deviceId),
            displayName: str(b.displayName),
            platform,
            registeredAt: str(b.registeredAt),
            lastSeenAt: str(b.lastSeenAt),
            disabledAt,
            wipedAt,
          }
        : {}),
      accessRevoked: Boolean(disabledAt || wipedAt),
      wipePending: Boolean(wipedAt),
      ...(platform === 'ios' || platform === 'android' ? { kind: 'keyring' as const } : {}),
    })
  }
  return devices
}

/**
 * Remove a device from the agent: revoke its access, after first wiping it
 * when it is registered. Never this phone — the agent refuses a caller removing
 * itself, and a person who wants to leave does so from the other device.
 *
 * Both, because neither is enough alone. A wipe marks the binding, but the
 * agent checks that mark only when a caller signs in over REST
 * (vta-service `auth/backend.rs` `device_access_gate`); its trust-task path
 * resolves authority from the access list alone (`messaging/auth.rs`
 * `auth_from_did`), so a wiped phone kept acting as an administrator over TSP
 * on the lab (VTI 63d4c0ca). Revoking deletes the access-list entry, which
 * both paths refuse. It deletes the binding too, so the device leaves the
 * list; the removed phone learns it on its next call, from the refusal.
 *
 * A wipe the agent refuses does not stop the revoke: access is what matters.
 * `mode` is `wiped` when both happened, `revoked` when only the revoke did.
 */
export async function removeAgentDevice(
  port: AgentDevicePort,
  device: AgentDevice
): Promise<{ mode: 'wiped' | 'revoked' }> {
  if (device.isThisPhone) throw new Error('refusing to remove this phone from its own agent')
  let wiped = false
  if (device.source === 'registered' && device.deviceId) {
    wiped = await port
      .task(AGENT_DEVICE_TASK.wipe, {
        deviceId: device.deviceId,
        scope: 'cacheAndKeys',
        reason: 'Removed from the agent by its owner in Keyring',
      })
      .then(
        () => true,
        () => false
      )
  }
  await versionsFor(port.managerDid ?? port).ask(
    'aclRevoke',
    [AGENT_DEVICE_TASK.aclRevoke, AGENT_DEVICE_TASK.aclRevoke02],
    (uri) => port.task(uri, revokePayload(uri, device.did))
  )
  return { mode: wiped ? 'wiped' : 'revoked' }
}

/**
 * Claim this phone's device binding. The agent refuses a second claim for the
 * same DID (`device/register:alreadyRegistered`), which means it is already
 * registered; the answer says which, so a caller can correct the name on a
 * heartbeat instead.
 */
export async function registerThisDevice(
  port: AgentDevicePort,
  opts: { displayName: string; platform: string }
): Promise<'registered' | 'alreadyRegistered'> {
  try {
    await port.task(AGENT_DEVICE_TASK.register, {
      consumerKind: { kind: 'companion', formFactor: 'mobile' },
      displayName: opts.displayName,
      platform: opts.platform,
    })
    return 'registered'
  } catch (e) {
    // Over a trust task the agent sends a conflict with a generic code and the
    // reason in its words ("device/register:alreadyRegistered — …", vta-service
    // operations/device.rs), so both are read.
    if (e instanceof VtiRefusal && /alreadyRegistered/.test(`${e.code} ${e.message}`)) return 'alreadyRegistered'
    throw e
  }
}

/** Tell the agent this phone is still here. */
export async function heartbeat(port: AgentDevicePort): Promise<void> {
  await port.task(AGENT_DEVICE_TASK.heartbeat, {})
}

/** Rename this phone: a heartbeat carrying the corrected name, the only way a binding's name changes. */
export async function renameThisDevice(port: AgentDevicePort, displayName: string): Promise<void> {
  await port.task(AGENT_DEVICE_TASK.heartbeat, { ext: { [EXT_DEVICE_NAME]: { displayName } } })
}

/** A push gateway's opaque handle for this phone's push token (`push/register`'s answer). */
export interface WakeHandle {
  /** The gateway's DID. The agent wakes only a gateway named by a DID. */
  gateway: string
  handle: string
}

export type PushPlatform = 'apns' | 'fcm'

/** The agent's answer to `device/set-wake`. */
export interface WakeChannel {
  pushCapable: boolean
  /** Who may wake this phone; the agent owns this list and provisions it to the gateway. */
  allowedTriggers?: string[]
}

/**
 * Tell the agent how to wake this phone: the handle a push gateway gave for its
 * push token (docs/plans/push-notifications-plan.md §4.4). The agent records
 * it, computes who may wake the phone (itself, plus any suggested trigger it
 * accepts) and provisions the gateway; that last step is best effort on the
 * agent's side and never reported here (vta-service `trust_tasks/device.rs`,
 * `provision_gateway`). The agent never sees the push token.
 */
export async function setThisDeviceWake(
  port: AgentDevicePort,
  wake: WakeHandle,
  opts: { pushPlatform?: PushPlatform; suggestedTriggers?: string[] } = {}
): Promise<WakeChannel> {
  const payload: Record<string, unknown> = { wakeHandle: { gateway: wake.gateway, handle: wake.handle } }
  if (opts.pushPlatform) payload.pushPlatform = opts.pushPlatform
  if (opts.suggestedTriggers?.length) payload.suggestedTriggers = opts.suggestedTriggers
  return toWakeChannel(await port.task(AGENT_DEVICE_TASK.setWake, payload))
}

/**
 * Stop the agent waking this phone: `set-wake` with no handle clears the
 * channel. Sent before this phone unlinks, since the gateway has no unregister
 * and the agent's disable and wipe leave a wake channel in place (plan §8).
 */
export async function clearThisDeviceWake(port: AgentDevicePort): Promise<WakeChannel> {
  return toWakeChannel(await port.task(AGENT_DEVICE_TASK.setWake, {}))
}

function toWakeChannel(answer: unknown): WakeChannel {
  const a = (answer ?? {}) as { pushCapable?: unknown; triggerPolicy?: { allowedTriggers?: unknown } }
  const triggers = a.triggerPolicy?.allowedTriggers
  return {
    pushCapable: a.pushCapable === true,
    allowedTriggers: Array.isArray(triggers) ? triggers.filter((t): t is string => typeof t === 'string') : undefined,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A short, dated name a person can tell apart ("iPhone · added 28 Sep"), not a
 * model string. The screens may translate it; this is the stored default.
 */
export function defaultDeviceName(platform: string, addedAt: Date, _locale?: string): string {
  const what = platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android phone' : 'Phone'
  return `${what} · added ${addedAt.getDate()} ${MONTHS[addedAt.getMonth()]}`
}

/** Other devices acting as this agent right now: seen within the liveness window, still allowed in. */
export function liveSiblings(
  devices: AgentDevice[],
  now: Date = new Date(),
  windowMs = LIVENESS_WINDOW_MS
): AgentDevice[] {
  return devices.filter((d) => {
    if (d.isThisPhone || d.accessRevoked || !d.lastSeenAt) return false
    const seen = Date.parse(d.lastSeenAt)
    return Number.isFinite(seen) && now.getTime() - seen <= windowMs
  })
}
