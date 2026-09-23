/**
 * What to call a VTA on screen, beside its DID (VTI-Q20, answered 2026-09-23).
 *
 * Two sources, in this order:
 *
 * 1. A **verified agent name** — `https://example.com/@alice`. A DID claims a
 *    name in its document's `alsoKnownAs`, but a claim on its own is a bare
 *    self-assertion: anyone can write `mybank.com/@treasury` into their own
 *    document. It counts only when the name, resolved forward, leads back to
 *    the same DID — the hosting server answers `GET https://host/@name` with a
 *    302 whose `Location` is the bare DID (affinidi-webvh-service
 *    `resolve_agent_name`). This is upstream's own rule (vta-sdk
 *    `display_name::agent_name`), reimplemented, not borrowed.
 * 2. The operator's **`vta_name`**, read through `config/show/0.1`. A label
 *    the operator sets: shown beside the DID, never in place of a verified name.
 *
 * An unverified claim is not returned at all: this feeds a display that people
 * act on (linking an agent, admitting a member), and a name that did not check
 * out has no business there. A caller that finds neither shows the host.
 */

/** The label to show for an agent, and where it came from. */
export interface AgentLabel {
  label: string
  source: 'agentName' | 'vtaName'
}

/** The document shape this reads: its `alsoKnownAs`. */
export interface AgentNameDocument {
  alsoKnownAs?: readonly unknown[] | null
}

/** Upstream checks at most a few claims; a document claiming dozens is not worth a request each. */
const MAX_CLAIMS_CHECKED = 3

/** The agent names a document claims, in document order: `https://<host>/@<name>` entries of `alsoKnownAs`. */
export function claimedAgentNames(doc: AgentNameDocument): string[] {
  const names: string[] = []
  for (const entry of doc.alsoKnownAs ?? []) {
    if (typeof entry !== 'string') continue
    if (/^https:\/\/[^/\s]+\/@[^/\s?#]+$/.test(entry)) names.push(entry)
    if (names.length >= MAX_CLAIMS_CHECKED) break
  }
  return names
}

/**
 * Whether `name` resolves forward to `did`: the host must answer with a
 * redirect whose `Location` is exactly that DID. Any other answer — a
 * different DID, a 404, a network error, a runtime that follows the redirect
 * and hides the `Location` — is "not verified", never a guess.
 */
export async function nameLeadsTo(
  name: string,
  did: string,
  fetchImpl: (
    url: string,
    init: { method: string; redirect: 'manual' }
  ) => Promise<{ status: number; headers: { get(name: string): string | null } }> = fetch as never
): Promise<boolean> {
  try {
    const response = await fetchImpl(name, { method: 'GET', redirect: 'manual' })
    if (response.status < 300 || response.status > 399) return false
    return response.headers.get('location')?.trim() === did
  } catch {
    return false
  }
}

/** The first claimed name that leads back to `did`, or undefined. */
export async function verifiedAgentName(
  did: string,
  doc: AgentNameDocument,
  fetchImpl?: Parameters<typeof nameLeadsTo>[2]
): Promise<string | undefined> {
  for (const name of claimedAgentNames(doc)) {
    if (await nameLeadsTo(name, did, fetchImpl)) return name
  }
  return undefined
}

/** The `vta_name` value from a `config/show/0.1` answer, when it is a non-empty string. */
export function vtaNameFrom(answer: unknown): string | undefined {
  const fields = (answer as { fields?: unknown } | undefined)?.fields
  if (!Array.isArray(fields)) return undefined
  const field = fields.find((f) => (f as { key?: unknown })?.key === 'vta_name') as { value?: unknown } | undefined
  return typeof field?.value === 'string' && field.value.trim() ? field.value.trim() : undefined
}

/** The verified agent name, else the operator's `vta_name`, else undefined. */
export function chooseAgentLabel(
  verifiedName: string | undefined,
  vtaName: string | undefined
): AgentLabel | undefined {
  if (verifiedName) return { label: verifiedName, source: 'agentName' }
  if (vtaName) return { label: vtaName, source: 'vtaName' }
  return undefined
}
