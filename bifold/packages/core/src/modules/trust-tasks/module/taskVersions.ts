/**
 * Speaking a task's newer version ahead of time, the way join does (`joinWire`):
 * ask in the newest version this wallet speaks, and step down only when the
 * agent says it does not serve that version.
 *
 * An agent answers a version it does not serve with a refusal coded
 * `unsupportedVersion` (some version of the family is served) or
 * `unsupportedType` (none is), carrying `details.servedVersions` as full type
 * URIs (vta-service `trust_tasks/helpers.rs` `method_not_found`, at
 * vta-service-v0.52.0). Any other refusal is the agent's answer to the request
 * itself and is never retried in another version: a task that was refused for
 * what it asked must not be asked again in a different version.
 *
 * What an agent was found to serve is remembered per family for the life of
 * the client, so the step down is paid once, not on every call.
 *
 * @module trust-tasks/module/taskVersions
 */
import { VtiRefusal } from './vtiAgent'

/** Is this refusal an agent saying it does not serve the version asked? */
export const isUnsupportedVersionRefusal = (refusal: unknown): refusal is VtiRefusal =>
  refusal instanceof VtiRefusal && ['unsupportedVersion', 'unsupportedType'].includes(refusal.code)

/** The type URIs a version refusal says the agent serves (empty when it names none). */
export const servedVersionsOf = (refusal: VtiRefusal): string[] => {
  const served = (refusal.details as { servedVersions?: unknown } | undefined)?.servedVersions
  return Array.isArray(served) ? served.filter((uri): uri is string => typeof uri === 'string') : []
}

/**
 * Which version to try after `tried` was refused: the next of `uris` (newest
 * first) that the agent says it serves, or simply the next one when the
 * refusal names none. Undefined when nothing is left that the agent could serve.
 */
export function versionAfterRefusal(
  uris: readonly string[],
  tried: string,
  refusal: VtiRefusal,
  alreadyTried: ReadonlySet<string> = new Set([tried])
): string | undefined {
  const served = servedVersionsOf(refusal)
  // An agent that names what it serves is taken at its word, whichever way that
  // goes (an agent upgraded since it was last asked may now serve only a newer one).
  if (served.length > 0) return uris.find((uri) => served.includes(uri) && !alreadyTried.has(uri))
  return uris.slice(uris.indexOf(tried) + 1).find((uri) => !alreadyTried.has(uri))
}

export class TaskVersions {
  /** Family → the URI this agent was found to serve. */
  private readonly served = new Map<string, string>()

  constructor(private readonly onStepDown?: (family: string, from: string, to: string) => void) {}

  /** The URI to ask first: the one this agent served before, else the newest. */
  first(family: string, uris: readonly string[]): string {
    const known = this.served.get(family)
    return known && uris.includes(known) ? known : uris[0]
  }

  /**
   * Send in the newest version the agent serves. `send` is called with a type
   * URI and builds that version's payload itself. Answers the URI that was
   * answered, beside the answer.
   */
  async ask<T>(
    family: string,
    uris: readonly string[],
    send: (uri: string) => Promise<T>
  ): Promise<{ uri: string; answer: T }> {
    let uri: string = this.first(family, uris)
    const tried = new Set<string>()
    for (;;) {
      tried.add(uri)
      try {
        const answer = await send(uri)
        this.served.set(family, uri)
        return { uri, answer }
      } catch (error) {
        if (!isUnsupportedVersionRefusal(error)) throw error
        this.served.delete(family)
        const next = versionAfterRefusal(uris, uri, error, tried)
        if (!next) throw error
        this.onStepDown?.(family, uri, next)
        uri = next
      }
    }
  }

  /** Forget what an agent served (a new agent, or a relink). */
  reset(): void {
    this.served.clear()
  }
}

const versionsByObject = new WeakMap<object, TaskVersions>()
const versionsByKey = new Map<string, TaskVersions>()

/**
 * The version memory of one agent, for callers that hold only a task port.
 * Keyed by a stable string when there is one (this phone's DID on that agent:
 * ports are often made afresh per call), else by the port object itself.
 */
export function versionsFor(owner: object | string): TaskVersions {
  if (typeof owner === 'string') {
    let versions = versionsByKey.get(owner)
    if (!versions) versionsByKey.set(owner, (versions = new TaskVersions()))
    return versions
  }
  let versions = versionsByObject.get(owner)
  if (!versions) versionsByObject.set(owner, (versions = new TaskVersions()))
  return versions
}

/** Forget every agent's versions (unlink; and between tests). */
export function forgetAllVersions(): void {
  versionsByKey.clear()
}
