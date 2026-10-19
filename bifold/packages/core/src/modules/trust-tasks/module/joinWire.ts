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
 * The manifest has one version more than submit. manifest/0.4 is 0.3 plus an
 * optional `directoryDisclosure` (tf#823): the same criteria, answered by the
 * same submit/0.3. So the manifest is asked at its own versions
 * (`MANIFEST_WIRES`), newest first, and the version it was read at maps to the
 * criteria-and-submit version (`JoinWire`) through `criteriaWireOf`.
 *
 * @module trust-tasks/module/joinWire
 */

/** The versions of the join criteria and submit this wallet speaks, newest first. */
export const JOIN_WIRES = ['0.3', '0.2'] as const
export type JoinWire = (typeof JOIN_WIRES)[number]

/** The versions of the join manifest this wallet asks for, newest first. */
export const MANIFEST_WIRES = ['0.4', '0.3', '0.2'] as const
export type ManifestWire = (typeof MANIFEST_WIRES)[number]

/** The criteria-and-submit version a manifest read at `wire` answers to: 0.4's criteria are 0.3's. */
export const criteriaWireOf = (wire: ManifestWire): JoinWire => (wire === '0.4' ? '0.3' : wire)

const FAMILY = {
  manifest: 'https://trusttasks.org/spec/vtc/join-requests/manifest',
  submit: 'https://trusttasks.org/spec/vtc/join-requests/submit',
} as const
export type JoinTask = keyof typeof FAMILY

/** The Trust Task `type` of a join task at a version. */
export const joinTaskType = (task: JoinTask, wire: JoinWire): string => `${FAMILY[task]}/${wire}`

/** The Trust Task `type` of the join manifest at one of its versions. */
export const manifestTaskType = (wire: ManifestWire): string => `${FAMILY.manifest}/${wire}`

/** Every manifest `type` this wallet may send: each is a read. */
export const JOIN_MANIFEST_TYPES: readonly string[] = MANIFEST_WIRES.map(manifestTaskType)

/**
 * The order to ask for the manifest in: newest first, every time, so a
 * community that has moved up is read at its newest the next time it is
 * asked. `prefer`, a criteria-and-submit version, puts the manifest versions
 * answering to it first: after a submit refused as unsupported, the criteria
 * are read again in the version the submit will be sent at.
 */
export function manifestWiresToTry(prefer?: JoinWire): ManifestWire[] {
  if (!prefer) return [...MANIFEST_WIRES]
  const first = MANIFEST_WIRES.filter((w) => criteriaWireOf(w) === prefer)
  return [...first, ...MANIFEST_WIRES.filter((w) => !first.includes(w))]
}

/** The version a refusal leaves to ask in, from `versions` (newest first), given those already `tried`. */
function versionAfterRefusal<W extends string>(
  refusal: { code?: unknown; details?: unknown } | undefined,
  family: string,
  versions: readonly W[],
  tried: readonly W[]
): W | undefined {
  const code = String(refusal?.code ?? '')
    .split(':')
    .pop()
  if (code !== 'unsupportedVersion' && code !== 'unsupportedType') return undefined
  const left = versions.filter((w) => !tried.includes(w))
  const served = (refusal?.details as { servedVersions?: unknown } | undefined)?.servedVersions
  if (Array.isArray(served)) {
    const named = served
      .filter((uri): uri is string => typeof uri === 'string' && uri.startsWith(`${family}/`))
      .map((uri) => uri.slice(family.length + 1))
    // It names what it serves for this task: only those are worth asking, and
    // when this wallet speaks none of them there is nothing left to ask.
    if (named.length) return left.find((w) => named.includes(w))
  }
  return left[0]
}

/** The manifest version to ask in next after a refusal; undefined when none is left (see `wireAfterRefusal`). */
export function manifestWireAfterRefusal(
  refusal: { code?: unknown; details?: unknown } | undefined,
  tried: readonly ManifestWire[],
  versions: readonly ManifestWire[] = MANIFEST_WIRES
): ManifestWire | undefined {
  return versionAfterRefusal(refusal, FAMILY.manifest, versions, tried)
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
  return versionAfterRefusal(refusal, FAMILY[task], JOIN_WIRES, tried)
}

/**
 * The `submit` payload at a version.
 *
 * 0.3 names the criterion the submission is made under in `criterion`, by its
 * `requirementsDigest` (submit/0.3 payload schema). 0.2 has no such member: a
 * community read the digest from `extensions.requirementsDigest`, which 0.3 no
 * longer reads for that (vtc-service join/criteria.rs `govern`: the cited
 * digest is `criterion` alone).
 *
 * `extensions` is the schema's "opaque applicant-supplied extension bag" at
 * both versions. A hidden-vetting submission carries its proof there, as
 * `extensions.hiddenVetting` (the `vta/pcs/prove` answer, verbatim). At 0.3 the
 * bag is sent only when it has something in it, so an ordinary submission is
 * unchanged; at 0.2 it is always sent, with the digest beside whatever it holds.
 */
export function submitPayload(
  wire: JoinWire,
  submission: { vp: unknown; registryConsent: boolean; criterion?: string; extensions?: Record<string, unknown> }
): Record<string, unknown> {
  const { vp, registryConsent, criterion } = submission
  const extensions = submission.extensions ?? {}
  if (wire === '0.3') {
    return {
      vp,
      registryConsent,
      ...(criterion ? { criterion } : {}),
      ...(Object.keys(extensions).length ? { extensions } : {}),
    }
  }
  return { vp, registryConsent, extensions: { ...extensions, ...(criterion ? { requirementsDigest: criterion } : {}) } }
}
