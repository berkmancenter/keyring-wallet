/**
 * joinWire — which version of the join tasks a community is spoken to in.
 *
 * A community serves one version of `vtc/join-requests/manifest` and
 * `…/submit`: 0.2 up to vta-service 0.51, and only 0.3 from vti #1907, which
 * answers the older ones `unsupportedVersion`. One build has to join both, so
 * the version is the community's to state and the wallet's to follow.
 *
 * A VTC refuses a version it does not serve at dispatch, before any handler
 * runs, with the framework's `unsupportedVersion` and, in
 * `details.servedVersions`, the URIs it does serve for that task (vtc-service
 * trust_tasks/mod.rs `unsupported_type_or_version`, the same at 0.47.0 and at
 * #1907). That refusal is therefore proof the request was NOT taken: asking
 * again in the version it names is not a second request. Silence is no such
 * proof, and is never answered with a resend (see `ask`).
 *
 * @module trust-tasks/module/joinWire
 */

/** The versions of the join manifest and submit this wallet speaks, newest first. */
export const JOIN_WIRES = ['0.3', '0.2'] as const
export type JoinWire = (typeof JOIN_WIRES)[number]

const FAMILY = {
  manifest: 'https://trusttasks.org/spec/vtc/join-requests/manifest',
  submit: 'https://trusttasks.org/spec/vtc/join-requests/submit',
} as const
export type JoinTask = keyof typeof FAMILY

/** The Trust Task `type` of a join task at a version. */
export const joinTaskType = (task: JoinTask, wire: JoinWire): string => `${FAMILY[task]}/${wire}`

/** Every manifest `type` this wallet may send: each is a read. */
export const JOIN_MANIFEST_TYPES: readonly string[] = JOIN_WIRES.map((wire) => joinTaskType('manifest', wire))

/** The order to try versions in: the one this community last answered first, then the rest, newest first. */
export function wiresToTry(remembered?: JoinWire): JoinWire[] {
  return remembered ? [remembered, ...JOIN_WIRES.filter((w) => w !== remembered)] : [...JOIN_WIRES]
}

/**
 * The version to ask in next, when a refusal says the community does not serve
 * the one just asked — and undefined for every other refusal, and when no
 * version this wallet speaks is left.
 *
 * `unsupportedType` is read the same way: a community older than the
 * version-aware refusal answers an unknown version of a task it serves with
 * that code. What the refusal names in `details.servedVersions` is preferred;
 * a refusal that names nothing leaves the versions not yet tried.
 */
export function wireAfterRefusal(
  refusal: { code?: unknown; details?: unknown } | undefined,
  task: JoinTask,
  tried: readonly JoinWire[]
): JoinWire | undefined {
  const code = String(refusal?.code ?? '')
    .split(':')
    .pop()
  if (code !== 'unsupportedVersion' && code !== 'unsupportedType') return undefined
  const left = JOIN_WIRES.filter((w) => !tried.includes(w))
  const served = (refusal?.details as { servedVersions?: unknown } | undefined)?.servedVersions
  if (Array.isArray(served)) {
    const versions = served
      .filter((uri): uri is string => typeof uri === 'string' && uri.startsWith(`${FAMILY[task]}/`))
      .map((uri) => uri.slice(FAMILY[task].length + 1))
    // It names what it serves for this task: only those are worth asking, and
    // when this wallet speaks none of them there is nothing left to ask.
    if (versions.length) return left.find((w) => versions.includes(w))
  }
  return left[0]
}

/**
 * The `submit` payload at a version.
 *
 * 0.3 names the criterion the submission is made under in `criterion`, by its
 * `requirementsDigest` (submit/0.3 payload schema). 0.2 has no such member: a
 * community read the digest from `extensions.requirementsDigest`, which 0.3 no
 * longer reads for that (vtc-service join/criteria.rs `govern`: the cited
 * digest is `criterion` alone).
 */
export function submitPayload(
  wire: JoinWire,
  submission: { vp: unknown; registryConsent: boolean; criterion?: string }
): Record<string, unknown> {
  const { vp, registryConsent, criterion } = submission
  if (wire === '0.3') return { vp, registryConsent, ...(criterion ? { criterion } : {}) }
  return { vp, registryConsent, extensions: criterion ? { requirementsDigest: criterion } : {} }
}
