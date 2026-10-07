/**
 * Making this phone wakeable by its agent (docs/plans/push-notifications-plan.md
 * §4.4, step 1.5): after the phone is registered as a device of its agent,
 *
 * 1. read this phone's platform push token;
 * 2. register it with the push gateway (`push/register`), which returns an
 *    opaque handle;
 * 3. give the handle to the agent (`device/set-wake`), which provisions the
 *    gateway itself.
 *
 * Off unless a build names a gateway (`PUSH_GATEWAY_URL`): nothing about push is
 * baked into a shipped build. The agent never sees the token, and a locked or
 * closed app shows only generic text when woken (plan §2); this module does
 * not handle wakes.
 */
import { registerWithGateway, type GatewayWakeHandle, type PushRegistration } from './pushGateway'

export interface PushWakeDeps {
  /** The gateway's HTTPS base URL; empty or undefined means push is off. */
  gatewayUrl?: string
  /** The DID of the agent this phone is linked to, or undefined when it is not linked. */
  agentDid(): string | undefined
  /** This phone's platform push token, or undefined when there is none (permission denied, no services). */
  pushRegistration(): Promise<PushRegistration | undefined>
  /** `device/set-wake` on the linked agent. */
  setWake(
    wake: GatewayWakeHandle,
    opts: { pushPlatform: PushRegistration['platform'] }
  ): Promise<{ pushCapable: boolean; allowedTriggers?: string[] }>
  register?: typeof registerWithGateway
  /**
   * The handle each agent was given, and for which token. The gateway mints a
   * new handle at every `push/register`, keeps them, and refuses a token past
   * a few (GATEWAY_MAX_HANDLES_PER_TOKEN, 4): registering at every link,
   * switch or toggle would soon leave a new agent unable to wake the phone.
   * So a handle is registered once per agent and token, and given again.
   */
  handles?: WakeHandleStore
  now?: () => number
}

/** One agent's handle, and a fingerprint of the token it was made for. */
export interface KeptWakeHandle {
  tokenKey: string
  handle: GatewayWakeHandle
  /** When the gateway minted it (ms). Absent on a handle kept before this was recorded. */
  mintedAt?: number
  /**
   * When the agent first answered set-wake with it as wakeable (ms). Only then
   * has the agent provisioned it at the gateway; until then the gateway sweeps
   * it an hour after it was minted.
   */
  provisionedAt?: number
}

export interface WakeHandleStore {
  get(agentDid: string): Promise<KeptWakeHandle | undefined>
  set(agentDid: string, kept: KeptWakeHandle): Promise<void>
}

/**
 * How long a handle the agent has not yet confirmed may be given again before
 * a fresh one is registered. The gateway sweeps a handle that is still
 * unprovisioned an hour after it was minted (vti-push-gateway e542a9d7
 * store.rs:26-30, 528-541); a provisioned one is never swept. Kept inside the
 * hour so a retry never sends a handle the gateway has dropped, and so a failed
 * try does not cost one of the token's few handles every time.
 */
export const UNCONFIRMED_HANDLE_REUSE_MS = 50 * 60 * 1000

/** Whether a kept handle may be given to the agent again, rather than registering a new one. */
export function reusableHandle(kept: KeptWakeHandle | undefined, tokenKey: string, now: number): boolean {
  if (!kept || kept.tokenKey !== tokenKey) return false
  if (kept.provisionedAt !== undefined) return true
  // Kept before mintedAt was recorded: it was given to the agent at once, and
  // nearly always provisioned. Registering again would spend a handle per agent.
  if (kept.mintedAt === undefined) return true
  return now - kept.mintedAt < UNCONFIRMED_HANDLE_REUSE_MS
}

/**
 * A fingerprint of a push token, so a handle is known to be for this token
 * without keeping the token itself (FNV-1a, 32 bits: telling one token from
 * the next, not a secret).
 */
export function tokenKeyOf(registration: PushRegistration): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < registration.token.length; i++) {
    hash ^= registration.token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${registration.platform}:${hash.toString(16).padStart(8, '0')}`
}

export type PushWakeOutcome =
  | { status: 'off' }
  | { status: 'notLinked' }
  | { status: 'noToken' }
  | { status: 'wakeable'; handle: GatewayWakeHandle; allowedTriggers?: string[] }
  | { status: 'notWakeable'; handle: GatewayWakeHandle }

/**
 * Make this phone wakeable by its agent. Call it after the phone is registered
 * as a device, and again whenever the platform token changes: a new token gets
 * a new handle, and the agent replaces the old one. Refusals from the gateway
 * or the agent are thrown for the caller to log; they never block the app.
 */
export async function enablePushWake(deps: PushWakeDeps): Promise<PushWakeOutcome> {
  const gatewayUrl = deps.gatewayUrl?.trim()
  if (!gatewayUrl) return { status: 'off' }
  const agentDid = deps.agentDid()
  if (!agentDid) return { status: 'notLinked' }
  const registration = await deps.pushRegistration()
  if (!registration) return { status: 'noToken' }

  // The handle this agent already has for this token, else a new one.
  const now = (deps.now ?? Date.now)()
  const tokenKey = tokenKeyOf(registration)
  const kept = await deps.handles?.get(agentDid).catch(() => undefined)
  const reuse = kept && reusableHandle(kept, tokenKey, now) ? kept : undefined
  const handle = reuse?.handle ?? (await (deps.register ?? registerWithGateway)(gatewayUrl, registration, agentDid))
  if (!handle.gateway.startsWith('did:')) {
    // An agent wakes only a gateway named by a DID; one without an identity
    // answers with its URL, and set-wake would record a channel nothing uses.
    throw new Error('push gateway has no DID identity, so the agent could not wake this phone through it')
  }
  const record: KeptWakeHandle = reuse ?? { tokenKey, handle, mintedAt: now }
  // Kept before set-wake, so a retry after a failed one gives the same handle
  // (within UNCONFIRMED_HANDLE_REUSE_MS) instead of spending another.
  if (!reuse) await deps.handles?.set(agentDid, record).catch(() => undefined)
  const channel = await deps.setWake(handle, { pushPlatform: registration.platform })
  if (channel.pushCapable && record.provisionedAt === undefined) {
    await deps.handles?.set(agentDid, { ...record, provisionedAt: now }).catch(() => undefined)
  }
  return channel.pushCapable
    ? { status: 'wakeable', handle, allowedTriggers: channel.allowedTriggers }
    : { status: 'notWakeable', handle }
}
