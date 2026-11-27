/**
 * The seam for memories on HCP (step 7.29, C10), and only the seam: no list, delete or edit flow calls it yet.
 *
 * C10 is the memories list by `hcp/entries/get`, Delete memory by `hcp/entries/withdraw` and edit by
 * `hcp/entries/revise`. At the suite pin (4e2dd42fa) all three require `accessToken`, even from a Management Client.
 * Keyring, as the person's Management Client, has none: it authenticates as the administrator DID with a document
 * proof (plan D2, companion finding 12). Giving it one is a VTI decision, and plan §11 Q9 (whether HCP memories and
 * `vta/memory/*` merge) is open too. So {@link hcpManagementCall} sends one of these three tasks only with a token,
 * and without one answers `needsToken` having sent nothing: once the token question is answered, C10 is a call site
 * and a token, not a change here.
 *
 * For that future call site: `entries/withdraw` cannot be undone, so, by the reviewer's rule for every part, the
 * flow that sends it writes a local intent record first, then sends, then completes the record, so that a failed
 * local write never leaves the app showing something false. The seam keeps no record itself (the brief: no store).
 *
 * Nothing here logs a payload, a token or a response.
 *
 * @module connected-agents/hcp/memories/management
 */
import { callHcp, type HcpCallOutcome, type HcpVtaPort } from '../vtaPort'

// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_ENTRIES_GET = 'https://trusttasks.org/spec/hcp/entries/get/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_ENTRIES_WITHDRAW = 'https://trusttasks.org/spec/hcp/entries/withdraw/0.1'
// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_ENTRIES_REVISE = 'https://trusttasks.org/spec/hcp/entries/revise/0.1'

/** The tasks whose schema requires `accessToken` even from a Management Client: never sent without a token. */
export const HCP_TOKEN_REQUIRED_TASKS: readonly string[] = [HCP_ENTRIES_GET, HCP_ENTRIES_WITHDRAW, HCP_ENTRIES_REVISE]

/** The HCP access token Keyring would act under, or none: today always none (see the module comment). */
export type HcpManagementToken = { token: string } | { none: true }

/** An {@link HcpCallOutcome}, or `needsToken`: a task that requires a token was not sent, as none was given. */
export type HcpManagementOutcome<T> = HcpCallOutcome<T> | { ok: false; needsToken: true }

/**
 * One HCP management task through the port and `callHcp`. With a token, the payload carries it as `accessToken`.
 * Without one, a task in {@link HCP_TOKEN_REQUIRED_TASKS} is not sent and the answer is `needsToken`; any other task
 * goes as every Management Client task does today, with no `accessToken`. The `token` argument is the only source of
 * the member: an `accessToken` already in `payload` is dropped, so a token never travels unless it was given here.
 *
 * `needsToken` is no VTA refusal and no unreachable VTA: nothing was sent, and no retry changes it until Keyring has
 * a token. The HCP flags are checked by the port, as for every HCP task: with them off nothing is sent either.
 */
export async function hcpManagementCall<T>(
  port: HcpVtaPort,
  type: string,
  payload: Record<string, unknown>,
  token: HcpManagementToken
): Promise<HcpManagementOutcome<T>> {
  const rest = { ...payload }
  delete rest.accessToken
  if ('token' in token) return callHcp<T>(port, type, { ...rest, accessToken: token.token })
  if (HCP_TOKEN_REQUIRED_TASKS.includes(type)) return { ok: false, needsToken: true }
  return callHcp<T>(port, type, rest)
}
