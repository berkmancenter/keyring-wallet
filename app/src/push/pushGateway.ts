/**
 * The phone's side of a push wake-up gateway (OpenVTC vti-push-gateway): it
 * registers this phone's platform push token and gets back an opaque wake
 * handle, which the phone then gives its agent (`device/set-wake`). See
 * docs/plans/push-notifications-plan.md §4.4.
 *
 * Registration goes over HTTPS: it is the gateway's one anonymous task, it
 * needs no proof, and HTTPS is the only transport the gateway rate-limits per
 * source for it (vti-push-gateway README, "Who can spend the record").
 */

export const PUSH_REGISTER_TASK = 'https://trusttasks.org/spec/push/register/0.2'

/** A platform push token, as `push/register/0.2` carries it. */
export type PushRegistration =
  | { platform: 'apns'; token: string; topic: string; environment: 'sandbox' | 'production' }
  | { platform: 'fcm'; token: string }

/** The gateway's answer: where to send wakes, and this phone's handle there. */
export interface GatewayWakeHandle {
  /** The gateway's DID, when it has an identity; agents wake only a gateway named by a DID. */
  gateway: string
  handle: string
}

/**
 * The gateway refused the registration. `code` is the Trust Task error code:
 * `permissionDenied` when the gateway does not serve this phone's agent,
 * `taskFailed` when it has no sender for the platform or is at a limit.
 */
export class PushGatewayRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PushGatewayRefusal'
  }
}

/**
 * The gateway refused because this push token already has as many handles as
 * it keeps (GATEWAY_MAX_HANDLES_PER_TOKEN, 4 by default): no new agent can be
 * given a wake channel until old handles lapse (an hour after they are
 * unprovisioned) or the token changes.
 */
export function isHandleLimitRefusal(error: unknown): boolean {
  // vti-push-gateway e542a9d7: `taskFailed`, "task failed: too many handles
  // for this push token" (store.rs:129, api.rs:388-398). `taskFailed` alone
  // also covers a platform with no sender and the gateway's other limits.
  return (
    error instanceof PushGatewayRefusal &&
    error.code === 'taskFailed' &&
    /too many handles for this push token/i.test(error.message)
  )
}

type Fetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

function newId(): string {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Register this phone's push token with the gateway at `gatewayUrl`, naming
 * the agent that will provision and wake it. Returns the wake handle; throws
 * {@link PushGatewayRefusal} when the gateway refuses, and a plain Error when
 * it cannot be reached or answers something unreadable.
 */
export async function registerWithGateway(
  gatewayUrl: string,
  registration: PushRegistration,
  controllerVtaDid: string,
  fetchImpl: Fetch = fetch as unknown as Fetch
): Promise<GatewayWakeHandle> {
  const url = `${gatewayUrl.replace(/\/+$/, '')}/trust-tasks`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: newId(),
      type: PUSH_REGISTER_TASK,
      payload: { registration, controllerVtaDid },
    }),
  })
  const text = await response.text()
  let doc: { type?: unknown; payload?: Record<string, unknown> }
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error(`push gateway answered ${response.status} with no Trust Task document`)
  }
  const payload = doc.payload ?? {}
  if (typeof doc.type === 'string' && doc.type.includes('trust-task-error')) {
    const code = typeof payload.code === 'string' ? payload.code : 'unknown'
    const message = typeof payload.message === 'string' ? payload.message : 'refused'
    throw new PushGatewayRefusal(code, message)
  }
  const wake = payload.wakeHandle as { gateway?: unknown; handle?: unknown } | undefined
  if (!response.ok || typeof wake?.gateway !== 'string' || typeof wake?.handle !== 'string') {
    throw new Error(`push gateway answered ${response.status} without a wake handle`)
  }
  return { gateway: wake.gateway, handle: wake.handle }
}
